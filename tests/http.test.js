import assert from 'node:assert/strict';
import test from 'node:test';
import { slugFor } from '../workers/api/src/admin-api.js';
import { HttpError, readJson } from '../workers/api/src/http.js';
import { createRouter } from '../workers/api/src/router.js';
import { SLUG_PATTERN } from '../packages/shared/src/contracts.js';

const post = (body, headers = { 'Content-Type': 'application/json' }) => new Request('https://api.test/', { method: 'POST', body, headers });

test('readJson: Content-Type と本文サイズを検証する', async () => {
  assert.deepEqual(await readJson(post('{"a":1}'), 100), { a: 1 });
  await assert.rejects(readJson(post('{}', { 'Content-Type': 'text/plain' }), 100), { status: 415 });
  await assert.rejects(readJson(post('{'), 100), { status: 400, code: 'invalid_json' });
  await assert.rejects(readJson(post(JSON.stringify({ a: 'x'.repeat(200) })), 100), { status: 413 });
});

test('readJson: Content-Length が無いストリームでも実バイト数で上限を判定する', async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(64)));
    }
  });
  const request = new Request('https://api.test/', { method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(readJson(request, 1000), { status: 413 });
});

test('router: パラメータを取り出し、メソッド違いは 405', async () => {
  const route = createRouter([
    ['GET', '/items/:id', (_request, { params }) => params.id],
    ['POST', '/items', () => 'created']
  ]);
  assert.equal(await route(new Request('https://api.test/items/%E3%81%82/'), {}), 'あ');
  await assert.rejects(route(new Request('https://api.test/items', { method: 'GET' }), {}), error => error instanceof HttpError && error.status === 405 && error.headers.Allow === 'POST');
  await assert.rejects(route(new Request('https://api.test/nothing'), {}), { status: 404 });
  await assert.rejects(route(new Request('https://api.test/items/%E3'), {}), { status: 404 });
});

test('slugFor: 日本語を含むタイトルから公開URL用の slug を作る', () => {
  const id = '1a2b3c4d-0000-4000-8000-000000000000';
  assert.equal(slugFor('日本の雑学 2026！', id), '日本の雑学-2026-1a2b3c4d');
  assert.equal(slugFor('々・𠮷野家', id), '々-𠮷野家-1a2b3c4d');
  assert.equal(slugFor('!!!', id), 'quiz-1a2b3c4d');
  // 48文字目がサロゲートペアでも途中で切れない
  assert.equal(slugFor(`${'a'.repeat(47)}𠮷𠮷`, id), `${'a'.repeat(47)}𠮷-1a2b3c4d`);
  for (const title of ['日本の雑学 2026！', 'A'.repeat(200), '!!!', `${'a'.repeat(47)}𠮷`, '𠮷'.repeat(60)]) {
    const slug = slugFor(title, id);
    assert.match(slug, SLUG_PATTERN);
    assert.doesNotThrow(() => encodeURIComponent(slug));
  }
});
