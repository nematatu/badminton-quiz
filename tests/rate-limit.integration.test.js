/**
 * レート制限の結合テスト（Workers Rate Limiting の binding を有効にした Miniflare）。
 * 本番は 20 回 / 60 秒。ここでは上限を 3 回にして、超えた時の応答を確かめる。
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApiWorker } from './helpers/worker.js';

const WEB_ORIGIN = 'https://quiz.test';
const SLUG = 'badminton-basics-sample';
const LIMIT = 3;

let mf;

before(async () => {
  ({ mf } = await startApiWorker({
    bindings: { ALLOWED_ORIGINS: WEB_ORIGIN },
    ratelimits: { ATTEMPT_RATE_LIMIT: { namespace_id: '1001', simple: { limit: LIMIT, period: 60 } } }
  }));
});

after(() => mf?.dispose());

const start = (ip, slug = SLUG) =>
  mf.dispatchFetch(`https://api.test/v1/quizzes/${slug}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN, 'CF-Connecting-IP': ip },
    body: '{}'
  });

test('同じ接続元からの挑戦の開始は上限を超えると 429 と Retry-After を返す（CORS 付き）', async () => {
  for (let index = 0; index < LIMIT; index += 1) {
    const response = await start('203.0.113.10');
    assert.equal(response.status, 201, `${index + 1} 回目`);
    await response.arrayBuffer();
  }
  const limited = await start('203.0.113.10');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
  // 画面が理由を表示できるよう、エラーにも CORS ヘッダーが付く
  assert.equal(limited.headers.get('Access-Control-Allow-Origin'), WEB_ORIGIN);
  assert.deepEqual(await limited.json(), { error: 'rate_limited' });
});

test('上限は接続元ごと・クイズごとに数える', async () => {
  const otherClient = await start('203.0.113.20');
  assert.equal(otherClient.status, 201, '別の接続元は影響を受けない');
  await otherClient.arrayBuffer();

  const otherQuiz = await start('203.0.113.10', 'no-such-quiz');
  assert.equal(otherQuiz.status, 404, '別のクイズは上限に達しておらず、存在確認まで進む');
  await otherQuiz.arrayBuffer();
});

test('採点の送信は挑戦の開始とは別に数える', async () => {
  const response = await mf.dispatchFetch(`https://api.test/v1/quizzes/${SLUG}/attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
    body: '{}'
  });
  // 開始の上限に達した接続元でも、送信は上限前なので入力検証（受付トークン無し）まで進む
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_session' });
});
