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

/**
 * 公開APIの呼び出し。GET には Content-Type を付けない（CORS の preflight を発生させない）。
 */
async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API_ORIGIN.replace(/\/$/, '')}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError('network_error', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error ?? 'internal_error', response.status, data?.detail);
  return data;
}

export const fetchQuizzes = () => request('/v1/quizzes').then(data => data.quizzes);

export const fetchQuiz = slug => request(`/v1/quizzes/${encodeURIComponent(slug)}`);

export const submitAttempt = (slug, { answers, timedOut }) =>
  request(`/v1/quizzes/${encodeURIComponent(slug)}/attempts`, { method: 'POST', body: { answers, timedOut } });
