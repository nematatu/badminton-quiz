import { QUIZ_STATUS, STATUS_LABELS } from '../shared/contracts.js';
import { h } from '../shared/dom.js';

/**
 * クイズ一覧画面。検索と状態フィルタはクライアント側で行う（最大200件）。
 */

const dateFormat = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

export function listView(quizzes, { onToggleStatus }) {
  const counts = Object.fromEntries(Object.values(QUIZ_STATUS).map(status => [status, quizzes.filter(quiz => quiz.status === status).length]));
  const tbody = h('tbody');
  const summary = h('p', { class: 'list-summary', role: 'status' });
  const search = h('input', { type: 'search', placeholder: 'タイトル・slugで検索', 'aria-label': 'クイズを検索' });
  const filter = h(
    'select',
    { 'aria-label': '状態で絞り込み' },
    h('option', { value: '' }, 'すべての状態'),
    Object.values(QUIZ_STATUS).map(status => h('option', { value: status }, STATUS_LABELS[status]))
  );

  const render = () => {
    const keyword = search.value.trim().toLocaleLowerCase('ja');
    const visible = quizzes.filter(
      quiz => (!filter.value || quiz.status === filter.value) && (!keyword || `${quiz.title} ${quiz.slug}`.toLocaleLowerCase('ja').includes(keyword))
    );
    tbody.replaceChildren(...visible.map(quiz => row(quiz, onToggleStatus)));
    summary.textContent = visible.length === quizzes.length ? `${quizzes.length}件` : `${quizzes.length}件中 ${visible.length}件を表示`;
  };
  search.addEventListener('input', render);
  filter.addEventListener('change', render);
  render();

  return [
    h(
      'div',
      { class: 'stats' },
      stat('すべて', quizzes.length),
      stat(STATUS_LABELS.published, counts.published),
      stat(STATUS_LABELS.draft, counts.draft),
      stat(STATUS_LABELS.archived, counts.archived)
    ),
    quizzes.length
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
            )
          )
        )
      : h('div', { class: 'empty' }, h('p', null, 'まだクイズがありません。'), h('a', { class: 'button primary', href: '#/new' }, '最初のクイズを作る'))
  ];
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('strong', null, value), h('span', null, label));
}

function row(quiz, onToggleStatus) {
  const published = quiz.status === QUIZ_STATUS.PUBLISHED;
  return h(
    'tr',
    null,
    h('td', null, h('a', { class: 'title-link', href: `#/edit/${encodeURIComponent(quiz.id)}` }, quiz.title), h('small', null, quiz.slug)),
    h('td', null, h('span', { class: `status status-${quiz.status}` }, STATUS_LABELS[quiz.status])),
    h('td', { class: 'num' }, quiz.questionCount),
    h('td', null, h('time', { datetime: quiz.updatedAt }, dateFormat.format(new Date(quiz.updatedAt)))),
    h(
      'td',
      { class: 'row-actions' },
      h('a', { class: 'button small', href: `#/edit/${encodeURIComponent(quiz.id)}` }, '編集'),
      h(
        'button',
        { type: 'button', class: `button small ${published ? '' : 'primary'}`, onclick: event => onToggleStatus(quiz, event.currentTarget) },
        published ? '非公開にする' : '公開する'
      )
    )
  );
}
