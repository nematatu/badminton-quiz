import { API_ORIGIN } from '../config.js';

export class ApiError extends Error {
  constructor(code, status, detail) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** 応答が無いまま待たせ続けないための上限。超えたら通信エラーとして扱う。 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 公開APIの呼び出し。GET には Content-Type を付けない（CORS の preflight を発生させない）。
 */
async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API_ORIGIN.replace(/\/$/, '')}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new ApiError('network_error', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error ?? 'internal_error', response.status, data?.detail);
  return data;
}

/** 公開一覧の 1 ページ。cursor は前ページの nextCursor。 */
export const fetchQuizzes = (cursor = null) => request(`/v1/quizzes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);

export const fetchQuiz = slug => request(`/v1/quizzes/${encodeURIComponent(slug)}`);

/** 挑戦を開始し、採点に必要な受付トークンと、そのトークンに対応する問題を受け取る。 */
export const startSession = slug => request(`/v1/quizzes/${encodeURIComponent(slug)}/sessions`, { method: 'POST', body: {} });

export const submitAttempt = (slug, { token, answers, timedOut }) =>
  request(`/v1/quizzes/${encodeURIComponent(slug)}/attempts`, { method: 'POST', body: { token, answers, timedOut } });
