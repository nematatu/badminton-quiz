import assert from 'node:assert/strict';
import test from 'node:test';
import { outdatedFiles } from '../scripts/sync-shared.js';
import { QuizSession, describeQuiz, formatDuration, resultMessage } from '../apps/web/public/js/session.js';

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
});

test('各アプリの shared/ は packages/shared/src と同期している', () => {
  assert.deepEqual(outdatedFiles(), []);
});
