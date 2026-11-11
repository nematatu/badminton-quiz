import { HttpError } from './http.js';

/**
 * 回答送信の連打・総当たりを抑える。
 *
 * Workers Rate Limiting はロケーション単位・結果整合なので厳密な上限ではない。
 * 外側の WAF / Bot 対策と組み合わせる前提の「最初の防御線」として使う。
 * binding が無い環境（ローカル等）では何もしない。
 */
export async function enforceAttemptRateLimit(request, env, quizSlug) {
  if (!env.ATTEMPT_RATE_LIMIT) return;
  const client = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.ATTEMPT_RATE_LIMIT.limit({ key: `${quizSlug}:${client}` });
  if (!success) throw new HttpError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });
}
