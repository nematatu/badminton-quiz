import { h } from '../shared/dom.js';
import { describeQuiz } from '../shared/contracts.js';
import { formatDuration, resultMessage, shareText } from './session.js';

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

function quizItem(quiz) {
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'quiz-card', href: quizHref(quiz.slug) },
      h('span', { class: 'quiz-card-body' }, h('strong', null, quiz.title), quiz.description && h('span', { class: 'muted' }, quiz.description)),
      h('span', { class: 'quiz-card-meta' }, describeQuiz(quiz), h('span', { 'aria-hidden': 'true' }, ' →'))
    )
  );
}

/**
 * トップ（一覧）。page は最初の 1 ページ。続きは「もっと見る」で loadMore(cursor) を呼んで追加する。
 */
export function homeView(page, { loadMore }) {
  const list = h('ul', { class: 'quiz-list' }, page.quizzes.map(quizItem));
  const status = h('p', { class: 'list-status', role: 'status' });
  let cursor = page.nextCursor;
  const moreButton = h(
    'button',
    {
      type: 'button',
      class: 'button ghost wide',
      hidden: !cursor,
      onclick: async () => {
        moreButton.disabled = true;
        status.textContent = '読み込み中…';
        try {
          const next = await loadMore(cursor);
          const items = next.quizzes.map(quizItem);
          list.append(...items);
          cursor = next.nextCursor;
          moreButton.hidden = !cursor;
          status.textContent = `${list.children.length}件を表示中`;
          // 追加分の先頭へフォーカスを移し、キーボード操作で続きから選べるようにする
          items[0]?.querySelector('a').focus();
        } catch (error) {
          status.textContent = error.message;
        } finally {
          moreButton.disabled = false;
        }
      }
    },
    'もっと見る'
  );

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
      h('div', { class: 'section-head' }, h('h2', { id: 'catalog-title' }, '公開中のクイズ'), h('span', { class: 'count' }, `${page.total}件`)),
      page.quizzes.length ? [list, moreButton, status] : h('p', { class: 'empty' }, '公開中のクイズはまだありません。')
    )
  ];
}

/**
 * 導入画面。record はこのブラウザでの前回・自己ベスト（無ければ null）。
 */
