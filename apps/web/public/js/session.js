import { UNANSWERED } from '../shared/contracts.js';

/**
 * 1 回の挑戦の状態。画面描画から独立させ、状態遷移だけを持つ。
 *
 *   playing ──(最後の問題で回答 / 時間切れ)──▶ submitting ──▶ finished
 */
export class QuizSession {
  constructor(quiz, now = Date.now()) {
    this.quiz = quiz;
    this.index = 0;
    this.answers = Array(quiz.questions.length).fill(null);
    this.deadline = quiz.timeLimitSeconds ? now + quiz.timeLimitSeconds * 1000 : null;
    this.status = 'playing';
  }

  get total() {
    return this.quiz.questions.length;
  }

  get question() {
    return this.quiz.questions[this.index];
  }

  get isLast() {
    return this.index === this.total - 1;
  }

  get hasProgress() {
    return this.status === 'playing' && this.answers.some(answer => answer !== null);
  }

  select(optionIndex) {
    this.answers[this.index] = optionIndex;
  }

  next() {
    if (!this.isLast) this.index += 1;
  }

  previous() {
    if (this.index > 0) this.index -= 1;
  }

  remainingSeconds(now = Date.now()) {
    if (this.deadline === null) return null;
    return Math.max(0, Math.ceil((this.deadline - now) / 1000));
  }

  /** 送信用の回答。時間切れなら未回答を UNANSWERED で埋める。 */
  submission(timedOut) {
    return { answers: this.answers.map(answer => answer ?? UNANSWERED), timedOut };
  }
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 一覧や導入画面向けの「全5問・制限時間1分30秒」のような説明。 */
export function describeQuiz({ questionCount, timeLimitSeconds }) {
  const parts = [`全${questionCount}問`];
  if (timeLimitSeconds) {
    const minutes = Math.floor(timeLimitSeconds / 60);
    const seconds = timeLimitSeconds % 60;
    parts.push(`制限時間${minutes ? `${minutes}分` : ''}${seconds ? `${seconds}秒` : ''}`);
  } else {
    parts.push('時間制限なし');
  }
  return parts.join('・');
}

export function resultMessage(score, total) {
  const rate = total ? score / total : 0;
  if (rate === 1) return 'パーフェクト！文句なしの満点です。';
  if (rate >= 0.7) return 'すごい！かなりの実力者です。';
  if (rate >= 0.4) return 'いい感じ！もう一度なら満点かも。';
  return '伸びしろたっぷり。もう一度挑戦してみよう！';
}
