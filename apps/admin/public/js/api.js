export class ApiError extends Error {
  constructor(code, status, detail) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * 管理APIの呼び出し（同一オリジンの Pages Function `/api/*` 経由）。
 *
 * Cloudflare Access のセッションが切れると、fetch はログイン画面への
 * リダイレクトを受け取る。追従せず「要再ログイン」として扱う。
 */
/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 */
async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new ApiError('network_error', 0);
  }
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.error === 'forbidden_origin' ? 'forbidden_origin' : 'unauthorized', response.status);
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error ?? 'internal_error', response.status, data?.detail);
  return data;
}

/** 一覧の 1 ページ。q（検索語）・status・cursor（前ページの nextCursor）は省略可。 */
export function listQuizzes({ q = '', status = '', cursor = '' } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return request(`quizzes${query ? `?${query}` : ''}`);
}
export const getQuiz = id => request(`quizzes/${encodeURIComponent(id)}`);
export const createQuiz = quiz => request('quizzes', { method: 'POST', body: quiz });
export const updateQuiz = (id, quiz) => request(`quizzes/${encodeURIComponent(id)}`, { method: 'PUT', body: quiz });
export const deleteQuiz = id => request(`quizzes/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const changeStatus = (id, status, version) => request(`quizzes/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status, version } });
export const duplicateQuiz = id => request(`quizzes/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
export const getStats = id => request(`quizzes/${encodeURIComponent(id)}/stats`);
export const getHistory = id => request(`quizzes/${encodeURIComponent(id)}/history`).then(data => data.events);
