import assert from 'node:assert/strict';
import test from 'node:test';
import { publicUrlFor } from '../workers/api/src/admin-api.js';

const published = { status: 'published', slug: 'シャトル-1a2b' };

test('publicUrlFor: 公開中のクイズだけ、公開画面の共有URL（/q/<slug>）を返す', () => {
  assert.equal(publicUrlFor({ PUBLIC_SITE_ORIGIN: 'https://quiz.example.com' }, published), `https://quiz.example.com/q/${encodeURIComponent(published.slug)}`);
  // 末尾のスラッシュやパスが付いていても Origin だけを使う
  assert.equal(publicUrlFor({ PUBLIC_SITE_ORIGIN: 'https://quiz.example.com/some/path/' }, { status: 'published', slug: 'a' }), 'https://quiz.example.com/q/a');
  assert.equal(publicUrlFor({ PUBLIC_SITE_ORIGIN: 'https://quiz.example.com' }, { ...published, status: 'draft' }), null);
  assert.equal(publicUrlFor({ PUBLIC_SITE_ORIGIN: 'https://quiz.example.com' }, { ...published, status: 'archived' }), null);
});

test('publicUrlFor: 設定が無い・壊れている・http(s) 以外なら null（管理画面はリンクを出さない）', () => {
  for (const origin of [undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://quiz.example.com']) {
    assert.equal(publicUrlFor({ PUBLIC_SITE_ORIGIN: origin }, published), null, String(origin));
  }
});
