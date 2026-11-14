import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { loadRecord, saveRecord } from '../apps/web/public/js/records.js';

// ブラウザの localStorage の代わり
const store = new Map();
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};
beforeEach(() => store.clear());

test('初回は「更新」とせず、ベストを上回った時だけ自己ベスト更新', () => {
  const first = saveRecord('quiz', { score: 3, total: 6 });
  assert.equal(first.isNewBest, false);
  assert.equal(first.previous, null);
  assert.deepEqual({ ...first.record, updatedAt: undefined }, { total: 6, best: 3, last: 3, plays: 1, updatedAt: undefined });

  const lower = saveRecord('quiz', { score: 2, total: 6 });
  assert.equal(lower.isNewBest, false);
  assert.equal(lower.record.best, 3, '下がってもベストは保つ');
  assert.equal(lower.record.last, 2);

  const same = saveRecord('quiz', { score: 3, total: 6 });
  assert.equal(same.isNewBest, false, '同点は更新ではない');

  const higher = saveRecord('quiz', { score: 5, total: 6 });
  assert.equal(higher.isNewBest, true);
  assert.equal(higher.previous.best, 3);
  assert.equal(loadRecord('quiz', 6).plays, 4);
});

test('問題数が変わったクイズの記録は比べない', () => {
  saveRecord('quiz', { score: 6, total: 6 });
  assert.equal(loadRecord('quiz', 8), null);
  const afterEdit = saveRecord('quiz', { score: 2, total: 8 });
  assert.equal(afterEdit.previous, null);
  assert.equal(afterEdit.record.best, 2);
});

test('壊れた値・localStorage が使えない環境では記録しないだけで例外にしない', () => {
  store.set('qraft:record:quiz', '{not json');
  assert.equal(loadRecord('quiz', 6), null);
  store.set('qraft:record:quiz', JSON.stringify({ total: 6, best: 9, last: 1, plays: 1 }));
  assert.equal(loadRecord('quiz', 6), null, 'ベストが問題数を超える値は捨てる');

  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  try {
    assert.deepEqual(saveRecord('quiz', { score: 1, total: 6 }), { record: null, previous: null, isNewBest: false });
  } finally {
    globalThis.localStorage = original;
  }
});
