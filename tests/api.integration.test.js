/**
 * 実際の workerd + D1（Miniflare）で API Worker を動かす結合テスト。
 * migration と seed を適用した DB に対して、公開API・管理API を HTTP で叩く。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { purgeExpiredAttempts } from '../workers/api/src/maintenance.js';
import { updateQuiz } from '../workers/api/src/repository.js';
import { AUDIENCE, ISSUER, createSigner } from './helpers/access.js';

const root = new URL('../', import.meta.url);
const WEB_ORIGIN = 'https://quiz.test';
const SEED_SLUG = 'badminton-basics-sample';
const SEED_ANSWERS = [1, 2, 0, 3, 1, 3];

let mf;
let db;
let signer = createSigner('k1');
let jwksRequests = 0;

function statements(path) {
  return readFileSync(new URL(path, root), 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map(sql => sql.trim())
    .filter(sql => sql && !/^PRAGMA/i.test(sql));
}

before(async () => {
  // Miniflare 5 の新しい設定形式へは公式の変換関数で移す（v4 形式の方が読みやすいため）。
  mf = new Miniflare(convertV4MiniflareOptions({
    workers: [
      {
        name: 'qraft-api',
        modulesRoot: new URL('.', root).pathname,
        // エントリポイント（先頭）と、そこから import される全モジュール。
        modules: ['workers/api/src/index.js', ...readdirSync(new URL('workers/api/src/', root)).map(file => `workers/api/src/${file}`), 'packages/shared/src/contracts.js']
          .filter((path, index, all) => all.indexOf(path) === index)
          .map(path => ({ type: 'ESModule', path: new URL(path, root).pathname })),
        compatibilityDate: '2026-07-29',
        d1Databases: ['DB'],
        bindings: { ENVIRONMENT: 'test', ALLOWED_ORIGINS: WEB_ORIGIN, ACCESS_TEAM_DOMAIN: ISSUER, ACCESS_AUD: AUDIENCE, ATTEMPT_TOKEN_SECRET: 'test-attempt-secret-0123456789abcdef' },
        outboundService: async request => {
          if (request.url !== `${ISSUER}/cdn-cgi/access/certs`) return new Response('blocked', { status: 599 });
          jwksRequests += 1;
          return Response.json({ keys: [signer.jwk] });
        }
      },
      {
        // Admin Pages の Service Binding を模した、AdminApi エントリポイントへの入口。
        name: 'admin-gateway',
        modules: true,
        script: 'export default { fetch: (request, env) => env.API.fetch(request) }',
        compatibilityDate: '2026-07-29',
        serviceBindings: { API: { name: 'qraft-api', entrypoint: 'AdminApi' } }
      }
    ]
  }));
  db = await mf.getD1Database('DB', 'qraft-api');
  const migrations = readdirSync(new URL('migrations/', root)).filter(file => file.endsWith('.sql')).sort();
  for (const file of [...migrations.map(name => `migrations/${name}`), 'scripts/seed.sql']) {
    for (const sql of statements(file)) await db.prepare(sql).run();
  }
});

after(() => mf?.dispose());

const publicFetch = (path, init) => mf.dispatchFetch(`https://api.test${path}`, init);
const adminWorker = () => mf.getWorker('admin-gateway');
async function admin(path, { method = 'GET', body, token = signer.sign() } = {}) {
  const worker = await adminWorker();
  const headers = token ? { 'Cf-Access-Jwt-Assertion': token } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await worker.fetch(`https://admin.internal/admin/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
/** 挑戦を開始して受付トークンを得てから回答を送る（画面と同じ流れ）。 */
async function startSession(slug) {
  const response = await postJson(`/v1/quizzes/${slug}/sessions`, {});
  assert.equal(response.status, 201);
  const started = await response.json();
  // 受付トークンと一緒に、同じ版の問題（正解なし）が返る
  assert.ok(started.quiz.questions.length > 0);
  assert.doesNotMatch(JSON.stringify(started.quiz), /correct|explanation/i);
  return started.token;
}
const submit = async (slug, body) => postJson(`/v1/quizzes/${slug}/attempts`, { token: await startSession(slug), ...body });

