import { h } from '../shared/dom.js';
import { describeQuiz, formatDuration, resultMessage } from './session.js';

/**
 * 画面ごとの描画関数。状態は持たず、受け取ったデータとコールバックから
 * DOM を組み立てて返すだけにする。
 */

const LETTERS = ['A', 'B', 'C', 'D'];

export const quizHref = slug => `#quiz/${encodeURIComponent(slug)}`;

export function loadingView(message = '読み込み中…') {
  return h('div', { class: 'status-view', role: 'status', 'aria-busy': 'true' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), message);
}

export function errorView({ title, message, onRetry, retryLabel = 'もう一度読み込む' }) {
  return h(
    'section',
    { class: 'status-view' },
    h('h1', { class: 'status-title' }, title),
    h('p', null, message),
    h(
      'div',
      { class: 'actions center' },
      onRetry && h('button', { type: 'button', class: 'button', onclick: onRetry }, retryLabel),
      h('a', { class: 'button ghost', href: '#/' }, 'クイズ一覧へ')
    )
  );
}

export function homeView(quizzes) {
  return [
    h(
      'section',
      { class: 'hero' },
      h('p', { class: 'eyebrow' }, '4択クイズ'),
      h('h1', null, '知識を試そう。', h('br'), h('em', null, '4つの中からひとつ。')),
      h('p', { class: 'lead' }, 'クイズを選んで、4つの選択肢から答えてください。全問答えると採点と解説が表示されます。')
    ),
    h(
      'section',
      { class: 'catalog', 'aria-labelledby': 'catalog-title' },
      h('div', { class: 'section-head' }, h('h2', { id: 'catalog-title' }, '公開中のクイズ'), h('span', { class: 'count' }, `${quizzes.length}件`)),
      quizzes.length
        ? h(
            'ul',
            { class: 'quiz-list' },
            quizzes.map(quiz =>
              h(
                'li',
                null,
                h(
                  'a',
                  { class: 'quiz-card', href: quizHref(quiz.slug) },
                  h('span', { class: 'quiz-card-body' }, h('strong', null, quiz.title), quiz.description && h('span', { class: 'muted' }, quiz.description)),
                  h('span', { class: 'quiz-card-meta' }, describeQuiz(quiz), h('span', { 'aria-hidden': 'true' }, ' →'))
                )
              )
            )
          )
        : h('p', { class: 'empty' }, '公開中のクイズはまだありません。')
    )
  ];
}

export function introView(quiz, { onStart }) {
  return h(
    'section',
    { class: 'narrow' },
    h('a', { class: 'back-link', href: '#/' }, '← クイズ一覧'),
    h(
      'div',
      { class: 'card intro' },
      h('p', { class: 'eyebrow' }, describeQuiz({ questionCount: quiz.questions.length, timeLimitSeconds: quiz.timeLimitSeconds })),
      h('h1', null, quiz.title),
      quiz.description && h('p', { class: 'lead' }, quiz.description),
      quiz.timeLimitSeconds && h('p', { class: 'notice' }, '「はじめる」を押すとタイマーが動き出します。時間切れになると、その時点の回答で採点されます。'),
      h('button', { type: 'button', class: 'button wide', onclick: onStart }, 'はじめる')
    )
  );
}

/**
 * 設問画面。選択肢はネイティブのラジオボタンなので、矢印キーやスクリーンリーダーで
 * そのまま操作できる。選択しても画面全体は描き直さない（フォーカスを失わない）。
 */
