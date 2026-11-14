import { errorMessage } from '../shared/contracts.js';
import { copyText, createToast, installSkipLink, mount } from '../shared/dom.js';
import { fetchQuiz, fetchQuizzes, startSession, submitAttempt } from './api.js';
import { QuizSession, formatDuration, shareText } from './session.js';
import { errorView, homeView, introView, loadingView, questionView, resultView } from './views.js';

/**
 * 公開画面のコントローラー。URL の hash で画面を決め、状態遷移とタイマーを管理する。
 *
 *   #/            クイズ一覧（旧URL #quizzes も同じ）
 *   #quiz/<slug>  クイズ（導入 → 設問 → 結果）。アプリ内のリンクはこの形式
 *   /q/<slug>     共有URL。サーバーが OGP タグを埋め込んだ同じ画面を返す（hash が無い時だけ使う）
 */

const BRAND = 'Qraft';
const root = document.querySelector('#app');
const announcer = document.querySelector('#announcer');
const notify = createToast(document.querySelector('#toast'));

let session = null;
let timer = 0;
let lastAnnounced = null;

/**
 * 画面遷移の世代番号。非同期の読み込みは開始時の番号を覚えておき、応答が届いた時点で
 * 番号が変わっていれば（＝利用者がもう別の画面へ移動していれば）結果を捨てる。
 * これがないと、遅れて届いた応答が今の画面を古い内容で上書きしてしまう。
 */
let generation = 0;
const nextGeneration = () => ++generation;
const isCurrent = token => token === generation;

function setTitle(title) {
  document.title = title ? `${title} | ${BRAND}` : `${BRAND} — 4択クイズ`;
}

function announce(message) {
  announcer.textContent = message;
}

/** 同じ挑戦では再送信しても通らない採点エラー。最初からやり直してもらう。 */
const RESTART_REQUIRED = new Set(['quiz_updated', 'attempt_expired', 'attempt_already_submitted', 'invalid_session', 'invalid_answers']);

/**
 * @param {{ code: string }} error
 * @param {(() => void) | null} [retry]
 * @param {{ title?: string, retryLabel?: string }} [options]
 */
function showError(error, retry, { title = '読み込めませんでした', retryLabel } = {}) {
  const notFound = error.code === 'not_found';
  setTitle(notFound ? 'クイズが見つかりません' : 'エラー');
  mount(
    root,
    errorView({
      title: notFound ? 'クイズが見つかりません' : title,
      message: errorMessage(error.code),
      onRetry: notFound ? null : retry,
      retryLabel
    })
  );
}

/* ───────────── 画面 ───────────── */

async function showHome() {
  const current = nextGeneration();
  setTitle(null);
  mount(root, loadingView());
  try {
    const page = await fetchQuizzes();
    if (!isCurrent(current)) return;
    mount(
      root,
      homeView(page, {
        loadMore: cursor =>
          fetchQuizzes(cursor).catch(error => {
            throw new Error(errorMessage(error.code));
          })
      })
    );
  } catch (error) {
    if (isCurrent(current)) showError(error, showHome);
  }
}

async function showQuiz(slug) {
  const current = nextGeneration();
  mount(root, loadingView('クイズを準備しています…'));
  try {
    const quiz = await fetchQuiz(slug);
    if (!isCurrent(current)) return;
    setTitle(quiz.title);
    mount(root, introView(quiz, { onStart: () => start(quiz) }));
  } catch (error) {
    if (isCurrent(current)) showError(error, () => showQuiz(slug));
  }
}

async function start(quiz) {
  const current = nextGeneration();
  stopTimer();
  session = null;
  mount(root, loadingView('準備しています…'));
  let started;
  try {
    started = await startSession(quiz.slug);
  } catch (error) {
    if (isCurrent(current)) showError(error, () => start(quiz), { title: '開始できませんでした' });
    return;
  }
  if (!isCurrent(current)) return;
  session = new QuizSession(started.quiz, started.token);
  lastAnnounced = null;
  renderQuestion();
  startTimer();
}

function renderQuestion() {
  mount(
    root,
    questionView(session, {
      onSelect: optionIndex => session.select(optionIndex),
      onPrevious: () => {
        session.previous();
        renderQuestion();
      },
      onNext: () => {
        if (session.isLast) finish(false);
        else {
          session.next();
          renderQuestion();
        }
      }
    })
  );
}

