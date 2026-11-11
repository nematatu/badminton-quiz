import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SECURITY_HEADERS } from '../apps/web/functions/_lib/security-headers.js';
import { renderSharePage } from '../apps/web/functions/_lib/share-page.js';
import { onRequestGet } from '../apps/web/functions/q/[slug].js';

const indexHtml = readFileSync(new URL('../apps/web/public/index.html', import.meta.url), 'utf8');
const quiz = { slug: 'sample', title: 'バドミントン基礎クイズ', description: '基本の6問', questions: Array(6).fill({ prompt: 'q', options: ['a', 'b', 'c', 'd'] }) };

function env({ apiResponse = Response.json(quiz), onApi } = {}) {
  return {
    ASSETS: { fetch: async () => new Response(indexHtml) },
    API: {
      fetch: async url => {
        onApi?.(url);
        if (apiResponse instanceof Error) throw apiResponse;
        return apiResponse;
      }
    }
  };
}
const call = (slug, options) => onRequestGet({ request: new Request(`https://quiz.test/q/${encodeURIComponent(slug)}`), env: env(options), params: { slug } });

test('renderSharePage: タイトル・説明・OGP をクイズの内容にし、値は HTML エスケープする', () => {
  const html = renderSharePage(indexHtml, { title: '"><script>alert(1)</script>', description: '', questionCount: 3, url: 'https://quiz.test/q/x' });
  assert.match(html, /<title>&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; \| Qraft<\/title>/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<meta property="og:description" content="全3問の4択クイズに挑戦しよう。">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/quiz.test\/q\/x">/);
  assert.equal(html.match(/<meta name="description"/g).length, 1, '既存のタグを置き換え、重複させない');
});

test('Functions のセキュリティヘッダーは public/_headers の /* ブロックと一致する', () => {
  const block = {};
  let inGlobal = false;
  for (const line of readFileSync(new URL('../apps/web/public/_headers', import.meta.url), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ')) inGlobal = line.trim() === '/*';
    else if (inGlobal) {
      const [name, ...value] = line.trim().split(':');
      block[name] = value.join(':').trim();
    }
  }
  assert.deepEqual({ ...SECURITY_HEADERS }, block);
});

test('/q/<slug>: 公開中のクイズなら OGP 入りの画面を返す', async () => {
  let requested;
  const response = await call('日本の雑学-1a2b', { onApi: url => (requested = url) });
  assert.equal(response.status, 200);
  assert.equal(requested, 'https://qraft-api.internal/v1/quizzes/%E6%97%A5%E6%9C%AC%E3%81%AE%E9%9B%91%E5%AD%A6-1a2b');
  const html = await response.text();
  assert.match(html, /<meta property="og:title" content="バドミントン基礎クイズ \| Qraft">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/quiz.test\/q\/%E6%97%A5/);
  assert.match(response.headers.get('Content-Security-Policy'), /require-trusted-types-for/);
});

test('/q/<slug>: 見つからない・API 障害・不正な slug は既定の画面を 404 で返す', async () => {
  for (const options of [{ apiResponse: Response.json({ error: 'not_found' }, { status: 404 }) }, { apiResponse: new Error('down') }]) {
    const response = await call('missing', options);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), indexHtml);
  }
  let called = false;
  const invalid = await call('has space', { onApi: () => (called = true) });
  assert.equal(invalid.status, 404);
  assert.equal(called, false, '不正な slug では API を呼ばない');
});
