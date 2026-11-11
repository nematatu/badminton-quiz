import { SLUG_PATTERN } from '../../../packages/shared/src/contracts.js';
import { HttpError, cacheableJson, json, readJson } from './http.js';
import { enforceAttemptRateLimit } from './rate-limit.js';
import { findPublishedQuizBySlug, listPublishedQuizzes, recordAttempt, toPublicQuiz } from './repository.js';
import { createRouter } from './router.js';
import { validateAnswers } from './validation.js';

/**
 * 回答者向けの公開API。インターネットから到達可能なのはこのルートだけ。
 *
 * キャッシュ方針: CDN には載せず（s-maxage なし）、ブラウザで短時間だけ再利用し
 * ETag で再検証する。非公開化したクイズが CDN から配信され続ける事故を防ぐため。
 */

const ATTEMPT_MAX_BYTES = 4 * 1024;
const PUBLIC_CACHE = 'public, max-age=30, stale-while-revalidate=60';

function assertSlug(slug) {
  if (!SLUG_PATTERN.test(slug)) throw new HttpError(404, 'not_found');
}

async function listQuizzes(request, { env, cors }) {
  const quizzes = await listPublishedQuizzes(env.DB);
  return cacheableJson(request, { quizzes }, { cacheControl: PUBLIC_CACHE, headers: cors });
}

async function getQuiz(request, { env, cors, params }) {
  assertSlug(params.slug);
  const quiz = await findPublishedQuizBySlug(env.DB, params.slug);
  if (!quiz) throw new HttpError(404, 'not_found');
  return cacheableJson(request, toPublicQuiz(quiz), { cacheControl: PUBLIC_CACHE, headers: cors });
}

/**
 * 全問の回答を一括で受け取り、サーバー側で採点する。
 * 正解と解説は、この採点結果としてのみ返す。
 */
async function submitAttempt(request, { env, ctx, cors, params }) {
  assertSlug(params.slug);
  await enforceAttemptRateLimit(request, env, params.slug);
  const body = await readJson(request, ATTEMPT_MAX_BYTES);

  const quiz = await findPublishedQuizBySlug(env.DB, params.slug);
  if (!quiz) throw new HttpError(404, 'not_found');

  const { answers } = validateAnswers(body, quiz.questions.length);
  const details = quiz.questions.map((question, index) => ({
    selectedIndex: answers[index],
    correctIndex: question.correctIndex,
    correct: answers[index] === question.correctIndex,
    explanation: question.explanation
  }));
  const score = details.filter(detail => detail.correct).length;

  // 集計用の記録は応答を待たせずに行う。失敗しても採点結果は返す。
  ctx.waitUntil(
    recordAttempt(env.DB, { quizId: quiz.id, contentVersion: quiz.contentVersion, score, total: details.length, answers }).catch(error =>
      console.error(JSON.stringify({ event: 'attempt_record_failed', message: String(error?.message ?? error) }))
    )
  );

  return json({ score, total: details.length, details }, { status: 201, headers: cors });
}

async function health(_request, { env, cors }) {
  return json({ ok: true, environment: env.ENVIRONMENT }, { headers: { ...cors, 'Cache-Control': 'no-cache' } });
}

export const publicRouter = createRouter([
  ['GET', '/health', health],
  ['GET', '/v1/quizzes', listQuizzes],
  ['GET', '/v1/quizzes/:slug', getQuiz],
  ['POST', '/v1/quizzes/:slug/attempts', submitAttempt]
]);

/** 許可した公開画面の Origin にだけ CORS を返す。管理APIには CORS を付けない。 */
export function corsHeaders(request, env) {
  const headers = { Vary: 'Origin' };
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '7200';
  }
  return headers;
}
