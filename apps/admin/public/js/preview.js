import { describeQuiz } from '../shared/contracts.js';
import { h } from '../shared/dom.js';

/**
 * 公開前のプレビュー。編集中の内容（保存前でもよい）を、回答者に見える形で確認する。
 *
 * ネイティブの <dialog> をモーダルで開くので、フォーカスの閉じ込め・Esc で閉じる・
 * 背面の操作不可はブラウザが行う。閉じたら DOM から取り除く。
 */

const LETTERS = ['A', 'B', 'C', 'D'];
const EMPTY = '（未入力）';

export function openPreview(data) {
  const close = h('button', { type: 'button', class: 'button', onclick: () => dialog.close() }, '閉じる');
  const questionCount = data.questions.length;

  const dialog = h(
    'dialog',
    { class: 'preview', 'aria-labelledby': 'preview-title' },
    h(
      'div',
      { class: 'preview-head' },
      h('div', null, h('p', { class: 'eyebrow' }, 'プレビュー（回答者の見え方）'), h('h2', { id: 'preview-title' }, data.title.trim() || EMPTY)),
      close
    ),
    h('p', { class: 'muted' }, describeQuiz({ questionCount, timeLimitSeconds: data.timeLimitSeconds })),
    data.description.trim() && h('p', null, data.description.trim()),
    data.shuffleOptions && h('p', { class: 'notice' }, '回答者には、選択肢が挑戦ごとに入れ替わった順番で表示されます（ここでは入力した順番です）。'),
    h(
      'ol',
      { class: 'preview-questions' },
      data.questions.map((question, index) =>
        h(
          'li',
          { class: 'preview-question' },
          h('p', { class: 'preview-label' }, `第${index + 1}問`),
          h('p', { class: 'preview-prompt' }, question.prompt.trim() || EMPTY),
          h(
            'ul',
            { class: 'preview-options' },
            question.options.map((option, optionIndex) =>
              h(
                'li',
                { class: optionIndex === question.correctIndex ? 'is-correct' : null },
                h('span', { class: 'preview-key', 'aria-hidden': 'true' }, LETTERS[optionIndex]),
                h('span', null, option.trim() || EMPTY),
                optionIndex === question.correctIndex && h('span', { class: 'correct-tag' }, '正解')
              )
            )
          ),
          question.explanation.trim() && h('p', { class: 'preview-explanation' }, `解説: ${question.explanation.trim()}`)
        )
      )
    )
  );

  dialog.addEventListener('close', () => dialog.remove());
  // 枠の外（背景）をクリックしても閉じる
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  return dialog;
}
