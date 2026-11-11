/**
 * 公開画面の実行時設定。
 *
 * API_ORIGIN はデプロイ前に実際の API ドメインへ置き換え、`_headers` の
 * CSP connect-src にも同じ値を入れる（`npm run preflight` が置き換え漏れを検出する）。
 * ローカル開発では `npm run dev` がこのファイルを `/api` 向けの内容で配信する。
 */
const PRODUCTION_API_ORIGIN = 'https://api.quiz.example.com';

const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const API_ORIGIN = isLocal ? '/api' : PRODUCTION_API_ORIGIN;
