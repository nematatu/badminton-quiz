import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { authenticateAdmin, resetJwksCache } from '../workers/api/src/auth.js';
import { AUDIENCE, ISSUER, createSigner } from './helpers/access.js';

const env = { ACCESS_TEAM_DOMAIN: ISSUER, ACCESS_AUD: AUDIENCE, ENVIRONMENT: 'production' };
const realFetch = globalThis.fetch;
let published = [];
let jwksRequests = 0;

beforeEach(() => {
  resetJwksCache();
  jwksRequests = 0;
  globalThis.fetch = async url => {
    assert.equal(String(url), `${ISSUER}/cdn-cgi/access/certs`);
    jwksRequests += 1;
    return Response.json({ keys: published.map(signer => signer.jwk) });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const request = token => new Request('https://admin.test/admin/quizzes', { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });
const unauthorized = { status: 401, code: 'unauthorized' };

test('正しい Access JWT なら管理者の識別子を返す', async () => {
  const signer = createSigner();
  published = [signer];
  const identity = await authenticateAdmin(request(signer.sign()), env);
  assert.deepEqual(identity, { actor: 'admin@example.test', email: 'admin@example.test', sub: 'admin-1' });
});

test('トークン欠落・改ざん・不正なクレームは 401', async () => {
  const signer = createSigner();
  published = [signer];
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(authenticateAdmin(request(null), env), unauthorized);
  await assert.rejects(authenticateAdmin(request('not-a-jwt'), env), unauthorized);
  await assert.rejects(authenticateAdmin(request('a.b.c'), env), unauthorized);
  const [header, , signature] = signer.sign().split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ iss: ISSUER, aud: AUDIENCE, sub: 'attacker', exp: now + 60 })).toString('base64url');
  await assert.rejects(authenticateAdmin(request(`${header}.${forgedPayload}.${signature}`), env), unauthorized);
  await assert.rejects(authenticateAdmin(request(signer.sign({ iss: 'https://evil.example' })), env), unauthorized);
  await assert.rejects(authenticateAdmin(request(signer.sign({ aud: ['other-app'] })), env), unauthorized);
  await assert.rejects(authenticateAdmin(request(signer.sign({ exp: now - 120 })), env), unauthorized);
  await assert.rejects(authenticateAdmin(request(signer.sign({ exp: undefined })), env), unauthorized);
  await assert.rejects(authenticateAdmin(request(signer.sign({ nbf: now + 600 })), env), unauthorized);
  await assert.rejects(authenticateAdmin(request(signer.sign({}, { alg: 'HS256' })), env), unauthorized);
});

test('JWKS はキャッシュし、未知の kid の時だけ取り直す（鍵ローテーション対応）', async () => {
  const oldKey = createSigner('old');
  published = [oldKey];
  await authenticateAdmin(request(oldKey.sign()), env);
  await authenticateAdmin(request(oldKey.sign()), env);
  assert.equal(jwksRequests, 1);

  const newKey = createSigner('new');
  published = [oldKey, newKey];
  // 直前に取得したばかり（30秒以内）なので、未知の kid でも即座には取り直さない。
  await assert.rejects(authenticateAdmin(request(newKey.sign()), env), unauthorized);
  assert.equal(jwksRequests, 1);
});

test('鍵ローテーション: 前回取得から時間が経っていれば未知の kid で再取得して通す', async t => {
  const oldKey = createSigner('old');
  published = [oldKey];
  await authenticateAdmin(request(oldKey.sign()), env);

  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  const later = realNow() + 60_000;
  Date.now = () => later;

  const newKey = createSigner('new');
  published = [newKey];
  const now = Math.floor(later / 1000);
  assert.equal((await authenticateAdmin(request(newKey.sign({ iat: now, exp: now + 300 })), env)).sub, 'admin-1');
  assert.equal(jwksRequests, 2);
});

test('Access の設定漏れや http の issuer は拒否側に倒す', async () => {
  const signer = createSigner();
  published = [signer];
  await assert.rejects(authenticateAdmin(request(signer.sign()), { ...env, ACCESS_AUD: '' }), { status: 500 });
  await assert.rejects(authenticateAdmin(request(signer.sign()), { ...env, ACCESS_TEAM_DOMAIN: 'http://insecure.test' }), { status: 500 });
});

test('JWKS を取得できない時は 503（認証エラーではない）で、次のリクエストで取り直す', async () => {
  const signer = createSigner();
  published = [signer];
  globalThis.fetch = async () => {
    jwksRequests += 1;
    return new Response('upstream error', { status: 502 });
  };
  await assert.rejects(authenticateAdmin(request(signer.sign()), env), error => error.status === 503 && error.headers['Retry-After'] === '5');

  // 失敗を記憶しない（復旧したらすぐ使える）
  globalThis.fetch = async () => {
    jwksRequests += 1;
    return Response.json({ keys: [signer.jwk] });
  };
  assert.equal((await authenticateAdmin(request(signer.sign()), env)).sub, 'admin-1');
  assert.equal(jwksRequests, 2);
});

test('JWKS に壊れた鍵や RSA 以外の鍵が混ざっていても、正しい鍵で検証できる', async () => {
  const signer = createSigner('good');
  published = [
    { jwk: { kty: 'RSA', kid: 'broken', n: '!!!', e: 'AQAB' } },
    { jwk: { kty: 'EC', kid: 'ec-key', crv: 'P-256', x: 'a', y: 'b' } },
    { jwk: { kty: 'RSA' } },
    signer
  ];
  assert.equal((await authenticateAdmin(request(signer.sign()), env)).sub, 'admin-1');
  await assert.rejects(authenticateAdmin(request(createSigner('broken').sign()), env), unauthorized);
});
