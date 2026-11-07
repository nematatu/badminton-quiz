/** リポジトリ内の全 JavaScript を構文チェックする（ビルド工程がないため、壊れたファイルの配信を防ぐ）。 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const IGNORED = new Set(['node_modules', '.wrangler', '.git']);

function* javascriptFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* javascriptFiles(path);
    else if (/\.(m?js)$/.test(entry.name)) yield path;
  }
}

const files = [...javascriptFiles('.')];
const failed = files.filter(file => spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }).status !== 0);
if (failed.length) process.exit(1);
console.log(`syntax: ${files.length} files OK`);
