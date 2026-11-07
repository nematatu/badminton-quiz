import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMITS } from '../packages/shared/src/contracts.js';
import { validateAnswers, validateQuizInput, validateStatusChange, validateVersion } from '../workers/api/src/validation.js';

const question = { prompt: '首都は？', options: ['東京', '大阪', '京都', '福岡'], correctIndex: 0, explanation: '東京都です' };
const valid = { title: '日本の雑学', description: '説明', questions: [question] };

const rejects = (input, code, detail) =>
  assert.throws(
    () => validateQuizInput(input),
    error => error.status === 400 && error.code === code && (detail === undefined || JSON.stringify(error.detail) === JSON.stringify(detail))
  );

test('正しいクイズは trim され position が振られる', () => {
  const result = validateQuizInput({ ...valid, title: '  日本の雑学  ', questions: [question, { ...question, prompt: '2問目' }] });
  assert.equal(result.title, '日本の雑学');
  assert.deepEqual(result.questions.map(q => q.position), [0, 1]);
  assert.equal(result.timeLimitSeconds, null);
});

test('長すぎる値は切り詰めずに拒否する（コードポイント単位）', () => {
  assert.equal(validateQuizInput({ ...valid, title: '😀'.repeat(LIMITS.title) }).title.length, LIMITS.title * 2);
  rejects({ ...valid, title: 'あ'.repeat(LIMITS.title + 1) }, 'invalid_title');
  rejects({ ...valid, title: '   ' }, 'invalid_title');
  rejects({ ...valid, description: 'あ'.repeat(LIMITS.description + 1) }, 'invalid_description');
});

test('制限時間は任意で、指定時は範囲内の整数', () => {
  assert.equal(validateQuizInput({ ...valid, timeLimitSeconds: 60 }).timeLimitSeconds, 60);
  assert.equal(validateQuizInput({ ...valid, timeLimitSeconds: '' }).timeLimitSeconds, null);
  rejects({ ...valid, timeLimitSeconds: 9 }, 'invalid_time_limit');
  rejects({ ...valid, timeLimitSeconds: 3601 }, 'invalid_time_limit');
  rejects({ ...valid, timeLimitSeconds: 12.5 }, 'invalid_time_limit');
});

test('問題の誤りは何問目のどの欄かを返す', () => {
  const second = patch => ({ ...valid, questions: [question, { ...question, ...patch }] });
  rejects(second({ prompt: '' }), 'invalid_question', { question: 2, field: 'prompt' });
  rejects(second({ options: ['A', 'B', 'C'] }), 'invalid_question', { question: 2, field: 'options' });
  rejects(second({ options: ['A', 'B', 'C', ' '] }), 'invalid_question', { question: 2, field: 'options' });
  rejects(second({ options: ['A', 'ａ', 'C', 'D'] }), 'invalid_question', { question: 2, field: 'duplicate_options' });
  rejects(second({ correctIndex: 4 }), 'invalid_question', { question: 2, field: 'correctIndex' });
  rejects(second({ correctIndex: '1' }), 'invalid_question', { question: 2, field: 'correctIndex' });
  rejects(second({ explanation: 'あ'.repeat(LIMITS.explanation + 1) }), 'invalid_question', { question: 2, field: 'explanation' });
});

test('問題数は 1〜上限', () => {
  rejects({ ...valid, questions: [] }, 'invalid_question_count');
  rejects({ ...valid, questions: Array(LIMITS.questions + 1).fill(question) }, 'invalid_question_count');
  rejects(null, 'invalid_json');
});

test('version と公開状態の検証', () => {
  assert.equal(validateVersion({ version: 3 }), 3);
  assert.throws(() => validateVersion({ version: '3' }), { code: 'invalid_version' });
  assert.deepEqual(validateStatusChange({ status: 'published', version: 1 }), { status: 'published', version: 1 });
  assert.throws(() => validateStatusChange({ status: 'draft', version: 1 }), { code: 'invalid_status' });
});

test('回答は問題数と一致し、時間切れの時だけ未回答(-1)を許す', () => {
  assert.deepEqual(validateAnswers({ answers: [0, 3] }, 2).answers, [0, 3]);
  assert.throws(() => validateAnswers({ answers: [0] }, 2), { code: 'invalid_answers' });
  assert.throws(() => validateAnswers({ answers: [4, 0] }, 2), { code: 'invalid_answers' });
  assert.throws(() => validateAnswers({ answers: [1.5, 0] }, 2), { code: 'invalid_answers' });
  assert.deepEqual(validateAnswers({ answers: [-1, 2], timedOut: true }, 2), { answers: [-1, 2], timedOut: true });
  assert.throws(() => validateAnswers({ answers: [-1, 2] }, 2), { code: 'invalid_answers' });
});
