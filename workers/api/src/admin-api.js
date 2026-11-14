import { authenticateAdmin } from './auth.js';
import { HttpError, json, noContent, readJson } from './http.js';
import { LIMITS, QUIZ_STATUS } from '../../../packages/shared/src/contracts.js';
import { decodeCursor, encodeCursor, isTimestamp } from './cursor.js';
import { changeQuizStatus, createQuiz, deleteQuiz, findQuizById, getQuizStats, listAllQuizzes, listQuizHistory, updateQuiz } from './repository.js';
import { createRouter } from './router.js';
import { validateQuizInput, validateStatusChange, validateVersion } from './validation.js';

/**
 * 管理API。Worker の名前付きエントリポイント `AdminApi` からだけ呼ばれ、
 * 公開ドメインからは到達できない（Admin Pages の Service Binding 専用）。
 * それでも多層防御として、毎回 Cloudflare Access の JWT を検証する。
 */

const QUIZ_MAX_BYTES = 256 * 1024;

const conflict = currentVersion => new HttpError(409, 'edit_conflict', { detail: { currentVersion } });

/** タイトルから URL 用の slug を作る。末尾に ID の一部を付けて一意にする。 */
export function slugFor(title, id) {
  const words = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // UTF-16 単位で切るとサロゲートペア（𠮷 など）の途中で切れるため、コードポイント単位で切る。
  const base = Array.from(words).slice(0, 48).join('').replace(/-+$/, '');
  const suffix = id.replace(/-/g, '').slice(0, 8);
  return base ? `${base}-${suffix}` : `quiz-${suffix}`;
}

const SEARCH_MAX_LENGTH = 80;
/** @type {readonly string[]} */
const STATUSES = Object.values(QUIZ_STATUS);
const isQuizId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);

/**
 * 公開中のクイズの共有URL（公開画面の /q/<slug>。OGP 付きで X などにもそのまま貼れる）。
 * 公開中でない、または PUBLIC_SITE_ORIGIN が未設定・不正なら null。
 * @returns {string | null}
 */
export function publicUrlFor(env, quiz) {
  if (quiz.status !== QUIZ_STATUS.PUBLISHED) return null;
  let origin;
  try {
    origin = new URL(env.PUBLIC_SITE_ORIGIN ?? '').origin;
  } catch {
    return null;
  }
  return /^https?:/.test(origin) ? `${origin}/q/${encodeURIComponent(quiz.slug)}` : null;
}

const withPublicUrl = (env, quiz) => ({ ...quiz, publicUrl: publicUrlFor(env, quiz) });

/** GET /admin/quizzes?q=&status=&cursor= */
async function list(request, { env }) {
  const params = new URL(request.url).searchParams;
  const status = params.get('status') || null;
  if (status !== null && !STATUSES.includes(status)) throw new HttpError(400, 'invalid_status');
  const keyword = (params.get('q') ?? '').trim();
  if (Array.from(keyword).length > SEARCH_MAX_LENGTH) throw new HttpError(400, 'invalid_search');
  const cursor = params.get('cursor');
  const after = cursor ? decodeCursor(cursor, ([time, id]) => isTimestamp(time) && isQuizId(id)) : null;

  const page = await listAllQuizzes(env.DB, { status, keyword, after: after && { updatedAt: after[0], id: after[1] } });
  return json({
    quizzes: page.quizzes.map(quiz => withPublicUrl(env, quiz)),
    total: page.total,
    counts: page.counts,
    nextCursor: page.next ? encodeCursor([page.next.updatedAt, page.next.id]) : null
  });
}

async function create(request, { env, identity }) {
  const input = validateQuizInput(await readJson(request, QUIZ_MAX_BYTES));
  const id = await createQuiz(env.DB, { input, actor: identity.actor, slug: quizId => slugFor(input.title, quizId) });
  return json(withPublicUrl(env, await findQuizById(env.DB, id)), { status: 201 });
}

async function show(_request, { env, params }) {
  const quiz = await findQuizById(env.DB, params.id);
  if (!quiz) throw new HttpError(404, 'not_found');
  return json(withPublicUrl(env, quiz));
}

async function update(request, { env, identity, params }) {
  const body = await readJson(request, QUIZ_MAX_BYTES);
  const version = validateVersion(body);
  const input = validateQuizInput(body);
  const result = await updateQuiz(env.DB, { id: params.id, version, input, actor: identity.actor });
  if (result === 'not_found') throw new HttpError(404, 'not_found');
  if (result !== 'updated') throw conflict(result.conflict);
  return json(withPublicUrl(env, await findQuizById(env.DB, params.id)));
}

async function changeStatus(request, { env, identity, params }) {
  const { status, version } = validateStatusChange(await readJson(request, 1024));
  const result = await changeQuizStatus(env.DB, { id: params.id, version, status, actor: identity.actor });
  if (result === 'not_found') throw new HttpError(404, 'not_found');
  if (typeof result === 'object') throw conflict(result.conflict);
  const quiz = await findQuizById(env.DB, params.id);
  return json({ id: quiz.id, status: quiz.status, version: quiz.version, publicUrl: publicUrlFor(env, quiz) });
}

/** 既存のクイズを下書きとして複製する。タイトルには「（コピー）」を付ける。 */
export function copyTitle(title) {
  const suffix = '（コピー）';
  const room = LIMITS.title - Array.from(suffix).length;
  return `${Array.from(title).slice(0, room).join('')}${suffix}`;
}

async function duplicate(_request, { env, identity, params }) {
  const source = await findQuizById(env.DB, params.id);
  if (!source) throw new HttpError(404, 'not_found');
  const input = {
    title: copyTitle(source.title),
    description: source.description,
    timeLimitSeconds: source.timeLimitSeconds,
    questions: source.questions.map(({ prompt, options, correctIndex, explanation }, position) => ({ position, prompt, options, correctIndex, explanation }))
  };
  const id = await createQuiz(env.DB, { input, actor: identity.actor, slug: quizId => slugFor(input.title, quizId), duplicatedFrom: source.id });
  return json(withPublicUrl(env, await findQuizById(env.DB, id)), { status: 201 });
}

async function stats(_request, { env, params }) {
  const quiz = await findQuizById(env.DB, params.id);
  if (!quiz) throw new HttpError(404, 'not_found');
  return json(await getQuizStats(env.DB, quiz));
}

async function history(_request, { env, params }) {
  return json({ events: await listQuizHistory(env.DB, params.id) });
}

async function remove(_request, { env, identity, params }) {
  const result = await deleteQuiz(env.DB, { id: params.id, actor: identity.actor });
  if (result === 'not_found') throw new HttpError(404, 'not_found');
  if (result === 'published') throw new HttpError(409, 'quiz_published');
  return noContent();
}

const router = createRouter([
  ['GET', '/admin/quizzes', list],
  ['POST', '/admin/quizzes', create],
  ['GET', '/admin/quizzes/:id', show],
  ['PUT', '/admin/quizzes/:id', update],
  ['DELETE', '/admin/quizzes/:id', remove],
  ['POST', '/admin/quizzes/:id/status', changeStatus],
  ['POST', '/admin/quizzes/:id/duplicate', duplicate],
  ['GET', '/admin/quizzes/:id/stats', stats],
  ['GET', '/admin/quizzes/:id/history', history]
]);

/** 認証してからルーティングする。未認証ではルートの有無すら分からない。 */
export async function handleAdmin(request, context) {
  const identity = await authenticateAdmin(request, context.env);
  return router(request, { ...context, identity });
}
