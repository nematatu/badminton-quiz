/**
 * 管理画面の `/api/*` を、Service Binding 経由で qraft-api の AdminApi へ中継する。
 *
 * - 状態を変えるリクエストは同一オリジンからのものだけ通す（CSRF 対策）。
 * - 転送するヘッダーは許可リスト方式。Cookie や接続元IPは API へ渡さない。
 * - Cloudflare Access が付ける JWT（Cf-Access-Jwt-Assertion）は渡し、
 *   API 側で改めて署名検証する。
 */

const FORWARDED_HEADERS = ['accept', 'content-type', 'content-length', 'cf-access-jwt-assertion'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isSameOrigin(request) {
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite) return fetchSite === 'same-origin';
  // Sec-Fetch-Site を送らない古いブラウザ向け。Origin が無ければ拒否する。
  return request.headers.get('Origin') === new URL(request.url).origin;
}

function reject(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

export async function onRequest({ request, env, params }) {
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) return reject(403, 'forbidden_origin');

  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const target = new URL(`/admin/${segments.map(encodeURIComponent).join('/')}`, 'https://admin-api.internal');
  target.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  // duplex は本文をストリームのまま転送するための指定（Node の fetch で必須、Workers では無視される）。
  // Workers の型定義に無い項目なので、型チェックの対象から外す。
  const init = /** @type {RequestInit} */ (/** @type {unknown} */ ({
    method: request.method,
    headers,
    body: SAFE_METHODS.has(request.method) ? null : request.body,
    duplex: 'half',
    redirect: 'manual'
  }));
  return env.API.fetch(new Request(target, init));
}
