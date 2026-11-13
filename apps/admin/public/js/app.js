import { QUIZ_STATUS, errorMessage } from '../shared/contracts.js';
import { createToast, h, installSkipLink, mount } from '../shared/dom.js';
import * as api from './api.js';
import { clearDraft, debounce, loadDraft, saveDraft } from './drafts.js';
import { createEditor } from './editor.js';
import { insightsView } from './insights.js';
import { listView } from './list.js';

/**
 * 管理画面のコントローラー。
 *
 *   #/           クイズ一覧
 *   #/new        新規作成
 *   #/edit/<id>  編集
 *   #/insights/<id>  回答の分析と変更履歴
 *
 * hash で画面を表すので、再読み込みやブラウザの戻る操作でも同じ画面に戻れる。
 */

const root = document.querySelector('#app');
const pageTitle = document.querySelector('#page-title');
const notify = createToast(document.querySelector('#toast'));

/** 表示中の編集フォームと、その対象のクイズID（新規は null）。未保存の変更確認に使う。 */
let editor = null;
let editorQuizId = null;
/** 表示中の編集フォームの下書き自動保存（debounce）。 */
let autosave = null;
let currentHash = location.hash;

function setPage(title) {
  pageTitle.textContent = title;
  document.title = `${title} | Qraft Studio`;
  document.querySelectorAll('[data-nav]').forEach(link => {
    const active = link.getAttribute('href') === (location.hash || '#/');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function loading() {
  mount(root, h('div', { class: 'status-view', role: 'status', 'aria-busy': 'true' }, '読み込み中…'));
}

function failure(error, retry) {
  mount(
    root,
    h(
      'div',
      { class: 'status-view' },
      h('h1', { class: 'status-title' }, '読み込めませんでした'),
      h('p', null, errorMessage(error.code)),
      h(
        'div',
        { class: 'actions' },
        error.code === 'unauthorized'
          ? h('button', { type: 'button', class: 'button primary', onclick: () => location.reload() }, '再読み込み')
          : h('button', { type: 'button', class: 'button primary', onclick: retry }, 'もう一度試す'),
        h('a', { class: 'button', href: '#/' }, '一覧へ')
      )
    )
  );
}

/* ───────────── 一覧 ───────────── */

async function showList() {
  setPage('問題一覧');
  loading();
  try {
    const quizzes = await api.listQuizzes();
    mount(root, listView(quizzes, { onToggleStatus: toggleStatus, onDuplicate: duplicate }));
  } catch (error) {
    failure(error, showList);
  }
}

async function toggleStatus(quiz, button) {
  const next = quiz.status === QUIZ_STATUS.PUBLISHED ? QUIZ_STATUS.ARCHIVED : QUIZ_STATUS.PUBLISHED;
  const question =
    next === QUIZ_STATUS.PUBLISHED
      ? `「${quiz.title}」を公開しますか？回答者の一覧に表示されます。`
      : `「${quiz.title}」を非公開にしますか？回答者はアクセスできなくなります。`;
  if (!confirm(question)) return;
  button.disabled = true;
  try {
    await api.changeStatus(quiz.id, next, quiz.version);
    notify(next === QUIZ_STATUS.PUBLISHED ? '公開しました' : '非公開にしました');
    await showList();
  } catch (error) {
    notify(errorMessage(error.code));
    if (error.code === 'edit_conflict') await showList();
    else button.disabled = false;
  }
}

async function duplicate(quiz, button) {
  button.disabled = true;
  try {
    const copy = await api.duplicateQuiz(quiz.id);
    notify('複製しました（下書き）');
    navigate(`#/edit/${encodeURIComponent(copy.id)}`);
  } catch (error) {
    notify(errorMessage(error.code));
    button.disabled = false;
  }
}

/* ───────────── 分析 ───────────── */

async function showInsights(id) {
  setPage('クイズの分析');
  loading();
  try {
    const [quiz, stats, history] = await Promise.all([api.getQuiz(id), api.getStats(id), api.getHistory(id)]);
    document.title = `${quiz.title} の分析 | Qraft Studio`;
    mount(root, insightsView(quiz, stats, history));
  } catch (error) {
    failure(error, () => showInsights(id));
  }
}

/* ───────────── 作成・編集 ───────────── */

async function showEditor(id) {
  setPage(id ? 'クイズを編集' : '新規クイズ');
  let quiz = null;
  if (id) {
    loading();
    try {
      quiz = await api.getQuiz(id);
    } catch (error) {
      return failure(error, () => showEditor(id));
    }
  }

  openEditor(quiz, { draft: loadDraft(quiz?.id) });
}

/**
 * 編集フォームを表示する。draft があれば「復元／破棄」の案内を出し、
 * restore を渡すとその下書きの内容で欄を埋める。
 */
function openEditor(quiz, { draft = null, restore = null } = {}) {
  autosave?.cancel();
  const quizId = quiz?.id ?? null;
  editorQuizId = quizId;
  // このフォーム自身を参照する（別の画面へ移った後に、別のクイズの下書きとして保存しない）。
  const form = createEditor(quiz, {
    initial: restore?.data,
    notice: draft && !restore ? draftNotice(quiz, draft) : null,
    onChange: () => autosave(),
    onCancel: () => navigate('#/'),
    onDelete: target => remove(target),
    onSubmit: (payload, button) => save(quiz, payload, button)
  });
  autosave = debounce(() => {
    if (form.isDirty()) saveDraft(quizId, quiz?.version ?? null, form.read());
  }, 400);
  editor = form;
  mount(root, editor.element);
  if (restore) autosave();
}

function draftNotice(quiz, draft) {
  const savedAt = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draft.savedAt));
  const outdated = quiz && draft.baseVersion !== quiz.version;
  const notice = h(
    'div',
    { class: 'draft-notice', role: 'status' },
    h(
      'p',
      null,
      `保存していない編集内容があります（${savedAt} に自動保存）。`,
      outdated && h('strong', null, 'この下書きの後にクイズが更新されています。復元して保存すると、その更新を上書きします。')
    ),
    h(
      'div',
      { class: 'draft-actions' },
      h('button', { type: 'button', class: 'button primary', onclick: () => openEditor(quiz, { restore: draft }) }, '復元する'),
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          onclick: () => {
            clearDraft(quiz?.id);
            notice.remove();
          }
        },
        '破棄する'
      )
    )
  );
  return notice;
}

