import { HttpError } from './http.js';

/**
 * 一覧の続きを指す不透明なカーソル（キーセット方式のページング用）。
 * 中身は「前ページ最後の行の並び替えキー」の JSON 配列を base64url にしたもの。
 *
 * 上限: 公開一覧の slug は最大 64 コードポイント × UTF-8 で最大 4 バイト = 256 バイト、
 * 日時と JSON の記号を足しても 320 バイト未満なので、base64url で 428 文字に収まる。
 * 余裕を持たせつつ、巨大な入力は解析前に拒否する。
 */
export const MAX_CURSOR_LENGTH = 512;

export function encodeCursor(values) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(values))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * @param {string} cursor
 * @param {(values: unknown[]) => boolean} isValid 中身の検証。false なら 400 invalid_cursor
 */
export function decodeCursor(cursor, isValid) {
  try {
    if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('format');
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(cursor.length / 4) * 4, '=');
    const values = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(base64), char => char.charCodeAt(0))));
    if (!Array.isArray(values) || !isValid(values)) throw new Error('value');
    return values;
  } catch {
    throw new HttpError(400, 'invalid_cursor');
  }
}

export const isTimestamp = value => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
