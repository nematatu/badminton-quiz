/**
 * packages/shared/src のブラウザ向けモジュールを各アプリの public/shared/ へコピーする。
 * ビルド工程を持たない静的サイトで、Worker と同じ契約定義を使うための仕組み。
 *
 *   node scripts/sync-shared.js          コピーする
 *   node scripts/sync-shared.js --check  差分があれば失敗する（CI・テスト用）
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
export const SHARED_FILES = ['contracts.js', 'dom.js'];
export const TARGET_APPS = ['apps/web/public/shared/', 'apps/admin/public/shared/'];

export function expectedContent(file) {
  const source = readFileSync(new URL(`packages/shared/src/${file}`, root), 'utf8');
  return `// 自動生成ファイル: packages/shared/src/${file} を編集し \`npm run sync:shared\` を実行すること。\n${source}`;
}

export function outdatedFiles() {
  const outdated = [];
  for (const app of TARGET_APPS) {
    for (const file of SHARED_FILES) {
      const target = new URL(`${app}${file}`, root);
      if (!existsSync(target) || readFileSync(target, 'utf8') !== expectedContent(file)) outdated.push(`${app}${file}`);
    }
  }
  return outdated;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const outdated = outdatedFiles();
    if (outdated.length) {
      console.error(`共有ファイルが古くなっています。npm run sync:shared を実行してください:\n  ${outdated.join('\n  ')}`);
      process.exit(1);
    }
  } else {
    for (const app of TARGET_APPS) {
      mkdirSync(new URL(app, root), { recursive: true });
      for (const file of SHARED_FILES) writeFileSync(new URL(`${app}${file}`, root), expectedContent(file));
    }
    console.log(`同期しました: ${TARGET_APPS.join(', ')}`);
  }
}
