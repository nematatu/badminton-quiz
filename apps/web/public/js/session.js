import { UNANSWERED } from '../shared/contracts.js';

/**
 * 1 回の挑戦の状態。画面描画から独立させ、状態遷移だけを持つ。
 *
 *   playing ──(最後の問題で回答 / 時間切れ)──▶ submitting ──▶ finished
 */
export class QuizSession {
  /**
   * @param {object} quiz 公開APIのクイズ
   * @param {string} token サーバーが発行した受付トークン（採点時に送る）
   */
  constructor(quiz, token, now = Date.now()) {
    this.quiz = quiz;
    this.token = token;
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
    return { token: this.token, answers: this.answers.map(answer => answer ?? UNANSWERED), timedOut };
  }
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 結果を共有するときの文面（X の投稿・端末の共有メニューで共通）。 */
export function shareText(quiz, result) {
  return `「${quiz.title}」で${result.total}問中${result.score}問正解しました！\n#Qraft #4択クイズ`;
}

export function resultMessage(score, total) {
  const rate = total ? score / total : 0;
  if (rate === 1) return 'パーフェクト！文句なしの満点です。';
  if (rate >= 0.7) return 'すごい！かなりの実力者です。';
  if (rate >= 0.4) return 'いい感じ！もう一度なら満点かも。';
  return '伸びしろたっぷり。もう一度挑戦してみよう！';
}

/**
 * 間違えた問題の復習。採点結果（正解と解説）を使ってブラウザの中だけで進め、サーバーには送らない
 * （記録・回答数にも数えない）。1 問ずつ「答えを確かめる」とすぐに正誤と解説が分かる。
 *
 *   answering ──(確かめる)──▶ checked ──(次へ)──▶ answering … ──▶ done
 */
export class PracticeSession {
  /**
   * @param {{ title: string, questions: Array<{ prompt: string, options: string[] }> }} quiz
   * @param {{ details: Array<{ correct: boolean, correctIndex: number, explanation?: string }> }} result
   */
  constructor(quiz, result) {
    this.quiz = quiz;
    this.items = result.details.flatMap((detail, number) =>
      detail.correct ? [] : [{ number, question: quiz.questions[number], correctIndex: detail.correctIndex, explanation: detail.explanation ?? '' }]
    );
    this.index = 0;
    this.selected = null;
    this.checked = false;
    /** @type {boolean[]} 各問を復習で正解できたか */
    this.outcomes = [];
  }

  get item() {
    return this.items[this.index];
  }

  get total() {
    return this.items.length;
  }

  get isLast() {
    return this.index === this.items.length - 1;
  }

  get isCorrect() {
    return this.checked && this.selected === this.item.correctIndex;
  }

  /** 復習でもまだ間違えた問題だけを残した採点結果（それだけをもう一度復習するときに使う） */
  get remainingResult() {
    /** @type {Array<{ correct: boolean, correctIndex: number, explanation?: string }>} */
    const details = this.quiz.questions.map(() => ({ correct: true, correctIndex: -1 }));
    this.items.forEach((item, index) => {
      if (!this.outcomes[index]) details[item.number] = { correct: false, correctIndex: item.correctIndex, explanation: item.explanation };
    });
    return { details };
  }

  get score() {
    return this.outcomes.filter(Boolean).length;
  }

  select(optionIndex) {
    if (!this.checked) this.selected = optionIndex;
  }

  check() {
    if (this.checked || this.selected === null) return;
    this.checked = true;
    this.outcomes[this.index] = this.selected === this.item.correctIndex;
  }

  next() {
    if (!this.checked || this.isLast) return;
    this.index += 1;
    this.selected = null;
    this.checked = false;
  }
}
