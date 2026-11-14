/**
 * 自分の記録（前回と自己ベスト）を、このブラウザの localStorage に保存する。
 *
 * サーバーには送らない（個人を特定する情報を持たない方針のまま）。
 * 問題数が変わったクイズでは、以前の記録と比べられないので扱わない。
 * localStorage が使えない環境（プライベートモード等）では記録しないだけで、遊ぶのには影響しない。
 */

const PREFIX = 'qraft:record:';

/**
 * @typedef {{ total: number, best: number, last: number, plays: number, updatedAt: string }} QuizRecord
 */

/**
 * @param {string} slug
 * @param {number} total 現在の問題数
 * @returns {QuizRecord | null}
 */
export function loadRecord(slug, total) {
  try {
    const record = JSON.parse(localStorage.getItem(PREFIX + slug));
    const valid =
      record &&
      record.total === total &&
      [record.best, record.last, record.plays].every(value => Number.isInteger(value) && value >= 0) &&
      record.best <= total &&
      record.last <= total;
    return valid ? record : null;
  } catch {
    return null;
  }
}

/**
 * 結果を記録し、記録を更新したかを返す。
 * @param {string} slug
 * @param {{ score: number, total: number }} result
 * @returns {{ record: QuizRecord | null, previous: QuizRecord | null, isNewBest: boolean }}
 */
export function saveRecord(slug, { score, total }) {
  const previous = loadRecord(slug, total);
  const record = {
    total,
    best: Math.max(score, previous?.best ?? 0),
    last: score,
    plays: (previous?.plays ?? 0) + 1,
    updatedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(PREFIX + slug, JSON.stringify(record));
  } catch {
    return { record: null, previous, isNewBest: false };
  }
  // 初回は「更新」とは言わない（比べる記録が無い）
  return { record, previous, isNewBest: previous !== null && score > previous.best };
}