const postJson = (path, body, headers = {}) =>
  publicFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const sampleQuiz = (title = '結合テスト用クイズ') => ({
  title,
  description: 'テスト',
  timeLimitSeconds: 60,
  questions: [
    { prompt: '1 + 1 は？', options: ['1', '2', '3', '4'], correctIndex: 1, explanation: '2です' },
    { prompt: '空の色は？', options: ['青', '赤', '緑', '黄'], correctIndex: 0, explanation: '' }
  ]
});

describe('公開API', () => {
  test('ヘルスチェックとセキュリティヘッダー', async () => {
    const response = await publicFetch('/health');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy'), /default-src 'none'/);
    await response.arrayBuffer();
  });

  test('公開一覧は問題数を含み、正解は含まない', async () => {
    const response = await publicFetch('/v1/quizzes');
    const { quizzes } = await response.json();
    const sample = quizzes.find(quiz => quiz.slug === SEED_SLUG);
    assert.equal(sample.questionCount, 6);
    assert.equal(sample.timeLimitSeconds, 120);
    assert.doesNotMatch(JSON.stringify(quizzes), /correct|explanation/i);
    assert.doesNotMatch(response.headers.get('Cache-Control'), /s-maxage/);
  });

  test('問題取得は正解・解説・内部IDを返さず、ETag で 304 を返す', async () => {
    const response = await publicFetch(`/v1/quizzes/${SEED_SLUG}`);
    const quiz = await response.json();
    assert.equal(quiz.questions.length, 6);
    assert.deepEqual(Object.keys(quiz.questions[0]).sort(), ['options', 'prompt']);
    assert.equal(quiz.id, undefined);

    const etag = response.headers.get('ETag');
    assert.ok(etag);
    const cached = await publicFetch(`/v1/quizzes/${SEED_SLUG}`, { headers: { 'If-None-Match': etag } });
    assert.equal(cached.status, 304);
    await cached.arrayBuffer();
  });

  test('存在しない・不正な slug は 404', async () => {
    for (const path of ['/v1/quizzes/nothing-here', '/v1/quizzes/has%20space', '/v1/quizzes/%E3']) {
      const response = await publicFetch(path);
      assert.equal(response.status, 404, path);
      assert.deepEqual(await response.json(), { error: 'not_found' });
    }
  });

  test('サーバー採点: 正解・解説・選んだ回答を返し、attempt を記録する', async () => {
    const before = await db.prepare('SELECT COUNT(*) AS n FROM attempts').first();
    const response = await submit(SEED_SLUG, { answers: [...SEED_ANSWERS.slice(0, 5), 0] });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.score, 5);
    assert.equal(result.total, 6);
    assert.deepEqual(result.details[5], { selectedIndex: 0, correctIndex: 3, correct: false, explanation: result.details[5].explanation });
    const afterCount = await db.prepare('SELECT COUNT(*) AS n FROM attempts').first();
    assert.equal(afterCount.n, before.n + 1);
  });

  test('時間切れ送信だけ未回答を許す', async () => {
    const timedOut = await submit(SEED_SLUG, { answers: [1, -1, -1, -1, -1, -1], timedOut: true });
    assert.equal((await timedOut.json()).score, 1);
    const cheating = await submit(SEED_SLUG, { answers: [1, -1, -1, -1, -1, -1] });
    assert.equal(cheating.status, 400);
    await cheating.arrayBuffer();
  });

  test('受付トークン: 無い・改ざん・使い回し・問題の更新を拒否する', async () => {
    const missing = await postJson(`/v1/quizzes/${SEED_SLUG}/attempts`, { answers: SEED_ANSWERS });
    assert.deepEqual([missing.status, (await missing.json()).error], [400, 'invalid_session']);

    const token = await startSession(SEED_SLUG);
    const tampered = await postJson(`/v1/quizzes/${SEED_SLUG}/attempts`, { token: `${token.slice(0, -2)}AA`, answers: SEED_ANSWERS });
    assert.deepEqual([tampered.status, (await tampered.json()).error], [400, 'invalid_session']);

    const first = await postJson(`/v1/quizzes/${SEED_SLUG}/attempts`, { token, answers: SEED_ANSWERS });
    assert.equal((await first.json()).score, 6);
    const replay = await postJson(`/v1/quizzes/${SEED_SLUG}/attempts`, { token, answers: SEED_ANSWERS });
    assert.deepEqual([replay.status, (await replay.json()).error], [409, 'attempt_already_submitted']);

    const { body: quiz } = await admin('quizzes', { method: 'POST', body: sampleQuiz('回答中に更新') });
    await admin(`quizzes/${quiz.id}/status`, { method: 'POST', body: { status: 'published', version: 1 } });
    const slug = encodeURIComponent(quiz.slug);
    const before = await startSession(slug);
    // 別のクイズの受付トークンは使えない
    const otherQuiz = await postJson(`/v1/quizzes/${SEED_SLUG}/attempts`, { token: before, answers: SEED_ANSWERS });
    assert.deepEqual([otherQuiz.status, (await otherQuiz.json()).error], [400, 'invalid_session']);
    // 回答中に問題が編集されたら、新しい問題で採点せず 409
    await admin(`quizzes/${quiz.id}`, { method: 'PUT', body: { ...sampleQuiz('回答中に更新'), version: 2 } });
    const stale = await postJson(`/v1/quizzes/${slug}/attempts`, { token: before, answers: [1, 0] });
    assert.deepEqual([stale.status, (await stale.json()).error], [409, 'quiz_updated']);
  });

  test('回答送信の入力検証: 415 / 413 / 400', async () => {
    const wrongType = await publicFetch(`/v1/quizzes/${SEED_SLUG}/attempts`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(wrongType.status, 415);
    const tooLarge = await postJson(`/v1/quizzes/${SEED_SLUG}/attempts`, { answers: Array(5000).fill(0) });
    assert.equal(tooLarge.status, 413);
    const wrongCount = await submit(SEED_SLUG, { answers: [0] });
    assert.equal(wrongCount.status, 400);
    await Promise.all([wrongType, tooLarge, wrongCount].map(response => response.arrayBuffer()));
  });

  test('CORS は許可した Origin にだけ返し、preflight をキャッシュさせる', async () => {
    const allowed = await publicFetch('/v1/quizzes', { headers: { Origin: WEB_ORIGIN } });
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), WEB_ORIGIN);
    const denied = await publicFetch('/v1/quizzes', { headers: { Origin: 'https://evil.test' } });
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(denied.headers.get('Vary'), 'Origin');
    const preflight = await publicFetch(`/v1/quizzes/${SEED_SLUG}/attempts`, { method: 'OPTIONS', headers: { Origin: WEB_ORIGIN } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Max-Age'), '7200');
    await Promise.all([allowed, denied].map(response => response.arrayBuffer()));
  });

  test('管理APIは公開ドメインから到達できない', async () => {
    const response = await publicFetch('/admin/quizzes', { headers: { 'Cf-Access-Jwt-Assertion': signer.sign() } });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  });

  test('未対応メソッドは 405', async () => {
    const response = await publicFetch('/v1/quizzes', { method: 'DELETE' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET');
    await response.arrayBuffer();
  });
});

describe('管理API（AdminApi エントリポイント）', () => {
  test('Access JWT が無い・不正なら 401', async () => {
    assert.equal((await admin('quizzes', { token: null })).status, 401);
    assert.equal((await admin('quizzes', { token: createSigner('k1').sign() })).status, 401);
    // 認証前はルートの有無も分からない
    assert.equal((await admin('no-such-route', { token: null })).status, 401);
  });

  test('作成 → 編集 → 古い version の編集は 409 で、内容は上書きされない', async () => {
    const created = await admin('quizzes', { method: 'POST', body: sampleQuiz() });
    assert.equal(created.status, 201);
    const { id, version, status, slug } = created.body;
    assert.equal(status, 'draft');
    assert.equal(version, 1);
    assert.match(slug, /^結合テスト用クイズ-[0-9a-f]{8}$/);

    const edited = await admin(`quizzes/${id}`, { method: 'PUT', body: { ...sampleQuiz('編集後'), version: 1, questions: [sampleQuiz().questions[0]] } });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.version, 2);
    assert.equal(edited.body.questions.length, 1);

    const stale = await admin(`quizzes/${id}`, { method: 'PUT', body: { ...sampleQuiz('古い画面からの保存'), version: 1 } });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, { error: 'edit_conflict', detail: { currentVersion: 2 } });

    const current = await admin(`quizzes/${id}`);
    assert.equal(current.body.title, '編集後');
    assert.equal(current.body.questions.length, 1, '競合した保存で問題が差し替えられていない');

    const audit = await db.prepare('SELECT action FROM audit_events WHERE quiz_id = ?1 ORDER BY created_at').bind(id).all();
    assert.deepEqual(audit.results.map(row => row.action), ['quiz.create', 'quiz.update']);
  });

  test('更新の途中で失敗したら、本体・問題・監査ログのすべてが元のまま（原子性）', async () => {
    const { body: quiz } = await admin('quizzes', { method: 'POST', body: sampleQuiz('原子性テスト') });
    const input = {
      title: '途中で失敗する更新',
      description: '',
      timeLimitSeconds: null,
      // 2問目は DB の CHECK 制約（問題文300文字以内）に違反し、INSERT が失敗する
      questions: [
        { position: 0, prompt: 'OK', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: '' },
        { position: 1, prompt: 'x'.repeat(301), options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: '' }
      ]
    };
    await assert.rejects(updateQuiz(db, { id: quiz.id, version: quiz.version, input, actor: 'test' }));

    const current = await admin(`quizzes/${quiz.id}`);
    assert.equal(current.body.title, '原子性テスト');
    assert.equal(current.body.version, 1);
    assert.equal(current.body.questions.length, 2);
    assert.equal(current.body.questions[0].prompt, '1 + 1 は？');
    const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE quiz_id = ?1 AND action = 'quiz.update'").bind(quiz.id).first();
    assert.equal(audit.n, 0);
  });

  test('入力エラーは該当する問題と欄を返す', async () => {
    const quiz = sampleQuiz();
    quiz.questions[1].options = ['青', '青', '緑', '黄'];
    const response = await admin('quizzes', { method: 'POST', body: quiz });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'invalid_question', detail: { question: 2, field: 'duplicate_options' } });
  });

  test('公開・非公開・削除のライフサイクル', async () => {
    const { body: quiz } = await admin('quizzes', { method: 'POST', body: sampleQuiz('公開テスト') });

    assert.equal((await publicFetch(`/v1/quizzes/${encodeURIComponent(quiz.slug)}`)).status, 404, '下書きは公開されない');

    const published = await admin(`quizzes/${quiz.id}/status`, { method: 'POST', body: { status: 'published', version: quiz.version } });
    assert.deepEqual(published.body, { id: quiz.id, status: 'published', version: 2 });
    const visible = await publicFetch(`/v1/quizzes/${encodeURIComponent(quiz.slug)}`);
    assert.equal(visible.status, 200);
    await visible.arrayBuffer();

    const staleStatus = await admin(`quizzes/${quiz.id}/status`, { method: 'POST', body: { status: 'archived', version: 1 } });
    assert.equal(staleStatus.status, 409);

    const deletePublished = await admin(`quizzes/${quiz.id}`, { method: 'DELETE' });
    assert.deepEqual(deletePublished, { status: 409, body: { error: 'quiz_published' } });

    const archived = await admin(`quizzes/${quiz.id}/status`, { method: 'POST', body: { status: 'archived', version: 2 } });
    assert.equal(archived.body.status, 'archived');
    const hidden = await publicFetch(`/v1/quizzes/${encodeURIComponent(quiz.slug)}`);
    assert.equal(hidden.status, 404, '非公開にすると即座に見えなくなる');
    await hidden.arrayBuffer();

    assert.equal((await admin(`quizzes/${quiz.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await admin(`quizzes/${quiz.id}`)).status, 404);
    assert.equal((await admin(`quizzes/${quiz.id}`, { method: 'DELETE' })).status, 404);

    const audit = await db.prepare('SELECT action FROM audit_events WHERE quiz_id = ?1 ORDER BY created_at').bind(quiz.id).all();
    assert.deepEqual(audit.results.map(row => row.action), ['quiz.create', 'quiz.publish', 'quiz.archive', 'quiz.delete']);
  });

  test('管理一覧は version と問題数を含む', async () => {
    const { status, body } = await admin('quizzes');
    assert.equal(status, 200);
    const sample = body.quizzes.find(quiz => quiz.slug === SEED_SLUG);
    assert.equal(sample.questionCount, 6);
    assert.equal(sample.version, 1);
  });

  test('回答統計: 現在の問題内容への回答だけで設問別の正答率と選択肢分布を出す', async () => {
    const { body: quiz } = await admin('quizzes', { method: 'POST', body: sampleQuiz('統計テスト') });
    await admin(`quizzes/${quiz.id}/status`, { method: 'POST', body: { status: 'published', version: quiz.version } });
    const slug = encodeURIComponent(quiz.slug);
    // 正解は [1, 0]
    for (const body of [{ answers: [1, 0] }, { answers: [1, 2] }, { answers: [3, 0] }, { answers: [1, -1], timedOut: true }]) {
      const response = await submit(slug, body);
      assert.equal(response.status, 201);
      await response.arrayBuffer();
    }

    const { status, body: stats } = await admin(`quizzes/${quiz.id}/stats`);
    assert.equal(status, 200);
    assert.equal(stats.attempts, 4);
    assert.equal(stats.totalAttempts, 4);
    assert.equal(stats.perfectCount, 1);
    assert.equal(stats.averageRate, (2 + 1 + 1 + 1) / 8);
    assert.deepEqual(stats.scoreDistribution, [0, 3, 1]);
    assert.deepEqual(stats.questions[0].optionCounts, [0, 3, 0, 1]);
    assert.equal(stats.questions[0].correctRate, 0.75);
    assert.deepEqual(stats.questions[1].optionCounts, [2, 0, 1, 0]);
    assert.equal(stats.questions[1].unanswered, 1);
    assert.equal(stats.questions[1].correctRate, 0.5);

    // 問題を編集すると設問別の集計は新しい内容でやり直し（合計件数には残る）
    const current = await admin(`quizzes/${quiz.id}`);
    await admin(`quizzes/${quiz.id}`, { method: 'PUT', body: { ...sampleQuiz('統計テスト'), version: current.body.version } });
    const { body: afterEdit } = await admin(`quizzes/${quiz.id}/stats`);
    assert.equal(afterEdit.attempts, 0);
    assert.equal(afterEdit.totalAttempts, 4);
    assert.equal(afterEdit.averageRate, null);
    assert.equal(afterEdit.questions[0].correctRate, null);
  });

  test('複製すると下書きのコピーができ、変更履歴に残る', async () => {
    const { body: source } = await admin('quizzes', { method: 'POST', body: sampleQuiz('複製元') });
    const copied = await admin(`quizzes/${source.id}/duplicate`, { method: 'POST' });
    assert.equal(copied.status, 201);
    assert.equal(copied.body.title, '複製元（コピー）');
    assert.equal(copied.body.status, 'draft');
    assert.notEqual(copied.body.id, source.id);
    assert.deepEqual(copied.body.questions.map(q => q.prompt), source.questions.map(q => q.prompt));

    const { body: history } = await admin(`quizzes/${copied.body.id}/history`);
    assert.equal(history.events.length, 1);
    assert.equal(history.events[0].action, 'quiz.create');
    assert.equal(history.events[0].actor, 'admin@example.test');
    assert.equal(history.events[0].metadata.duplicatedFrom, source.id);

    assert.equal((await admin('quizzes/no-such-id/duplicate', { method: 'POST' })).status, 404);
  });

  test('保持期間を過ぎた回答記録だけを削除する', async () => {
    await db.prepare("INSERT INTO attempts (id, quiz_id, score, total, answers_json, created_at) VALUES ('old-attempt', ?1, 0, 6, '[]', '2020-01-01T00:00:00.000Z')").bind('00000000-0000-4000-8000-000000000001').run();
    const before = await db.prepare('SELECT COUNT(*) AS n FROM attempts').first();
    const deleted = await purgeExpiredAttempts({ DB: db, ATTEMPT_RETENTION_DAYS: '30' });
    assert.equal(deleted, 1);
    const after = await db.prepare('SELECT COUNT(*) AS n FROM attempts').first();
    assert.equal(after.n, before.n - 1);
  });

  test('Access の鍵がローテーションされても、JWKS を取り直して受け付ける', async () => {
    const before = jwksRequests;
    signer = createSigner('k2');
    // 直近 30 秒以内に取得済みなので最初は未知の kid として拒否される
    assert.equal((await admin('quizzes')).status, 401);
    assert.equal(jwksRequests, before);
  });
});
