/** HTTP の入出力に関する共通処理。ルーティングや業務ロジックは持たない。 */

/** 利用者へ返してよい既知のエラー。message は API のエラーコードとして使う。 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {{ detail?: Record<string, unknown>, headers?: Record<string, string> }} [options]
   */
  constructor(status, code, { detail, headers } = {}) {
    super(code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.headers = headers;
  }
}

/** JSON API 共通のセキュリティヘッダー。JSON をHTMLとして解釈・埋め込みさせない。 */
const BASE_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Cache-Control': 'no-store'
});

export function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function noContent(headers = {}) {
  const { 'Content-Type': _, ...rest } = BASE_HEADERS;
  return new Response(null, { status: 204, headers: { ...rest, ...headers } });
}

export function errorResponse(error, headers = {}) {
  const body = { error: error.code, ...(error.detail ? { detail: error.detail } : {}) };
  return json(body, { status: error.status, headers: { ...headers, ...error.headers } });
}

/**
 * 公開してよい GET レスポンスを、内容ハッシュの ETag 付きで返す。
 * ブラウザが同じ ETag を持っていれば本文なしの 304 にする。
 */
export async function cacheableJson(request, data, { cacheControl, headers = {} }) {
  const body = JSON.stringify(data);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const etag = `"${toHex(new Uint8Array(digest).slice(0, 12))}"`;
  const cacheHeaders = { ...BASE_HEADERS, ...headers, 'Cache-Control': cacheControl, ETag: etag };
  if (request.headers.get('If-None-Match') === etag) {
    const { 'Content-Type': _, ...rest } = cacheHeaders;
    return new Response(null, { status: 304, headers: rest });
  }
  return new Response(body, { status: 200, headers: cacheHeaders });
}

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * JSON 本文を上限付きで読む。Content-Length が無い（chunked）場合も
 * 実際に読んだバイト数で上限を判定するので、巨大な本文でメモリを消費させない。
 */
export async function readJson(request, maxBytes) {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) throw new HttpError(415, 'json_required');

  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'payload_too_large');
  if (!request.body) throw new HttpError(400, 'invalid_json');

  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'payload_too_large');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** 末尾スラッシュを除いたパス。 */
export function pathnameOf(request) {
  return new URL(request.url).pathname.replace(/\/+$/, '') || '/';
}

/**
 * パスパラメータを安全に取り出す。不正なパーセントエンコードは 404 扱い。
 */
export function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(404, 'not_found');
  }
}
