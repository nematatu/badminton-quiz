/**
 * 本番デプロイ前の安全確認。プレースホルダーや設定の食い違いが 1 件でもあれば失敗する。
 * `npm run deploy:*` の前に自動で実行される。
 */
import { readFileSync } from 'node:fs';
import { outdatedFiles } from './sync-shared.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const problems = [];

const PLACEHOLDER = /example\.com|REPLACE/;
for (const path of ['workers/api/wrangler.toml', 'apps/admin/wrangler.toml', 'apps/web/wrangler.toml', 'apps/web/public/config.js', 'apps/web/public/_headers', 'apps/web/functions/_lib/security-headers.js']) {
  read(path)
    .split('\n')
    .forEach((line, index) => {
      if (!line.trim().startsWith('#') && PLACEHOLDER.test(line)) problems.push(`${path}:${index + 1} にプレースホルダーが残っています: ${line.trim()}`);
    });
}

const apiOrigin = /PRODUCTION_API_ORIGIN\s*=\s*'([^']+)'/.exec(read('apps/web/public/config.js'))?.[1];
const csp = /Content-Security-Policy:.*?connect-src ([^;]+)/.exec(read('apps/web/public/_headers'))?.[1] ?? '';
if (!apiOrigin?.startsWith('https://')) problems.push('apps/web/public/config.js の API Origin は https:// で始めてください');
else if (!csp.split(/\s+/).includes(apiOrigin)) problems.push(`apps/web/public/_headers の connect-src に ${apiOrigin} がありません`);

const workerConfig = read('workers/api/wrangler.toml');
const allowedOrigins = /ALLOWED_ORIGINS\s*=\s*"([^"]*)"/.exec(workerConfig)?.[1] ?? '';
if (!allowedOrigins.split(',').every(origin => origin.trim().startsWith('https://'))) problems.push('ALLOWED_ORIGINS はすべて https:// の Origin にしてください');
const publicSiteOrigin = /PUBLIC_SITE_ORIGIN\s*=\s*"([^"]*)"/.exec(workerConfig)?.[1] ?? '';
if (!publicSiteOrigin.startsWith('https://')) problems.push('PUBLIC_SITE_ORIGIN は https:// の Origin にしてください');
else if (!allowedOrigins.split(',').map(origin => origin.trim()).includes(publicSiteOrigin)) problems.push(`ALLOWED_ORIGINS に PUBLIC_SITE_ORIGIN（${publicSiteOrigin}）がありません`);
if (!/ENVIRONMENT\s*=\s*"production"/.test(workerConfig)) problems.push('workers/api/wrangler.toml の ENVIRONMENT は "production" にしてください');

for (const file of outdatedFiles()) problems.push(`${file} が古くなっています（npm run sync:shared）`);

if (problems.length) {
  console.error(`デプロイを中止しました（${problems.length}件）:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('preflight: OK');
