/**
 * 結合テスト用に、API Worker を Miniflare（実際の workerd + D1）で起動する。
 * migration と seed を適用済みの DB を返す。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = new URL('../../', import.meta.url);
export const TEST_ATTEMPT_SECRET = 'test-attempt-secret-0123456789abcdef';

function statements(path) {
  return readFileSync(new URL(path, root), 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map(sql => sql.trim())
    .filter(sql => sql && !/^PRAGMA/i.test(sql));
}

/** エントリポイント（先頭）と、そこから import される全モジュール。 */
function workerModules() {
  return ['workers/api/src/index.js', ...readdirSync(new URL('workers/api/src/', root)).map(file => `workers/api/src/${file}`), 'packages/shared/src/contracts.js']
    .filter((path, index, all) => all.indexOf(path) === index)
    .map(path => ({ type: 'ESModule', path: new URL(path, root).pathname }));
}

/**
 * @param {{ bindings?: Record<string, string>, outboundService?: (request: Request) => Promise<Response>, ratelimits?: object }} [options]
 * @returns {Promise<{ mf: Miniflare, db: any }>}
 */
export async function startApiWorker({ bindings = {}, outboundService, ratelimits } = {}) {
  // Miniflare 5 の新しい設定形式へは公式の変換関数で移す（v4 形式の方が読みやすいため）。
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'qraft-api',
          modulesRoot: new URL('.', root).pathname,
          modules: workerModules(),
          compatibilityDate: '2026-07-29',
          d1Databases: ['DB'],
          bindings: { ENVIRONMENT: 'test', ATTEMPT_TOKEN_SECRET: TEST_ATTEMPT_SECRET, ...bindings },
          ...(outboundService ? { outboundService } : {}),
          ...(ratelimits ? { ratelimits } : {})
        },
        {
          // Admin Pages の Service Binding を模した、AdminApi エントリポイントへの入口。
          name: 'admin-gateway',
          modules: true,
          script: 'export default { fetch: (request, env) => env.API.fetch(request) }',
          compatibilityDate: '2026-07-29',
          serviceBindings: { API: { name: 'qraft-api', entrypoint: 'AdminApi' } }
        }
      ]
    })
  );
  const db = await mf.getD1Database('DB', 'qraft-api');
  const migrations = readdirSync(new URL('migrations/', root)).filter(file => file.endsWith('.sql')).sort();
  for (const file of [...migrations.map(name => `migrations/${name}`), 'scripts/seed.sql']) {
    for (const sql of statements(file)) await db.prepare(sql).run();
  }
  return { mf, db };
}