export function introView(quiz, { onStart, record = null }) {
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
      record &&
        h(
          'p',
          { class: 'record' },
          `前回 ${record.last} / ${record.total}問正解・自己ベスト ${record.best} / ${record.total}問`,
          record.plays > 1 && `（${record.plays}回挑戦）`
        ),
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

/**
 * 結果画面。onShare は端末の共有メニュー（Web Share API）を開く関数。
 * 対応していないブラウザでは null を渡し、ボタンを出さない。
 */
export function resultView(session, result, { shareUrl, onShare, onCopy, onRetry, onPractice = null, progress = null }) {
  const { quiz } = session;
  const message = resultMessage(result.score, result.total);
  // URLSearchParams は空白を + にするため、確実に解釈される %20 形式で組み立てる。
  const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText(quiz, result))}&url=${encodeURIComponent(shareUrl)}`;

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
      progress?.isNewBest && h('p', { class: 'new-best' }, `自己ベスト更新！（前回までのベスト ${progress.previous.best}問）`),
      progress && !progress.isNewBest && progress.previous && h('p', { class: 'muted' }, `自己ベスト ${progress.record?.best ?? progress.previous.best} / ${result.total}問`),
      h(
        'div',
        { class: 'actions center' },
        h('a', { class: 'button', href: intent, target: '_blank', rel: 'noopener noreferrer' }, 'Xでシェア'),
        onShare && h('button', { type: 'button', class: 'button ghost', onclick: onShare }, 'ほかのアプリで共有'),
        h('button', { type: 'button', class: 'button ghost', onclick: onCopy }, 'リンクをコピー'),
        h('button', { type: 'button', class: 'button ghost', onclick: onRetry }, 'もう一度挑戦')
      ),
      onPractice &&
        h(
          'p',
          { class: 'practice-cta' },
          h('button', { type: 'button', class: 'button', onclick: onPractice }, `間違えた ${result.total - result.score} 問を復習する`),
          h('span', { class: 'practice-note' }, '記録には残りません')
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

/**
 * 間違えた問題の復習画面（1 問ずつ、確かめるとすぐに正誤と解説が出る）。
 * 確かめた後は選択肢を固定し、結果を読み上げてから「次へ」にフォーカスを移す。
 * @param {import('./session.js').PracticeSession} practice
 */
export function practiceView(practice, { onSelect, onCheck, onNext, onExit }) {
  const { item, checked } = practice;
  const { question } = item;
  const nextLabel = practice.isLast ? '復習を終える' : '次の問題へ';

  const feedback =
    checked &&
    h(
      'div',
      { class: `practice-feedback ${practice.isCorrect ? 'is-correct' : 'is-wrong'}`, role: 'status' },
      h('p', { class: 'review-head' }, h('span', { class: 'badge' }, practice.isCorrect ? '正解' : '不正解'), !practice.isCorrect && h('span', null, `正解は ${LETTERS[item.correctIndex]}. ${question.options[item.correctIndex]}`)),
      item.explanation && h('p', { class: 'explanation' }, item.explanation)
    );

  const actionButton = checked
    ? h('button', { type: 'button', class: 'button', 'data-practice-next': '', onclick: onNext }, nextLabel)
    : h('button', { type: 'submit', class: 'button', disabled: practice.selected === null }, '答えを確かめる');

  const form = h(
    'form',
    {
      class: 'card question-card',
      onsubmit: event => {
        event.preventDefault();
        if (!practice.checked && practice.selected !== null) onCheck();
      },
      onchange: event => {
        if (event.target.name !== 'answer') return;
        onSelect(Number(event.target.value));
        if (actionButton instanceof HTMLButtonElement && actionButton.type === 'submit') actionButton.disabled = false;
      }
    },
    h(
      'fieldset',
      { disabled: checked },
      h('legend', { class: 'question-label' }, h('span', null, '復習'), h('span', null, `第${item.number + 1}問`)),
      h('h1', { class: 'question-title' }, question.prompt),
      h(
        'div',
        { class: 'answers' },
        question.options.map((option, optionIndex) =>
          h(
            'label',
            {
              class: ['answer', checked && optionIndex === item.correctIndex && 'is-answer', checked && optionIndex === practice.selected && optionIndex !== item.correctIndex && 'is-mistake']
                .filter(Boolean)
                .join(' ')
            },
            h('input', { type: 'radio', name: 'answer', value: String(optionIndex), checked: practice.selected === optionIndex }),
            h('span', { class: 'answer-key', 'aria-hidden': 'true' }, LETTERS[optionIndex]),
            h('span', { class: 'answer-text' }, option),
            // 色だけに頼らず、どれが正解でどれを選んだかを文字でも示す
            checked && optionIndex === item.correctIndex && h('span', { class: 'answer-mark' }, '正解'),
            checked && optionIndex === practice.selected && optionIndex !== item.correctIndex && h('span', { class: 'answer-mark' }, 'あなたの回答')
          )
        )
      )
    ),
    feedback,
    h('div', { class: 'question-actions' }, h('button', { type: 'button', class: 'button ghost', onclick: onExit }, '結果に戻る'), actionButton)
  );

  return h(
    'section',
    { class: 'narrow' },
    h('div', { class: 'progress-row' }, h('span', { class: 'progress-count' }, `復習 ${practice.index + 1} / ${practice.total}`)),
    form
  );
}

/** 復習の終わり。まだ間違えた問題があれば、それだけをもう一度復習できる。 */
export function practiceDoneView(practice, { onAgain, onExit, onRetry }) {
  const remaining = practice.total - practice.score;
  return h(
    'section',
    { class: 'narrow result' },
    h(
      'div',
      { class: 'card result-card' },
      h('p', { class: 'eyebrow' }, practice.quiz.title),
      h('p', { class: 'score' }, h('strong', null, practice.score), h('span', null, ` / ${practice.total}問`)),
      h('h1', null, remaining ? `復習おつかれさまでした。あと ${remaining} 問です。` : '復習した問題をすべて正解しました！'),
      h(
        'div',
        { class: 'actions center' },
        remaining > 0 && h('button', { type: 'button', class: 'button', onclick: onAgain }, `間違えた ${remaining} 問をもう一度`),
        h('button', { type: 'button', class: remaining ? 'button ghost' : 'button', onclick: onRetry }, 'もう一度挑戦（記録に残る）'),
        h('button', { type: 'button', class: 'button ghost', onclick: onExit }, '結果に戻る')
      )
    )
  );
}