async function finish(timedOut) {
  if (session.status !== 'playing') return;
  session.status = 'submitting';
  stopTimer();
  mount(root, loadingView(timedOut ? '時間切れです。採点しています…' : '採点しています…'));

  const current = session;
  try {
    const result = await submitAttempt(current.quiz.slug, current.submission(timedOut));
    if (session !== current) return; // 採点中に別の画面へ移動した
    current.status = 'finished';
    announce(`採点結果: ${result.total}問中${result.score}問正解`);
    mount(
      root,
      resultView(current, result, {
        shareUrl: shareUrl(current.quiz.slug),
        onShare: navigator.share ? () => shareResult(current.quiz, result) : null,
        onCopy: async () => notify((await copyText(shareUrl(current.quiz.slug))) ? 'リンクをコピーしました' : 'コピーできませんでした。アドレスバーのURLをご利用ください'),
        onRetry: () => start(current.quiz)
      })
    );
  } catch (error) {
    if (session !== current) return;
    if (RESTART_REQUIRED.has(error.code)) {
      current.status = 'finished';
      return showError(error, () => showQuiz(current.quiz.slug), { title: '採点できませんでした', retryLabel: '最初から挑戦する' });
    }
    // 通信エラー等は同じ回答でそのまま再送できる（受付トークンは採点が成功するまで有効）。
    current.status = 'playing';
    showError(error, () => finish(timedOut), { title: '採点できませんでした', retryLabel: 'もう一度送信する' });
  }
}

/** 端末の共有メニュー（LINE・メール等）を開く。利用者が閉じた場合（AbortError）は何もしない。 */
async function shareResult(quiz, result) {
  try {
    await navigator.share({ title: `${quiz.title} | ${BRAND}`, text: shareText(quiz, result), url: shareUrl(quiz.slug) });
  } catch (error) {
    if (error?.name !== 'AbortError') notify('共有できませんでした。リンクをコピーしてお使いください');
  }
}

/** 共有URL。/q/<slug> はサーバー側で OGP タグが入るので、X 等でクイズ名がプレビューされる。 */
function shareUrl(slug) {
  return `${location.origin}/q/${encodeURIComponent(slug)}`;
}

/* ───────────── タイマー ───────────── */

function startTimer() {
  stopTimer();
  if (session.deadline === null) return;
  timer = setInterval(tick, 250);
}

function stopTimer() {
  clearInterval(timer);
  timer = 0;
}

function tick() {
  const seconds = session.remainingSeconds();
  const element = root.querySelector('[data-timer]');
  if (element) {
    element.textContent = formatDuration(seconds);
    element.classList.toggle('is-warning', seconds <= 10);
  }
  if ((seconds === 60 || seconds === 10) && lastAnnounced !== seconds) {
    lastAnnounced = seconds;
    announce(`残り${seconds}秒です`);
  }
  if (seconds === 0) finish(true);
}

/* ───────────── 入力・ルーティング ───────────── */

// 1〜4 / A〜D キーで選択、Enter で次へ。
// 1 文字のショートカットは、フォーカスがクイズの領域にある時だけ有効にする（WCAG 2.1.4）。
// ページ全体で効かせると、音声入力の言葉やスクリーンリーダーの 1 文字操作が回答として誤入力される。
document.addEventListener('keydown', event => {
  if (session?.status !== 'playing' || event.altKey || event.ctrlKey || event.metaKey) return;
  const form = /** @type {HTMLFormElement | null} */ (root.querySelector('.question-card'));
  if (!form || !root.contains(document.activeElement)) return;
  const index = '1234'.indexOf(event.key) >= 0 ? '1234'.indexOf(event.key) : 'abcd'.indexOf(event.key.toLowerCase());
  if (index >= 0 && event.key.length === 1) {
    const radio = /** @type {HTMLInputElement | undefined} */ (form.querySelectorAll('input[name="answer"]')[index]);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      radio.focus();
    }
  } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'radio') {
    event.preventDefault();
    form.requestSubmit();
  }
});

// 回答途中でタブを閉じようとしたら確認する。
window.addEventListener('beforeunload', event => {
  if (session?.hasProgress) event.preventDefault();
});

/** URL から表示するクイズの slug（エンコードされたまま）を取り出す。一覧なら null。 */
function slugFromUrl() {
  if (location.hash) {
    // 共有URL（/q/<slug>）から #/ などへ移動したら、パスを / に戻して URL を整える。
    if (location.pathname !== '/') history.replaceState(null, '', `/${location.hash}`);
    const hash = location.hash.replace(/^#\/?/, '');
    return hash.startsWith('quiz/') ? hash.slice('quiz/'.length) : null;
  }
  return /^\/q\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? null;
}

function route() {
  nextGeneration();
  stopTimer();
  session = null;
  const slug = slugFromUrl();
  if (slug === null) return showHome();
  try {
    showQuiz(decodeURIComponent(slug));
  } catch {
    showError({ code: 'not_found' });
  }
}

window.addEventListener('hashchange', route);
installSkipLink(document.querySelector('.skip-link'), root);
route();
