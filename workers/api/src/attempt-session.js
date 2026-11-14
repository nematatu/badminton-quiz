import { HttpError } from './http.js';

/**
 * 回答の受付トークン。
 *
 * 「はじめる」の時点でサーバーが発行し、採点時に検証する。これにより:
 * - 回答中にクイズが編集されたら、新しい問題で誤って採点せずに 409 quiz_updated を返す
 * - 制限時間（＋通信の猶予）を過ぎた送信を 409 attempt_expired で拒否する（時間制限をサーバーでも守る）
 * - トークンの sid を attempts.session_id（一意）に保存し、同じ挑戦の再送信を拒否する
 * - 選択肢を入れ替えて出題したか（sh）を覚え、採点時に同じ並び順で元の位置へ戻す
 *   （回答中に設定が変わっても、見せた順番で採点できる）
 *
 * 形式: base64url(JSON payload) "." base64url(HMAC-SHA256(payload))
 * 鍵は Worker の secret `ATTEMPT_TOKEN_SECRET`（32 文字以上）。
 */

export const SUBMIT_GRACE_MS = 15_000;
export const UNTIMED_SESSION_MS = 24 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();
const keys = new Map();

function signingKey(env) {
  const secret = env.ATTEMPT_TOKEN_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(JSON.stringify({ event: 'attempt_secret_misconfigured' }));
    throw new HttpError(500, 'internal_error');
  }
  if (!keys.has(secret)) {
    keys.set(secret, crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  }
  return keys.get(secret);
}

const toBase64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

/** @returns {Promise<{ token: string, expiresAt: string, sessionId: string, shuffle: boolean }>} */
export async function issueSession(env, quiz, now = Date.now()) {
  const expires = now + (quiz.timeLimitSeconds ? quiz.timeLimitSeconds * 1000 + SUBMIT_GRACE_MS : UNTIMED_SESSION_MS);
  const sessionId = crypto.randomUUID();
  const shuffle = Boolean(quiz.shuffleOptions);
  const claims = { sid: sessionId, slug: quiz.slug, cv: quiz.contentVersion, iat: now, exp: expires, ...(shuffle ? { sh: 1 } : {}) };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload)));
  return { token: `${payload}.${toBase64Url(signature)}`, expiresAt: new Date(expires).toISOString(), sessionId, shuffle };
}

/**
 * トークンを検証し、セッションID と、選択肢を入れ替えて出題したかを返す。
 * @returns {Promise<{ sessionId: string, shuffle: boolean }>}
 */
export async function verifySession(env, token, quiz, now = Date.now()) {
  const invalid = () => new HttpError(400, 'invalid_session');
  if (typeof token !== 'string' || token.length > 1024) throw invalid();
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) throw invalid();

  let claims;
  try {
    // crypto.subtle.verify は比較を定数時間で行う。
    const valid = await crypto.subtle.verify('HMAC', await signingKey(env), fromBase64Url(signature), encoder.encode(payload));
    if (!valid) throw invalid();
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch (error) {
    if (error instanceof HttpError && error.status === 500) throw error;
    throw invalid();
  }

  if (claims?.slug !== quiz.slug || typeof claims.sid !== 'string' || !Number.isFinite(claims.exp)) throw invalid();
  if (claims.cv !== quiz.contentVersion) throw new HttpError(409, 'quiz_updated');
  if (now > claims.exp) throw new HttpError(409, 'attempt_expired');
  return { sessionId: claims.sid, shuffle: claims.sh === 1 };
}
