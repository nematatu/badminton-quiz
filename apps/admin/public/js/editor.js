import { LIMITS, OPTION_COUNT, QUESTION_FIELD_MESSAGES, QUIZ_STATUS, charLength, errorMessage } from '../shared/contracts.js';
import { h } from '../shared/dom.js';
import { openPreview } from './preview.js';

/**
 * クイズ編集フォーム。
 *
 * - 問題の追加・削除・並べ替えをしても番号とラジオボタンのグループ名が衝突しない
 *   （グループ名は連番ではなく作成時の一意IDで決める）。
 * - 入力の検証はブラウザ標準の制約検証 + 重複選択肢のカスタム検証。
 *   サーバーから返った欄単位のエラーも該当欄に表示する。
 * - 未保存の変更があるかを isDirty() で返す。変更のたびに onChange を呼ぶ（下書きの自動保存用）。
 * - initial を渡すと、quiz ではなくその内容で欄を埋める（自動保存した下書きの復元用）。
 */

let uid = 0;
const nextId = prefix => `${prefix}-${(uid += 1)}`;

export function createEditor(quiz, { onSubmit, onCancel, onDelete, onChange, initial, notice }) {
  let dirty = Boolean(initial);
  const values = initial ?? quiz;
  const changed = () => {
    dirty = true;
    onChange?.();
  };
  const isNew = !quiz;
  const questions = h('ol', { class: 'question-list' });
  const addButton = h('button', { type: 'button', class: 'button', onclick: () => addQuestion() }, '＋ 問題を追加');
  const formError = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const submitButton = h('button', { type: 'submit', class: 'button primary' }, isNew ? '下書きとして保存' : '保存する');

  const form = h(
    'form',
    {
      class: 'editor',
      novalidate: true,
      oninput: () => {
        changed();
      },
      onsubmit: event => {
        event.preventDefault();
        if (validate()) onSubmit(read(), submitButton);
      }
    },
    notice,
    quiz?.status === QUIZ_STATUS.PUBLISHED &&
      h('p', { class: 'banner' }, 'このクイズは公開中です。保存した内容はすぐに回答者へ反映されます。'),
    formError,
    h(
      'section',
      { class: 'panel' },
      h('h2', null, '基本情報'),
      field('タイトル', h('input', { name: 'title', required: true, maxLength: LIMITS.title, value: values?.title ?? '', autocomplete: 'off' }), { counter: LIMITS.title }),
      field('説明', h('textarea', { name: 'description', maxLength: LIMITS.description, rows: 3 }, values?.description ?? ''), {
        counter: LIMITS.description,
        hint: '一覧と導入画面に表示されます（任意）'
      }),
      field(
        '制限時間（秒）',
        h('input', {
          name: 'timeLimitSeconds',
          type: 'number',
          inputMode: 'numeric',
          min: LIMITS.timeLimitSeconds.min,
          max: LIMITS.timeLimitSeconds.max,
          step: 1,
          value: values?.timeLimitSeconds ?? '',
          placeholder: '空欄なら制限なし'
        }),
        { hint: `クイズ全体で${LIMITS.timeLimitSeconds.min}〜${LIMITS.timeLimitSeconds.max}秒。空欄なら時間制限なし。` }
      )
    ),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, '問題'), h('span', { class: 'muted', 'data-question-count': '' })), questions, addButton),
    h(
      'div',
      { class: 'action-bar' },
      h(
        'div',
        null,
        !isNew &&
          quiz.status !== QUIZ_STATUS.PUBLISHED &&
          h('button', { type: 'button', class: 'button danger', onclick: () => onDelete(quiz) }, '削除'),
        h('button', { type: 'button', class: 'button', onclick: () => openPreview(read()) }, 'プレビュー')
      ),
      h(
        'div',
        null,
        h('button', { type: 'button', class: 'button', onclick: onCancel }, 'キャンセル'),
        submitButton
      )
    )
  );

  /* ───────── 問題カード ───────── */

  function addQuestion(question, { focus = true } = {}) {
    if (questions.children.length >= LIMITS.questions) return;
    const group = nextId('correct');
    const card = h(
      'li',
      { class: 'question', 'data-question': '' },
      h(
        'div',
        { class: 'question-head' },
        h('h3', { 'data-number': '' }),
        h(
          'div',
          { class: 'question-tools' },
          h('button', { type: 'button', class: 'button small', 'data-move': '-1', onclick: () => move(card, -1) }, '↑', h('span', { class: 'visually-hidden' }, '上へ移動')),
          h('button', { type: 'button', class: 'button small', 'data-move': '1', onclick: () => move(card, 1) }, '↓', h('span', { class: 'visually-hidden' }, '下へ移動')),
          h('button', { type: 'button', class: 'button small', onclick: () => duplicate(card) }, '複製'),
          h('button', { type: 'button', class: 'button small danger', 'data-remove': '', onclick: () => remove(card) }, '削除')
        )
      ),
      h('p', { class: 'field-error', 'data-question-error': '', hidden: true }),
      field('問題文', h('textarea', { name: 'prompt', required: true, maxLength: LIMITS.prompt, rows: 2 }, question?.prompt ?? ''), { counter: LIMITS.prompt }),
      h(
        'fieldset',
        { class: 'options' },
        h('legend', null, '選択肢', h('span', { class: 'muted' }, '（正解をひとつ選ぶ）')),
        Array.from({ length: OPTION_COUNT }, (_, index) =>
          h(
            'div',
            { class: 'option' },
            h('input', {
              type: 'radio',
              name: group,
              value: String(index),
              checked: (question?.correctIndex ?? 0) === index,
              'aria-label': `選択肢${index + 1}を正解にする`
            }),
            h('input', {
              name: 'option',
              required: true,
              maxLength: LIMITS.option,
              value: question?.options?.[index] ?? '',
              placeholder: `選択肢 ${index + 1}`,
              'aria-label': `選択肢${index + 1}`,
              autocomplete: 'off'
            })
          )
        )
      ),
      field('解説', h('textarea', { name: 'explanation', maxLength: LIMITS.explanation, rows: 2 }, question?.explanation ?? ''), {
        counter: LIMITS.explanation,
        hint: '採点後に表示されます（任意）'
      })
    );
    questions.append(card);
    refresh();
    if (focus) card.querySelector('textarea').focus();
  }

  function move(card, offset) {
    const sibling = offset < 0 ? card.previousElementSibling : card.nextElementSibling;
    if (!sibling) return;
    if (offset < 0) sibling.before(card);
    else sibling.after(card);
    changed();
    refresh();
    card.querySelector(`[data-move="${offset}"]`)?.focus();
  }

  function duplicate(card) {
    if (questions.children.length >= LIMITS.questions) return;
    const [question] = readQuestions([card]);
    addQuestion(question, { focus: false });
    const copy = questions.lastElementChild;
    card.after(copy);
    changed();
    refresh();
    copy.querySelector('textarea').focus();
  }

  function remove(card) {
    const hasContent = [...card.querySelectorAll('textarea, input[name="option"]')].some(input => input.value.trim());
    if (hasContent && !confirm('この問題を削除しますか？')) return;
    const fallback = card.nextElementSibling ?? card.previousElementSibling;
    card.remove();
    changed();
    refresh();
    fallback?.querySelector('textarea')?.focus();
  }

  /** 番号・ボタンの有効/無効・件数表示を、現在の並びに合わせて更新する。 */
  function refresh() {
    const cards = [...questions.children];
    cards.forEach((card, index) => {
      card.querySelector('[data-number]').textContent = `第${index + 1}問`;
      /** @type {HTMLButtonElement} */ (card.querySelector('[data-move="-1"]')).disabled = index === 0;
      /** @type {HTMLButtonElement} */ (card.querySelector('[data-move="1"]')).disabled = index === cards.length - 1;
      /** @type {HTMLButtonElement} */ (card.querySelector('[data-remove]')).disabled = cards.length === 1;
    });
    addButton.disabled = cards.length >= LIMITS.questions;
    form.querySelector('[data-question-count]').textContent = `${cards.length} / ${LIMITS.questions}問`;
  }

  /* ───────── 読み取り・検証 ───────── */

  function readQuestions(cards) {
    return cards.map(card => ({
      prompt: card.querySelector('[name="prompt"]').value,
      options: [...card.querySelectorAll('[name="option"]')].map(input => input.value),
      correctIndex: Number(card.querySelector('input[type="radio"]:checked')?.value ?? 0),
      explanation: card.querySelector('[name="explanation"]').value
    }));
  }

  /** 名前でフォームの入力欄を取り出す（title / description / timeLimitSeconds）。 */
  const control = name => /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (form.elements.namedItem(name));

  function read() {
    const timeLimit = control('timeLimitSeconds').value.trim();
    return {
      title: control('title').value,
      description: control('description').value,
      timeLimitSeconds: timeLimit === '' ? null : Number(timeLimit),
      questions: readQuestions([...questions.children]),
      ...(quiz ? { version: quiz.version } : {})
    };
  }

  function clearErrors() {
    formError.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach(element => element.removeAttribute('aria-invalid'));
    form.querySelectorAll('[data-question-error]').forEach(element => {
      /** @type {HTMLElement} */ (element).hidden = true;
    });
    form.querySelectorAll('input[name="option"]').forEach(input => /** @type {HTMLInputElement} */ (input).setCustomValidity(''));
  }

  function validate() {
    clearErrors();
    // 重複選択肢（全角半角・大文字小文字を区別しない）を各選択肢の入力欄で知らせる。
    for (const card of questions.children) {
      const inputs = /** @type {HTMLInputElement[]} */ ([...card.querySelectorAll('input[name="option"]')]);
      const seen = new Map();
      for (const input of inputs) {
        const key = input.value.trim().normalize('NFKC').toLocaleLowerCase('ja');
        if (!key) continue;
        if (seen.has(key)) input.setCustomValidity(QUESTION_FIELD_MESSAGES.duplicate_options);
        else seen.set(key, input);
      }
    }
    // maxLength は UTF-16 単位なので、絵文字などで API の上限（コードポイント）とずれない。
    // フォーム内の入力欄・ボタン・fieldset はいずれも制約検証の API（willValidate 等）を持つ。
    const elements = /** @type {HTMLInputElement[]} */ ([...form.elements]);
    const invalid = elements.find(element => element.willValidate && !element.checkValidity());
    if (!invalid) return true;
    invalid.setAttribute('aria-invalid', 'true');
    invalid.reportValidity();
    return false;
  }

  /** API の 400 エラーを該当欄に表示する。表示できたら true。 */
  function showServerError(error) {
    clearErrors();
    if (error.code === 'invalid_question' && error.detail?.question) {
      const card = questions.children[error.detail.question - 1];
      if (card) {
        const message = /** @type {HTMLElement} */ (card.querySelector('[data-question-error]'));
        message.textContent = QUESTION_FIELD_MESSAGES[error.detail.field] ?? errorMessage(error.code);
        message.hidden = false;
        const target = { prompt: '[name="prompt"]', explanation: '[name="explanation"]' }[error.detail.field] ?? '[name="option"]';
        card.querySelector(target)?.setAttribute('aria-invalid', 'true');
        card.scrollIntoView({ block: 'center' });
        /** @type {HTMLElement | null} */ (card.querySelector(target))?.focus({ preventScroll: true });
        return true;
      }
    }
    const fieldByCode = { invalid_title: 'title', invalid_description: 'description', invalid_time_limit: 'timeLimitSeconds' };
    formError.textContent = errorMessage(error.code);
    formError.hidden = false;
    const input = fieldByCode[error.code] ? control(fieldByCode[error.code]) : null;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    } else {
      formError.scrollIntoView({ block: 'center' });
    }
    return true;
  }

  for (const question of values?.questions?.length ? values.questions : [null]) addQuestion(question, { focus: false });

  return {
    element: form,
    isDirty: () => dirty,
    read,
    markClean: () => {
      dirty = false;
    },
    showServerError,
    submit: () => form.requestSubmit(submitButton)
  };
}

/**
 * ラベル・文字数カウンター・補足を持つ入力欄。
 * @param {string} label
 * @param {HTMLInputElement | HTMLTextAreaElement} control
 * @param {{ counter?: number, hint?: string }} [options] counter は文字数の上限（カウンターを出す）
 */
function field(label, control, { counter, hint } = {}) {
  const id = nextId('field');
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);

  const count = counter ? h('span', { class: 'counter', 'aria-hidden': 'true' }) : null;
  const update = () => {
    if (!count) return;
    const used = charLength(control.value);
    count.textContent = `${used} / ${counter}`;
    count.classList.toggle('is-over', used > counter);
  };
  control.addEventListener('input', update);
  update();

  return h(
    'div',
    { class: 'field' },
    h('div', { class: 'field-label' }, h('label', { for: id }, label, control.required && h('span', { class: 'required' }, '必須')), count),
    control,
    hint && h('small', { id: hintId, class: 'hint' }, hint)
  );
}
