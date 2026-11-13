/**
 * ローカル開発環境をまとめて起動する。
 *
 *   公開画面  http://localhost:3000   （/api/* → API Worker の公開ルート）
 *   管理画面  http://localhost:3001   （Pages Function → Service Binding → AdminApi）
 *
 * 本番の管理画面は Cloudflare Access が JWT を付ける。ローカルではこのスクリプトが
 * 起動ごとに使い捨ての RSA 鍵を作り、JWKS を配信し、管理画面への全リクエストに
 * その鍵で署名した JWT を付ける。API 側の検証コードは本番と同じものが動く。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ports = { web: 3000, admin: 3001, api: 8787, adminPages: 8788, jwks: 8790, apiInspector: 9229, adminInspector: 9230 };
const ISSUER = `http://127.0.0.1:${ports.jwks}`;
const AUDIENCE = 'qraft-local-dev';
const DEV_ADMIN = 'developer@localhost';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const children = [];
const wranglerEnv = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };

/* ── 1. 準備: 共有ファイル同期・ローカル D1 の migration とサンプルデータ ── */

function run(args, label) {
  const result = spawnSync(wrangler, args, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env: wranglerEnv });
  if (result.status !== 0) {
    console.error(`${label}に失敗しました`);
    process.exit(1);
  }
}

spawnSync(process.execPath, ['scripts/sync-shared.js'], { cwd: root, stdio: 'inherit' });
run(['d1', 'migrations', 'apply', 'qraft-production', '--local', '--config', 'workers/api/wrangler.toml'], 'ローカル D1 の migration');
run(['d1', 'execute', 'qraft-production', '--local', '--config', 'workers/api/wrangler.toml', '--file', 'scripts/seed.sql'], 'サンプルデータの投入');

/* ── 2. 開発用の Access 署名鍵と JWKS ── */

const kid = `dev-${randomUUID()}`;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };

function devAccessToken() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode({ iss: ISSUER, aud: [AUDIENCE], sub: 'local-developer', email: DEV_ADMIN, iat: now, nbf: now, exp: now + 600 })}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
}

createServer((request, response) => {
  if (request.url !== '/cdn-cgi/access/certs') return response.writeHead(404).end();
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
}).listen(ports.jwks, '127.0.0.1');

/* ── 3. API Worker と管理画面（Pages）を起動 ── */

function start(args, cwd) {
  const child = spawn(wrangler, args, { cwd, stdio: 'inherit', env: wranglerEnv });
  child.on('exit', code => stop(code ?? 1));
  children.push(child);
}

start(
  [
    'dev', '--config', 'workers/api/wrangler.toml', '--port', String(ports.api), '--inspector-port', String(ports.apiInspector),
    '--show-interactive-dev-session=false',
    '--var', 'ENVIRONMENT:development',
    '--var', `ALLOWED_ORIGINS:http://localhost:${ports.web}`,
    '--var', `ACCESS_TEAM_DOMAIN:${ISSUER}`,
    '--var', `ACCESS_AUD:${AUDIENCE}`,
    '--var', `ATTEMPT_TOKEN_SECRET:${randomUUID()}${randomUUID()}`
  ],
  root
);
start(
  ['pages', 'dev', '--port', String(ports.adminPages), '--inspector-port', String(ports.adminInspector), '--show-interactive-dev-session=false'],
  resolve(root, 'apps/admin')
);

/* ── 4. 公開画面: 静的配信 + _headers の適用 + /api プロキシ ── */

const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const webRoot = resolve(root, 'apps/web/public');

/** `_headers` の `/*` ブロックを読み、本番と同じ CSP 等で配信する（違反を手元で検出できる）。 */
function globalHeaders(file) {
  const headers = {};
  let inGlobal = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ')) inGlobal = line.trim() === '/*';
    else if (inGlobal) {
      const [name, ...value] = line.trim().split(':');
      if (name !== 'Strict-Transport-Security') headers[name] = value.join(':').trim();
    }
  }
  return headers;
}
const webHeaders = globalHeaders(resolve(webRoot, '_headers'));

function proxy(request, response, { port, path, headers = {} }) {
  const upstream = httpRequest(
    { host: '127.0.0.1', port, path, method: request.method, headers: { ...request.headers, ...headers } },
    result => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    }
  );
  upstream.on('error', () => response.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":"network_error"}'));
  request.pipe(upstream);
}

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return proxy(request, response, { port: ports.api, path: `${url.pathname.slice(4)}${url.search}` });

  // 共有URL: 本番と同じ Pages Function を、ASSETS と API を手元の実体に差し替えて実行する。
  if (/^\/q\/[^/]+\/?$/.test(url.pathname)) return serveSharePage(request, response, url);

  if (url.pathname === '/config.js') {
    response.writeHead(200, { ...webHeaders, 'Content-Type': types['.js'] });
    return response.end("export const API_ORIGIN = '/api';\n");
  }

  let file = resolve(webRoot, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(webRoot + sep) && file !== webRoot) return response.writeHead(403).end();
  try {
    if (statSync(file).isDirectory()) file = resolve(file, 'index.html');
    statSync(file);
  } catch {
    return response.writeHead(404).end();
  }
  response.writeHead(200, { ...webHeaders, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(ports.web, '127.0.0.1');

async function serveSharePage(request, response, url) {
  const { onRequestGet } = await import('../apps/web/functions/q/[slug].js');
  const env = {
    ASSETS: { fetch: async () => new Response(readFileSync(resolve(webRoot, 'index.html'))) },
    API: { fetch: path => fetch(new URL(new URL(path).pathname, `http://127.0.0.1:${ports.api}`)) }
  };
  // 本番の Pages と同じく、パスパラメータは URL エンコードされたまま渡す。
  const slug = url.pathname.split('/')[2];
  const result = await onRequestGet({ request: new Request(`http://localhost:${ports.web}${url.pathname}`), env, params: { slug } });
  const { 'Strict-Transport-Security': _, ...headers } = Object.fromEntries(result.headers);
  response.writeHead(result.status, { ...headers, 'Content-Security-Policy': webHeaders['Content-Security-Policy'] });
  response.end(await result.text());
}

/* ── 5. 管理画面: Cloudflare Access の代わりに JWT を付けて Pages へ中継 ── */

createServer((request, response) =>
  proxy(request, response, { port: ports.adminPages, path: request.url, headers: { 'cf-access-jwt-assertion': devAccessToken() } })
).listen(ports.admin, '127.0.0.1', () => {
  console.log(`\n  公開画面  http://localhost:${ports.web}\n  管理画面  http://localhost:${ports.admin}  （${DEV_ADMIN} としてログイン済み扱い）\n`);
});

function stop(code = 0) {
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
