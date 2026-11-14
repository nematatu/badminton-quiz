import { OPTION_COUNT } from '../../../packages/shared/src/contracts.js';

/**
 * 選択肢の並び順（回答者ごと）。
 *
 * 並び順は受付トークンのセッションID から決定的に作るので、どこにも保存せずに
 * 「開始時に見せた順番」と「採点時に使う順番」が必ず一致する。
 * 並び順は正解を表さない（どの選択肢が正解かはサーバーだけが知っている）ため、秘密にする必要はない。
 *
 * order[表示位置] = 元の位置。
 */

/**
 * @param {string} sessionId
 * @param {number} questionCount
 * @returns {Promise<number[][]>}
 */
export async function optionOrders(sessionId, questionCount) {
  const digest = new Uint32Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`options:${sessionId}`)));
  const random = sfc32(digest[0], digest[1], digest[2], digest[3]);
  return Array.from({ length: questionCount }, () => {
    const order = Array.from({ length: OPTION_COUNT }, (_, index) => index);
    // Fisher–Yates
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    return order;
  });
}

/** 小さく十分に偏りの少ない擬似乱数（sfc32）。同じシードなら同じ列を返す。 */
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
}
