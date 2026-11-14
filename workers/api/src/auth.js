import { HttpError } from './http.js';

/**
 * Cloudflare Access が発行した JWT を検証し、管理者の識別子を返す。
 *
 * - 署名は RS256 のみ受け付ける。
 * - iss / aud / exp は必須。nbf・iat は存在すれば検証する。
 * - JWKS は 1 時間キャッシュし、未知の kid を受け取った時だけ
 *   （直近 30 秒以内に更新していなければ）強制的に取り直す。これで
 *   Access の鍵ローテーション直後も 401 にならない。
 */

const CLOCK_SKEW_SECONDS = 30;
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_FORCE_REFRESH_INTERVAL_MS = 30 * 1000;
const JWKS_TIMEOUT_MS = 3000;

const unauthorized = () => new HttpError(401, 'unauthorized');

/** isolate 内で共有する公開鍵キャッシュ。kid → CryptoKey。 */
const jwks = { issuer: '', keys: new Map(), fetchedAt: 0, pending: null };

/** テスト用。 */
export function resetJwksCache() {
  Object.assign(jwks, { issuer: '', keys: new Map(), fetchedAt: 0, pending: null });
}

/**
 * @param {Request} request
 * @param {{ ACCESS_TEAM_DOMAIN?: string, ACCESS_AUD?: string, ENVIRONMENT?: string }} env
 * @returns {Promise<{ actor: string, email?: string, sub: string }>}
 */
export async function authenticateAdmin(request, env) {
  const { issuer, audience } = accessConfig(env);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw unauthorized();

  const { header, payload, signingInput, signature } = decodeJwt(token);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw unauthorized();
  assertClaims(payload, { issuer, audience });

  const key = await signingKey(issuer, header.kid);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  if (!valid) throw unauthorized();

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  return { actor: email ?? payload.sub, email, sub: payload.sub };
}

function accessConfig(env) {
  const issuer = (env.ACCESS_TEAM_DOMAIN ?? '').replace(/\/+$/, '');
  const audience = env.ACCESS_AUD ?? '';
  const secureIssuer = issuer.startsWith('https://') || env.ENVIRONMENT === 'development';
  if (!issuer || !audience || !secureIssuer) {
    // 設定漏れは利用者のせいではないので 500。ただし必ず拒否側に倒す。
    console.error(JSON.stringify({ event: 'access_misconfigured' }));
    throw new HttpError(500, 'internal_error');
  }
  return { issuer, audience };
}

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized();
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    return {
      header: JSON.parse(decodeBase64UrlText(encodedHeader)),
      payload: JSON.parse(decodeBase64UrlText(encodedPayload)),
      signingInput: new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
      signature: decodeBase64Url(encodedSignature)
    };
  } catch {
    throw unauthorized();
  }
}

function assertClaims(payload, { issuer, audience }) {
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload?.aud) ? payload.aud : [payload?.aud];
  const ok =
    payload !== null &&
    typeof payload === 'object' &&
    payload.iss === issuer &&
    audiences.includes(audience) &&
    typeof payload.sub === 'string' &&
    payload.sub.length > 0 &&
    Number.isFinite(payload.exp) &&
    payload.exp > now - CLOCK_SKEW_SECONDS &&
    (payload.nbf === undefined || (Number.isFinite(payload.nbf) && payload.nbf <= now + CLOCK_SKEW_SECONDS)) &&
    (payload.iat === undefined || (Number.isFinite(payload.iat) && payload.iat <= now + CLOCK_SKEW_SECONDS));
  if (!ok) throw unauthorized();
}

async function signingKey(issuer, kid) {
  const now = Date.now();
  const stale = jwks.issuer !== issuer || now - jwks.fetchedAt > JWKS_TTL_MS;
  if (stale) await refreshJwks(issuer);

  let key = jwks.keys.get(kid);
  if (!key && Date.now() - jwks.fetchedAt > JWKS_FORCE_REFRESH_INTERVAL_MS) {
    await refreshJwks(issuer);
    key = jwks.keys.get(kid);
  }
  if (!key) throw unauthorized();
  return key;
}

/** 同時に来たリクエストでも JWKS の取得は 1 回にまとめる。 */
function refreshJwks(issuer) {
  jwks.pending ??= fetchJwks(issuer).finally(() => {
    jwks.pending = null;
  });
  return jwks.pending;
}

async function fetchJwks(issuer) {
  let body;
  try {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    body = await response.json();
  } catch (error) {
    console.error(JSON.stringify({ event: 'jwks_unavailable', message: String(error?.message ?? error) }));
    throw new HttpError(503, 'internal_error', { headers: { 'Retry-After': '5' } });
  }

  const keys = new Map();
  for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
    if (jwk?.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
    try {
      const { kid, kty, n, e } = jwk;
      const key = await crypto.subtle.importKey('jwk', { kty, n, e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      keys.set(kid, key);
    } catch {
      // 壊れた鍵は無視し、他の鍵で検証を続ける。
    }
  }
  Object.assign(jwks, { issuer, keys, fetchedAt: Date.now() });
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('invalid base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

function decodeBase64UrlText(value) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(decodeBase64Url(value));
}
