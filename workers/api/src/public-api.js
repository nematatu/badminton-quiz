import { SLUG_PATTERN } from '../../../packages/shared/src/contracts.js';
import { issueSession, verifySession } from './attempt-session.js';
import { decodeCursor as decodeListCursor, encodeCursor as encodeListCursor, isTimestamp } from './cursor.js';
import { HttpError, cacheableJson, json, readJson } from './http.js';
import { enforceAttemptRateLimit } from './rate-limit.js';
import { findPublishedQuizBySlug, listPublishedQuizzes, recordAttempt, toPublicQuiz } from './repository.js';
import { createRouter } from './router.js';
import { optionOrders } from './shuffle.js';
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

/** 公開一覧のカーソル: [publishedAt, slug]。 */
export const encodeCursor = ({ publishedAt, slug }) => encodeListCursor([publishedAt, slug]);

export function decodeCursor(cursor) {
  const [publishedAt, slug] = decodeListCursor(cursor, ([time, value]) => isTimestamp(time) && typeof value === 'string' && SLUG_PATTERN.test(value));
  return { publishedAt, slug };
}

async function listQuizzes(request, { env, cors }) {
  const cursor = new URL(request.url).searchParams.get('cursor');
  const { quizzes, total, next } = await listPublishedQuizzes(env.DB, { after: cursor ? decodeCursor(cursor) : null });
  return cacheableJson(request, { quizzes, total, nextCursor: next ? encodeCursor(next) : null }, { cacheControl: PUBLIC_CACHE, headers: cors });
}

async function getQuiz(request, { env, cors, params }) {
  assertSlug(params.slug);
  const quiz = await findPublishedQuizBySlug(env.DB, params.slug);
  if (!quiz) throw new HttpError(404, 'not_found');
  return cacheableJson(request, toPublicQuiz(quiz), { cacheControl: PUBLIC_CACHE, headers: cors });
}

/**
 * 挑戦の開始。採点時に必要な受付トークンを発行する（attempt-session.js）。
 * トークンと同じ版の問題を一緒に返し、画面はこの問題で回答させる
 * （キャッシュされた古い問題と新しい版のトークンが食い違わないように）。
 */
async function startSession(request, { env, cors, params }) {
  assertSlug(params.slug);
  await enforceAttemptRateLimit(request, env, `${params.slug}:start`);
  const quiz = await findPublishedQuizBySlug(env.DB, params.slug);
  if (!quiz) throw new HttpError(404, 'not_found');
  const { token, expiresAt, sessionId, shuffle } = await issueSession(env, quiz);
  const orders = shuffle ? await optionOrders(sessionId, quiz.questions.length) : null;
  return json({ token, expiresAt, quiz: toPublicQuiz(quiz, orders) }, { status: 201, headers: cors });
}

/**
 * 全問の回答を一括で受け取り、サーバー側で採点する。
 * 正解と解説は、この採点結果としてのみ返す。受付トークン 1 つにつき 1 回だけ。
 */
async function submitAttempt(request, { env, cors, params }) {
  assertSlug(params.slug);
  await enforceAttemptRateLimit(request, env, params.slug);
  const body = await readJson(request, ATTEMPT_MAX_BYTES);

  const quiz = await findPublishedQuizBySlug(env.DB, params.slug);
  if (!quiz) throw new HttpError(404, 'not_found');

  const { sessionId, shuffle } = await verifySession(env, body?.token, quiz);
  const { answers } = validateAnswers(body, quiz.questions.length);
  // 回答は「見せた順番」での位置。入れ替えて出題した場合は元の位置に戻して採点・記録する
  // （記録と集計は常に元の位置なので、入れ替えの有無に関係なく同じ意味になる）。
  const orders = shuffle ? await optionOrders(sessionId, quiz.questions.length) : null;
  const toOriginal = (index, answer) => (orders && answer >= 0 ? orders[index][answer] : answer);
  const toDisplayed = (index, original) => (orders ? orders[index].indexOf(original) : original);
  const originalAnswers = answers.map((answer, index) => toOriginal(index, answer));
  const details = quiz.questions.map((question, index) => ({
    selectedIndex: answers[index],
    correctIndex: toDisplayed(index, question.correctIndex),
    correct: originalAnswers[index] === question.correctIndex,
    explanation: question.explanation
  }));
  const score = details.filter(detail => detail.correct).length;

  // 記録が「この挑戦の採点は 1 回だけ」の保証を兼ねるので、応答の前に書き込む。
  const { recorded, correctRates } = await recordAttempt(env.DB, {
    quizId: quiz.id,
    sessionId,
    contentVersion: quiz.contentVersion,
    score,
    total: details.length,
    answers: originalAnswers,
    correct: details.map(detail => detail.correct)
  });
  if (!recorded) throw new HttpError(409, 'attempt_already_submitted');

  // みんなの正答率（今回の回答を含む）。回答が少ない設問は null
  const withRates = details.map((detail, index) => ({ ...detail, correctRate: correctRates[index] === null ? null : Math.round(correctRates[index] * 1000) / 1000 }));
  return json({ score, total: details.length, details: withRates }, { status: 201, headers: cors });
}

async function health(_request, { env, cors }) {
  return json({ ok: true, environment: env.ENVIRONMENT }, { headers: { ...cors, 'Cache-Control': 'no-cache' } });
}

export const publicRouter = createRouter([
  ['GET', '/health', health],
  ['GET', '/v1/quizzes', listQuizzes],
  ['GET', '/v1/quizzes/:slug', getQuiz],
  ['POST', '/v1/quizzes/:slug/sessions', startSession],
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
