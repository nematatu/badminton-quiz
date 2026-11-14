import assert from 'node:assert/strict';
import test from 'node:test';
import { outdatedFiles } from '../scripts/sync-shared.js';
import { describeQuiz } from '../packages/shared/src/contracts.js';
import { PracticeSession, QuizSession, formatDuration, resultMessage, shareText } from '../apps/web/public/js/session.js';

const quiz = { slug: 's', title: 'T', timeLimitSeconds: 30, questions: [{ prompt: 'a', options: ['1', '2', '3', '4'] }, { prompt: 'b', options: ['1', '2', '3', '4'] }] };

test('QuizSession: 回答・移動・時間切れ送信', () => {
  const session = new QuizSession(quiz, 'token-1', 1_000);
  assert.equal(session.remainingSeconds(1_000), 30);
  assert.equal(session.remainingSeconds(40_000), 0);
  assert.equal(session.hasProgress, false);

  session.select(2);
  assert.equal(session.hasProgress, true);
  session.previous();
  assert.equal(session.index, 0);
  session.next();
  session.next();
  assert.equal(session.index, 1);
  assert.equal(session.isLast, true);

  assert.deepEqual(session.submission(true), { token: 'token-1', answers: [2, -1], timedOut: true });
});

test('表示用の整形', () => {
  assert.equal(formatDuration(75), '01:15');
  assert.equal(describeQuiz({ questionCount: 6, timeLimitSeconds: 90 }), '全6問・制限時間1分30秒');
  assert.equal(describeQuiz({ questionCount: 1, timeLimitSeconds: null }), '全1問・時間制限なし');
  assert.match(resultMessage(3, 3), /パーフェクト/);
  assert.match(resultMessage(0, 3), /伸びしろ/);
  assert.equal(shareText({ title: 'T' }, { score: 2, total: 3 }), '「T」で3問中2問正解しました！\n#Qraft #4択クイズ');
});

test('各アプリの shared/ は packages/shared/src と同期している', () => {
  assert.deepEqual(outdatedFiles(), []);
});

test('PracticeSession: 間違えた問題だけを、確かめてから次へ進む', () => {
  const three = { ...quiz, questions: [...quiz.questions, { prompt: 'c', options: ['1', '2', '3', '4'] }] };
  const result = {
    details: [
      { correct: false, correctIndex: 1, explanation: 'a の解説' },
      { correct: true, correctIndex: 0 },
      { correct: false, correctIndex: 3, explanation: '' }
    ]
  };
  const practice = new PracticeSession(three, result);
  assert.equal(practice.total, 2);
  assert.equal(practice.item.number, 0);
  assert.equal(practice.item.explanation, 'a の解説');

  // 選ぶ前は確かめられず、確かめる前は次へ進めない
  practice.check();
  practice.next();
  assert.equal(practice.checked, false);
  assert.equal(practice.index, 0);

  practice.select(1);
  practice.check();
  assert.equal(practice.isCorrect, true);
  practice.select(2); // 確かめた後は答えを変えられない
  assert.equal(practice.selected, 1);

  practice.next();
  assert.equal(practice.item.number, 2);
  assert.equal(practice.isLast, true);
  practice.select(0);
  practice.check();
  assert.equal(practice.isCorrect, false);
  assert.equal(practice.score, 1);

  // 復習でも間違えた問題（第3問）だけをもう一度
  const again = new PracticeSession(three, practice.remainingResult);
  assert.deepEqual(again.items.map(item => item.number), [2]);
  assert.equal(again.item.correctIndex, 3);
  assert.equal(new PracticeSession(three, { details: result.details.map(detail => ({ ...detail, correct: true })) }).total, 0);
});
