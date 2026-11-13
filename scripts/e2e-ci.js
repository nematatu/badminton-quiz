/**
 * 開発環境の起動 → E2E → 停止までを 1 コマンドで行う（CI 用。手元でも使える）。
 *
 *   npm run e2e:ci
 *
 * `npm run dev` と同じ構成（API Worker・管理画面・公開画面・開発用の Access JWT）を起動し、
 * 両方の画面が応答するのを待ってから scripts/e2e.js を実行する。
 * 失敗した時は、原因を追えるように開発サーバーのログを出力する。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const READY_TIMEOUT_MS = 120_000;
const TARGETS = ['http://127.0.0.1:3000/', 'http://127.0.0.1:3001/api/quizzes'];

let log = '';
// detached: 開発サーバーが起動する wrangler の子プロセスまでまとめて止められるようにする。
const dev = spawn(process.execPath, ['scripts/dev.js'], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [dev.stdout, dev.stderr]) stream.on('data', chunk => (log += chunk));

function stopDev() {
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {
    // すでに終了している
  }
}

async function isReady(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (dev.exitCode !== null) throw new Error(`開発サーバーが終了しました（終了コード ${dev.exitCode}）`);
    if ((await Promise.all(TARGETS.map(isReady))).every(Boolean)) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`開発サーバーが ${READY_TIMEOUT_MS / 1000} 秒以内に起動しませんでした`);
}

function runE2e() {
  return new Promise(resolve => {
    spawn(process.execPath, ['scripts/e2e.js'], { cwd: root, stdio: 'inherit' }).on('exit', code => resolve(code ?? 1));
  });
}

let exitCode = 1;
try {
  await waitUntilReady();
  exitCode = await runE2e();
} catch (error) {
  console.error(error.message);
} finally {
  stopDev();
}
if (exitCode !== 0) console.error(`\n── 開発サーバーのログ ──\n${log}`);
process.exit(exitCode);
