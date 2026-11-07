import { errorMessage } from '../shared/contracts.js';
import { copyText, createToast, mount } from '../shared/dom.js';
import { fetchQuiz, fetchQuizzes, submitAttempt } from './api.js';
import { QuizSession, formatDuration } from './session.js';
import { errorView, homeView, introView, loadingView, questionView, quizHref, resultView } from './views.js';

/**
 * 公開画面のコントローラー。URL の hash で画面を決め、状態遷移とタイマーを管理する。
 *
 *   #/            クイズ一覧（旧URL #quizzes も同じ）
 *   #quiz/<slug>  クイズ（共有URLの形式。導入 → 設問 → 結果）
 */

const BRAND = 'Qraft';
const root = document.querySelector('#app');
const announcer = document.querySelector('#announcer');
const notify = createToast(document.querySelector('#toast'));

let session = null;
let timer = 0;
let lastAnnounced = null;

function setTitle(title) {
  document.title = title ? `${title} | ${BRAND}` : `${BRAND} — 4択クイズ`;
}

function announce(message) {
  announcer.textContent = message;
}

function showError(error, retry) {
  const notFound = error.code === 'not_found';
  setTitle(notFound ? 'クイズが見つかりません' : 'エラー');
  mount(
    root,
    errorView({
      title: notFound ? 'クイズが見つかりません' : '読み込めませんでした',
      message: errorMessage(error.code),
      onRetry: notFound ? null : retry
    })
  );
}

/* ───────────── 画面 ───────────── */

async function showHome() {
  setTitle(null);
  mount(root, loadingView());
  try {
    mount(root, homeView(await fetchQuizzes()));
  } catch (error) {
    showError(error, showHome);
  }
}

async function showQuiz(slug) {
  mount(root, loadingView('クイズを準備しています…'));
  try {
    const quiz = await fetchQuiz(slug);
    setTitle(quiz.title);
    mount(root, introView(quiz, { onStart: () => start(quiz) }));
  } catch (error) {
    showError(error, () => showQuiz(slug));
  }
}

function start(quiz) {
  session = new QuizSession(quiz);
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
    mount(
      root,
      resultView(current, result, {
        shareUrl: shareUrl(current.quiz.slug),
        onCopy: async () => notify((await copyText(shareUrl(current.quiz.slug))) ? 'リンクをコピーしました' : 'コピーできませんでした。アドレスバーのURLをご利用ください'),
        onRetry: () => start(current.quiz)
      })
    );
  } catch (error) {
    if (session !== current) return;
    current.status = 'playing';
    showError(error, () => finish(timedOut));
  }
}

function shareUrl(slug) {
  return new URL(quizHref(slug), `${location.origin}${location.pathname}`).href;
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
document.addEventListener('keydown', event => {
  if (session?.status !== 'playing' || event.altKey || event.ctrlKey || event.metaKey) return;
  const form = root.querySelector('.question-card');
  if (!form) return;
  const index = '1234'.indexOf(event.key) >= 0 ? '1234'.indexOf(event.key) : 'abcd'.indexOf(event.key.toLowerCase());
  if (index >= 0 && event.key.length === 1) {
    const radio = form.querySelectorAll('input[name="answer"]')[index];
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

function route() {
  stopTimer();
  session = null;
  const hash = location.hash.replace(/^#\/?/, '');
  if (!hash.startsWith('quiz/')) return showHome();
  try {
    showQuiz(decodeURIComponent(hash.slice('quiz/'.length)));
  } catch {
    showError({ code: 'not_found' });
  }
}

window.addEventListener('hashchange', route);
route();
