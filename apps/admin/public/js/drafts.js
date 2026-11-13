/**
 * 編集中のクイズの下書きを、このブラウザの localStorage に自動保存する。
 *
 * タブを閉じた・ブラウザが落ちた・ログインが切れた等で入力が失われないようにするため。
 * サーバーには送らない（他の管理者には見えない）。localStorage が使えない環境では
 * 何もしない（保存できないだけで編集はできる）。
 */

const PREFIX = 'qraft:draft:';
const keyFor = quizId => `${PREFIX}${quizId ?? 'new'}`;

/**
 * @returns {{ savedAt: string, baseVersion: number | null, data: object } | null}
 */
export function loadDraft(quizId) {
  try {
    const draft = JSON.parse(localStorage.getItem(keyFor(quizId)));
    if (!draft || typeof draft.savedAt !== 'string' || typeof draft.data !== 'object' || !Array.isArray(draft.data?.questions)) return null;
    return draft;
  } catch {
    return null;
  }
}

/** baseVersion: 編集を始めた時点のクイズの version（新規は null）。復元時の上書き警告に使う。 */
export function saveDraft(quizId, baseVersion, data) {
  const { version: _, ...content } = data;
  try {
    localStorage.setItem(keyFor(quizId), JSON.stringify({ savedAt: new Date().toISOString(), baseVersion, data: content }));
  } catch {
    // 容量超過・プライベートモード等。保存できなくても編集は続けられる。
  }
}

export function clearDraft(quizId) {
  try {
    localStorage.removeItem(keyFor(quizId));
  } catch {
    // 同上
  }
}

/** 連続した入力をまとめて、最後の入力から wait ミリ秒後に 1 回だけ実行する。 */
export function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