async function save(quiz, payload, button) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    if (quiz) await api.updateQuiz(quiz.id, payload);
    else await api.createQuiz(payload);
    editor.markClean();
    autosave?.cancel();
    clearDraft(quiz?.id);
    notify(quiz ? '保存しました' : '下書きとして保存しました。一覧から公開できます');
    navigate('#/');
  } catch (error) {
    if (error.code === 'edit_conflict') {
      if (confirm(`${errorMessage(error.code)}\n\n最新の内容を読み込みますか？（この画面の変更は破棄されます）`)) {
        editor.markClean();
        autosave?.cancel();
        clearDraft(quiz.id);
        showEditor(quiz.id);
      }
    } else if (error.status === 400) {
      editor.showServerError(error);
    } else {
      notify(errorMessage(error.code));
    }
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function remove(quiz) {
  if (!confirm(`「${quiz.title}」を完全に削除しますか？この操作は取り消せません。`)) return;
  try {
    await api.deleteQuiz(quiz.id);
    editor.markClean();
    autosave?.cancel();
    clearDraft(quiz.id);
    notify('削除しました');
    navigate('#/');
  } catch (error) {
    notify(errorMessage(error.code));
  }
}

/* ───────────── ルーティング ───────────── */

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function confirmDiscard() {
  return !editor?.isDirty() || confirm('保存していない変更があります。破棄して移動しますか？');
}

function route() {
  const discarding = Boolean(editor?.isDirty());
  if (!confirmDiscard()) {
    // 移動を取り消し、URL を元に戻す（replaceState は hashchange を発火しない）。
    history.replaceState(null, '', currentHash || '#/');
    return;
  }
  // 「破棄して移動」を選んだら自動保存の下書きも消す（タブを閉じた場合は残して次回復元できる）。
  autosave?.cancel();
  autosave = null;
  if (discarding) clearDraft(editorQuizId);
  currentHash = location.hash;
  editor = null;

  const path = location.hash.replace(/^#/, '') || '/';
  const [, page, id] = /^\/(edit|insights)\/(.+)$/.exec(path) ?? [];
  if (path === '/new') showEditor(null);
  else if (page === 'edit') showEditor(decodeURIComponent(id));
  else if (page === 'insights') showInsights(decodeURIComponent(id));
  else showList();
}

window.addEventListener('hashchange', route);

// ページを閉じる・再読み込みする直前に、保存待ちの下書きを書き込んでから確認を出す。
window.addEventListener('beforeunload', event => {
  autosave?.flush();
  if (editor?.isDirty()) event.preventDefault();
});
// モバイル等で beforeunload が来ない場合（タブの切り替え後に破棄される等）にも書き込む。
window.addEventListener('pagehide', () => autosave?.flush());

// Ctrl/⌘ + S で保存。
document.addEventListener('keydown', event => {
  if (editor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    editor.submit();
  }
});

installSkipLink(document.querySelector('.skip-link'), root);
route();
