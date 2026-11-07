import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../apps/admin/functions/api/[[path]].js';

/** Service Binding の代わりに、転送されたリクエストを記録する。 */
function context(request, path) {
  const forwarded = [];
  return {
    forwarded,
    context: {
      request,
      params: { path },
      env: { API: { fetch: async upstream => (forwarded.push(upstream), new Response('{}', { status: 200 })) } }
    }
  };
}

test('同一オリジンの更新は許可ヘッダーだけ付けて AdminApi へ転送する', async () => {
  const request = new Request('https://admin.test/api/quizzes/abc?x=1', {
    method: 'PUT',
    body: '{}',
    headers: {
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin',
      'Cf-Access-Jwt-Assertion': 'jwt',
      Cookie: 'CF_Authorization=secret',
      'X-Forwarded-For': '203.0.113.1',
      Authorization: 'Bearer something'
    }
  });
  const { forwarded, context: ctx } = context(request, ['quizzes', 'abc']);
  assert.equal((await onRequest(ctx)).status, 200);
  const [upstream] = forwarded;
  assert.equal(upstream.url, 'https://admin-api.internal/admin/quizzes/abc?x=1');
  assert.equal(upstream.headers.get('cf-access-jwt-assertion'), 'jwt');
  assert.equal(upstream.headers.get('cookie'), null);
  assert.equal(upstream.headers.get('x-forwarded-for'), null);
  assert.equal(upstream.headers.get('authorization'), null);
});

test('別オリジンからの更新は 403（CSRF 対策）', async () => {
  for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { Origin: 'https://evil.test' }, {}]) {
    const request = new Request('https://admin.test/api/quizzes', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', ...headers } });
    const { forwarded, context: ctx } = context(request, ['quizzes']);
    const response = await onRequest(ctx);
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(forwarded.length, 0);
  }
});

test('Sec-Fetch-Site が無い古いブラウザは Origin で判定する', async () => {
  const request = new Request('https://admin.test/api/quizzes', { method: 'POST', body: '{}', headers: { Origin: 'https://admin.test' } });
  const { context: ctx } = context(request, ['quizzes']);
  assert.equal((await onRequest(ctx)).status, 200);
});

test('パス区切りを含むセグメントはエンコードして転送する', async () => {
  const request = new Request('https://admin.test/api/quizzes/a%2F..%2Fb');
  const { forwarded, context: ctx } = context(request, ['quizzes', 'a/../b']);
  await onRequest(ctx);
  assert.equal(new URL(forwarded[0].url).pathname, '/admin/quizzes/a%2F..%2Fb');
});