export function questionView(session, { onSelect, onNext, onPrevious }) {
  const { quiz, index, total, question } = session;
  const selected = session.answers[index];
  const remaining = session.remainingSeconds();

  const submitButton = h('button', { type: 'submit', class: 'button', disabled: selected === null }, session.isLast ? '採点する' : '次の問題へ');

  const form = h(
    'form',
    {
      class: 'card question-card',
      onsubmit: event => {
        event.preventDefault();
        if (session.answers[session.index] !== null) onNext();
      },
      onchange: event => {
        if (event.target.name !== 'answer') return;
        onSelect(Number(event.target.value));
        submitButton.disabled = false;
      }
    },
    h(
      'fieldset',
      null,
      h('legend', { class: 'question-label' }, h('span', null, quiz.title), h('span', null, `第${index + 1}問`)),
      h('h1', { class: 'question-title' }, question.prompt),
      h(
        'div',
        { class: 'answers' },
        question.options.map((option, optionIndex) =>
          h(
            'label',
            { class: 'answer' },
            h('input', { type: 'radio', name: 'answer', value: String(optionIndex), checked: selected === optionIndex, 'aria-keyshortcuts': String(optionIndex + 1) }),
            h('span', { class: 'answer-key', 'aria-hidden': 'true' }, LETTERS[optionIndex]),
            h('span', { class: 'answer-text' }, option)
          )
        )
      )
    ),
    h('p', { class: 'hint' }, 'キーボードの 1〜4 でも選べます'),
    h(
      'div',
      { class: 'question-actions' },
      index > 0 ? h('button', { type: 'button', class: 'button ghost', onclick: onPrevious }, '← 前の問題') : h('span'),
      submitButton
    )
  );

  const progress = h('div', {
    class: 'progress',
    role: 'progressbar',
    'aria-label': '進捗',
    'aria-valuemin': '1',
    'aria-valuemax': String(total),
    'aria-valuenow': String(index + 1)
  });
  // style 属性ではなく CSSOM で設定する（CSP の style-src 'self' を満たすため）。
  progress.style.setProperty('--progress', `${((index + 1) / total) * 100}%`);

  return h(
    'section',
    { class: 'narrow' },
    h(
      'div',
      { class: 'progress-row' },
      h('span', { class: 'progress-count' }, `${index + 1} / ${total}`),
      progress,
      remaining !== null && h('span', { class: 'timer', 'data-timer': '', role: 'timer', 'aria-label': '残り時間' }, formatDuration(remaining))
    ),
    form
  );
}

export function resultView(session, result, { shareUrl, onCopy, onRetry }) {
  const { quiz } = session;
  const message = resultMessage(result.score, result.total);
  const shareText = `「${quiz.title}」で${result.total}問中${result.score}問正解しました！\n#Qraft #4択クイズ`;
  // URLSearchParams は空白を + にするため、確実に解釈される %20 形式で組み立てる。
  const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

  const optionLabel = (question, optionIndex) => `${LETTERS[optionIndex]}. ${question.options[optionIndex]}`;

  return h(
    'section',
    { class: 'narrow result' },
    h(
      'div',
      { class: 'card result-card' },
      h('p', { class: 'eyebrow' }, quiz.title),
      h('p', { class: 'score' }, h('strong', null, result.score), h('span', null, ` / ${result.total}問正解`)),
      h('h1', null, message),
      h(
        'div',
        { class: 'actions center' },
        h('a', { class: 'button', href: intent, target: '_blank', rel: 'noopener noreferrer' }, 'Xでシェア'),
        h('button', { type: 'button', class: 'button ghost', onclick: onCopy }, 'リンクをコピー'),
        h('button', { type: 'button', class: 'button ghost', onclick: onRetry }, 'もう一度挑戦')
      )
    ),
    h('h2', { class: 'review-title' }, '答え合わせ'),
    h(
      'ol',
      { class: 'review' },
      result.details.map((detail, index) => {
        const question = quiz.questions[index];
        return h(
          'li',
          { class: `review-item ${detail.correct ? 'is-correct' : 'is-wrong'}` },
          h('p', { class: 'review-head' }, h('span', { class: 'badge' }, detail.correct ? '正解' : '不正解'), h('span', null, `第${index + 1}問 ${question.prompt}`)),
          h(
            'dl',
            { class: 'review-answers' },
            h('dt', null, 'あなたの回答'),
            h('dd', null, detail.selectedIndex >= 0 ? optionLabel(question, detail.selectedIndex) : '未回答（時間切れ）'),
            !detail.correct && [h('dt', null, '正解'), h('dd', null, optionLabel(question, detail.correctIndex))]
          ),
          detail.explanation && h('p', { class: 'explanation' }, detail.explanation)
        );
      })
    ),
    h('div', { class: 'actions center' }, h('a', { class: 'button ghost', href: '#/' }, 'ほかのクイズを見る'))
  );
}
