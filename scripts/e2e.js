/**
 * ブラウザでの通しテスト（`npm run dev` を起動した状態で `npm run e2e`）。
 *
 * - 管理画面でクイズを作成 → 公開
 * - 公開画面でそのクイズに回答 → 採点結果を確認
 * - コンソールエラーと CSP 違反が 0 件であることを確認
 *
 * Playwright が必要（`npm i -D playwright && npx playwright install chromium`）。
 * SCREENSHOTS=<dir> を付けると各画面のスクリーンショットを保存する。
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';
const shots = process.env.SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      return createRequire(import.meta.url)('playwright');
    } catch {
      console.error('Playwright が見つかりません: npm i -D playwright && npx playwright install chromium');
      process.exit(1);
    }
  }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const problems = [];

async function open(url, options = {}) {
  const context = await browser.newContext({ locale: 'ja-JP', ...options });
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`${url} console: ${message.text()}`);
  });
  page.on('pageerror', error => problems.push(`${url} pageerror: ${error.message}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`));
  });
  await page.goto(url);
  return page;
}

const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const title = `E2Eクイズ ${Date.now()}`;

/* ── 管理画面: 作成 → 公開 ── */
{
  const page = await open(ADMIN);
  await page.getByRole('heading', { name: '問題一覧' }).waitFor();
  await page.locator('.quiz-table').waitFor();
  await shot(page, 'admin-list');

  await page.getByRole('link', { name: '新規作成' }).click();
  await page.getByLabel('タイトル').fill(title);
  await page.getByLabel('説明').fill('E2E テスト用');
  await page.getByLabel('制限時間（秒）').fill('60');

  const first = page.locator('[data-question]').nth(0);
  await first.getByLabel('問題文').fill('1 + 1 は？');
  for (const [index, value] of ['1', '2', '3', '4'].entries()) await first.getByLabel(`選択肢${index + 1}`, { exact: true }).fill(value);
  await first.getByLabel('選択肢2を正解にする').check();

  await page.getByRole('button', { name: '＋ 問題を追加' }).click();
  const second = page.locator('[data-question]').nth(1);
  await second.getByLabel('問題文').fill('空の色は？');
  for (const [index, value] of ['青', '赤', '緑', '黄'].entries()) await second.getByLabel(`選択肢${index + 1}`, { exact: true }).fill(value);

  // 重複した選択肢はブラウザ側で止まる
  await second.getByLabel('選択肢2', { exact: true }).fill('青');
  await page.getByRole('button', { name: '下書きとして保存' }).click();
  assert.equal(await second.getByLabel('選択肢2', { exact: true }).getAttribute('aria-invalid'), 'true');
  await second.getByLabel('選択肢2', { exact: true }).fill('赤');

  // 並べ替え: 2問目を上へ
  await second.getByRole('button', { name: '上へ移動' }).click();
  assert.equal(await page.locator('[data-question]').nth(0).getByLabel('問題文').inputValue(), '空の色は？');
  await shot(page, 'admin-editor');

  await page.getByRole('button', { name: '下書きとして保存' }).click();
  await page.getByRole('link', { name: title }).waitFor();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('row', { name: new RegExp(title) }).getByRole('button', { name: '公開する' }).click();
  await page.getByRole('row', { name: new RegExp(title) }).getByText('公開中').waitFor();
  await shot(page, 'admin-list-published');
  await page.context().close();
}

/* ── 公開画面: 一覧 → 導入 → 回答 → 結果 ── */
for (const [name, options] of [
  ['desktop', { viewport: { width: 1280, height: 860 } }],
  ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ['dark', { viewport: { width: 1280, height: 860 }, colorScheme: 'dark' }]
]) {
  const page = await open(WEB, options);
  await page.getByRole('heading', { name: '公開中のクイズ' }).waitFor();
  await shot(page, `web-${name}-home`);

  await page.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.getByRole('heading', { name: '空の色は？' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '次の問題へ' }).isDisabled(), true);
  await page.getByRole('timer').waitFor();
  await shot(page, `web-${name}-question`);

  // 1問目はキーボード（1キー=青）で、2問目はクリックで回答する
  await page.keyboard.press('1');
  await page.getByRole('button', { name: '次の問題へ' }).click();
  await page.getByRole('heading', { name: '1 + 1 は？' }).waitFor();
  await page.getByText('3', { exact: true }).click();
  await page.getByRole('button', { name: '採点する' }).click();

  await page.getByRole('heading', { name: /いい感じ/ }).waitFor();
  assert.match(await page.locator('.score').innerText(), /1\s*\/\s*2問正解/);
  assert.match(await page.locator('.review').innerText(), /正解\s*B\. 2/);
  const share = await page.getByRole('link', { name: 'Xでシェア' }).getAttribute('href');
  assert.match(decodeURIComponent(share), /#Qraft #4択クイズ/);
  await shot(page, `web-${name}-result`);
  await page.context().close();
}

await browser.close();
assert.deepEqual(problems, [], 'コンソールエラー・CSP 違反がないこと');
console.log('e2e: OK');
