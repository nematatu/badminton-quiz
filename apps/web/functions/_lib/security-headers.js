/**
 * Pages の `_headers` は Functions のレスポンスには適用されない。
 * そのため Functions が返す HTML には、ここで同じヘッダーを付ける。
 * `public/_headers` の `/*` ブロックと一致していることを tests/web-share.test.js が確認する。
 */
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.quiz.example.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
  'Strict-Transport-Security': "max-age=31536000; includeSubDomains",
  'X-Content-Type-Options': "nosniff",
  'X-Frame-Options': "DENY",
  'Referrer-Policy': "strict-origin-when-cross-origin",
  'Permissions-Policy': "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  'Cross-Origin-Opener-Policy': "same-origin",
  'Cache-Control': "no-cache",
});
