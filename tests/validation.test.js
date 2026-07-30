import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuiz, validateAnswers } from '../workers/api/src/validation.js';

const valid = { title:'日本の雑学', description:'説明', questions:[{ prompt:'首都は？', options:['東京','大阪','京都','福岡'], correctIndex:0, explanation:'東京都です' }] };

test('valid quiz is normalized', () => {
  const result = validateQuiz(valid);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].position, 0);
});

test('requires exactly four distinct non-empty choices', () => {
  assert.throws(() => validateQuiz({ ...valid, questions:[{ ...valid.questions[0], options:['A','A','C','D'] }] }), /invalid_question_1/);
  assert.throws(() => validateQuiz({ ...valid, questions:[{ ...valid.questions[0], options:['A','B','C'] }] }), /invalid_question_1/);
});

test('rejects invalid correct index and excessive question count', () => {
  assert.throws(() => validateQuiz({ ...valid, questions:[{ ...valid.questions[0], correctIndex:4 }] }), /invalid_question_1/);
  assert.throws(() => validateQuiz({ ...valid, questions:[] }), /invalid_question_count/);
});

test('answer count and bounds must match quiz', () => {
  assert.deepEqual(validateAnswers({ answers:[0,3] },2),[0,3]);
  assert.throws(() => validateAnswers({ answers:[0] },2), /invalid_answers/);
  assert.throws(() => validateAnswers({ answers:[7,0] },2), /invalid_answers/);
});
