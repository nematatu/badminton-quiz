import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { clearDraft, loadDraft, saveDraft } from '../apps/admin/public/js/drafts.js';

// ブラウザの localStorage の代わり
const store = new Map();
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};
beforeEach(() => store.clear());

const data = { title: 'T', description: '', timeLimitSeconds: null, questions: [{ prompt: 'p', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: '' }], version: 7 };

test('クイズごと（新規は new）に保存・読み込み・削除できる。version は下書きに含めない', () => {
  saveDraft('quiz-1', 7, data);
  saveDraft(null, null, { ...data, title: '新規' });
  const draft = loadDraft('quiz-1');
  assert.equal(draft.baseVersion, 7);
  assert.equal(draft.data.title, 'T');
  assert.equal('version' in draft.data, false);
  assert.equal(loadDraft(null).data.title, '新規');
  clearDraft('quiz-1');
  assert.equal(loadDraft('quiz-1'), null);
  assert.equal(loadDraft(null).data.title, '新規');
});

test('壊れた値や localStorage が使えない環境では null を返し、例外にしない', () => {
  store.set('qraft:draft:quiz-1', '{not json');
  assert.equal(loadDraft('quiz-1'), null);
  store.set('qraft:draft:quiz-1', JSON.stringify({ savedAt: 'x', data: { questions: 'nope' } }));
  assert.equal(loadDraft('quiz-1'), null);

  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
  try {
    assert.doesNotThrow(() => saveDraft('quiz-1', 1, data));
    assert.equal(loadDraft('quiz-1'), null);
    assert.doesNotThrow(() => clearDraft('quiz-1'));
  } finally {
    globalThis.localStorage = original;
  }
});
