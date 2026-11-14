import { LIMITS, QUIZ_STATUS, STATUS_LABELS } from '../shared/contracts.js';
import { h } from '../shared/dom.js';

/**
 * クイズ一覧画面。
 *
 * 検索・状態の絞り込み・続きの読み込みはサーバー側で行う（件数が増えても全件を取得しない）。
 * 上部の件数タイルは、絞り込みに関係なく全体の状態別件数を表示する。
 */

const dateFormat = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
const SEARCH_DELAY_MS = 250;

/**
 * @param {{ quizzes: object[], total: number, counts: Record<string, number>, nextCursor: string | null }} firstPage
 * @param {{ load: (query: { q: string, status: string, cursor?: string }) => Promise<object>, onToggleStatus: Function, onDuplicate: Function }} handlers
 *   load は失敗時に、利用者向けメッセージを message に持つ Error を投げる。
 */
export function listView(firstPage, { load, onToggleStatus, onDuplicate }) {
  const { counts } = firstPage;
  const tbody = h('tbody');
  const summary = h('p', { class: 'list-summary', role: 'status' });
  const search = h('input', { type: 'search', placeholder: 'タイトル・slugで検索', 'aria-label': 'クイズを検索', maxLength: LIMITS.search });
  const filter = h(
    'select',
    { 'aria-label': '状態で絞り込み' },
    h('option', { value: '' }, 'すべての状態'),
    Object.values(QUIZ_STATUS).map(status => h('option', { value: status }, STATUS_LABELS[status]))
  );
  const noMatch = h('p', { class: 'list-empty', hidden: true }, '条件に合うクイズはありません。');
  const moreButton = h('button', { type: 'button', class: 'button more-button', hidden: true }, 'もっと見る');

  let cursor = null;
  let total = 0;
  /** 表示中の一覧を取得した時の条件。「もっと見る」は入力欄の今の値ではなく、必ずこの条件の続きを取る。 */
  let activeQuery = { q: '', status: '' };
  /** 検索のたびに進める番号。遅れて届いた古い検索結果で一覧を上書きしないために使う。 */
  let requestId = 0;
  let timer = 0;

  const rowsFor = page => page.quizzes.map(quiz => row(quiz, { onToggleStatus, onDuplicate }));
  const query = () => ({ q: search.value.trim(), status: filter.value });

  function show(page, { append }) {
    const rows = rowsFor(page);
    if (append) tbody.append(...rows);
    else tbody.replaceChildren(...rows);
    cursor = page.nextCursor;
    total = page.total;
    moreButton.hidden = !cursor;
    noMatch.hidden = tbody.children.length > 0;
    const shown = tbody.children.length;
    summary.textContent = shown < total ? `${total}件中 ${shown}件を表示` : `${total}件`;
    return rows;
  }

  /**
   * 条件が変わった瞬間に呼ぶ。新しい 1 ページ目が届くまで「もっと見る」を出さず、
   * 取得中だった続きの応答も捨てる（新しい条件に、前の条件の続きを混ぜないため）。
   */
  function invalidate() {
    requestId += 1;
    cursor = null;
    moreButton.hidden = true;
  }

  async function reload() {
    invalidate();
    const id = requestId;
    const next = query();
    summary.textContent = '検索中…';
    try {
      const page = await load(next);
      if (id !== requestId) return;
      activeQuery = next;
      show(page, { append: false });
    } catch (error) {
      if (id === requestId) summary.textContent = error.message;
    }
  }

  search.addEventListener('input', () => {
    invalidate();
    clearTimeout(timer);
    timer = setTimeout(reload, SEARCH_DELAY_MS);
  });
  filter.addEventListener('change', () => {
    clearTimeout(timer);
    reload();
  });
  moreButton.addEventListener('click', async () => {
    const id = (requestId += 1);
    moreButton.disabled = true;
    try {
      const page = await load({ ...activeQuery, cursor });
      if (id !== requestId) return;
      const rows = show(page, { append: true });
      // 追加分の先頭へフォーカスを移し、キーボード操作で続きから操作できるようにする
      rows[0]?.querySelector('a')?.focus();
    } catch (error) {
      if (id === requestId) summary.textContent = error.message;
    } finally {
      moreButton.disabled = false;
    }
  });

  show(firstPage, { append: false });

  return [
    h(
      'div',
      { class: 'stats' },
      stat('すべて', counts.all),
      stat(STATUS_LABELS.published, counts.published),
      stat(STATUS_LABELS.draft, counts.draft),
      stat(STATUS_LABELS.archived, counts.archived)
    ),
    counts.all
      ? h(
          'div',
          { class: 'panel' },
          h('div', { class: 'toolbar' }, search, filter, summary),
          h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 'quiz-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', { scope: 'col' }, 'タイトル'),
                  h('th', { scope: 'col' }, '状態'),
                  h('th', { scope: 'col', class: 'num' }, '問題数'),
                  h('th', { scope: 'col' }, '最終更新'),
                  h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, '操作'))
                )
              ),
              tbody
            ),
            noMatch,
            moreButton
          )
        )
      : h('div', { class: 'empty' }, h('p', null, 'まだクイズがありません。'), h('a', { class: 'button primary', href: '#/new' }, '最初のクイズを作る'))
  ];
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('strong', null, value), h('span', null, label));
}

function row(quiz, { onToggleStatus, onDuplicate }) {
  const published = quiz.status === QUIZ_STATUS.PUBLISHED;
  return h(
    'tr',
    null,
    h(
      'td',
      null,
      h('a', { class: 'title-link', href: `#/edit/${encodeURIComponent(quiz.id)}` }, quiz.title),
      // 公開中なら slug を公開ページへのリンクにする（回答者と同じ画面をすぐ確かめられる）
      quiz.publicUrl
        ? h('a', { class: 'slug-link', href: quiz.publicUrl, target: '_blank', rel: 'noopener noreferrer' }, quiz.slug, h('span', { class: 'visually-hidden' }, '（公開ページを新しいタブで開く）'))
        : h('small', null, quiz.slug)
    ),
    h('td', null, h('span', { class: `status status-${quiz.status}` }, STATUS_LABELS[quiz.status])),
    h('td', { class: 'num' }, quiz.questionCount),
    h('td', null, h('time', { datetime: quiz.updatedAt }, dateFormat.format(new Date(quiz.updatedAt)))),
    h(
      'td',
      { class: 'actions-cell' },
      h(
        'div',
        { class: 'row-actions' },
        h('a', { class: 'button small', href: `#/edit/${encodeURIComponent(quiz.id)}` }, '編集'),
        h('a', { class: 'button small', href: `#/insights/${encodeURIComponent(quiz.id)}` }, '分析'),
        h('button', { type: 'button', class: 'button small', onclick: event => onDuplicate(quiz, event.currentTarget) }, '複製'),
        h(
          'button',
          { type: 'button', class: `button small ${published ? '' : 'primary'}`, onclick: event => onToggleStatus(quiz, event.currentTarget) },
          published ? '非公開にする' : '公開する'
        )
      )
    )
  );
}
