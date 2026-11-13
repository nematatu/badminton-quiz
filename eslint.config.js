import js from '@eslint/js';
import globals from 'globals';

/**
 * 静的解析の設定。実行環境ごとに使えるグローバルが違うので、ディレクトリ別に指定する。
 * 整形（インデント等）は対象にせず、誤りにつながるものだけを検出する。
 */
export default [
  { ignores: ['**/node_modules/', '**/.wrangler/', 'apps/*/public/shared/'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-globals': 'error',
      'no-shadow': 'error',
      'no-await-in-loop': 'off'
    }
  },
  // ブラウザで動くコード（画面と共有の DOM ヘルパー）
  { files: ['apps/*/public/**/*.js', 'packages/shared/src/dom.js'], languageOptions: { globals: globals.browser } },
  // Cloudflare Workers / Pages Functions（Web 標準 API のみ）
  { files: ['workers/**/*.js', 'apps/*/functions/**/*.js', 'packages/shared/src/contracts.js'], languageOptions: { globals: { ...globals.serviceworker } } },
  // Node.js で動くスクリプトとテスト
  { files: ['scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
  // E2E はブラウザ内で評価する関数（page.evaluate）を含む
  { files: ['scripts/e2e.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } }
];
