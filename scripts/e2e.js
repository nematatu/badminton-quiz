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

  // 入力途中で再読み込みしても、自動保存した下書きを復元できる
  await page.getByRole('link', { name: '新規作成' }).click();
  await page.getByLabel('タイトル').fill('下書きの復元テスト');
  // 自動保存の待ち時間（0.4 秒）を待たずに再読み込みしても、閉じる直前に書き込まれる
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByText('保存していない編集内容があります').waitFor();
  await page.getByRole('button', { name: '復元する' }).click();
  assert.equal(await page.getByLabel('タイトル').inputValue(), '下書きの復元テスト');

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
  // 保存したら下書きは消える
  await page.getByRole('link', { name: '新規作成' }).click();
  await page.getByLabel('タイトル').waitFor();
  assert.equal(await page.getByText('保存していない編集内容があります').count(), 0);
  await page.getByRole('link', { name: '問題一覧' }).click();
  await page.getByRole('link', { name: title }).waitFor();

  // 検索と状態の絞り込みはサーバー側で行われ、該当するものだけが残る
  await page.getByRole('searchbox', { name: 'クイズを検索' }).fill(title);
  await page.waitForFunction(() => document.querySelectorAll('.quiz-table tbody tr').length === 1);
  assert.match(await page.locator('.list-summary').innerText(), /^1件$/);
  await page.getByRole('combobox', { name: '状態で絞り込み' }).selectOption('published');
  await page.getByText('条件に合うクイズはありません。').waitFor();
  await page.getByRole('combobox', { name: '状態で絞り込み' }).selectOption('');
  await page.getByRole('searchbox', { name: 'クイズを検索' }).fill('');
  await page.waitForFunction(() => document.querySelectorAll('.quiz-table tbody tr').length > 1);

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

  // 「本文へ移動」を使っても回答中の画面（URL と状態）はそのまま
  const hashBefore = await page.evaluate(() => location.hash);
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => location.hash), hashBefore);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'app');
  await page.getByRole('heading', { name: '空の色は？' }).waitFor();

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
  const shareUrl = new URL(share).searchParams.get('url');
  assert.match(shareUrl, /\/q\/[^/#]+$/, '共有URLは OGP の入る /q/<slug> 形式');
  await shot(page, `web-${name}-result`);

  // 共有URLを開くと同じクイズの導入画面になり、HTML にはクイズ名の OGP が入っている
  const sharedHtml = await (await page.request.get(shareUrl)).text();
  assert.match(sharedHtml, new RegExp(`<meta property="og:title" content="${title} \\| Qraft">`));
  await page.goto(shareUrl);
  await page.getByRole('button', { name: 'はじめる' }).waitFor();
  assert.equal(await page.title(), `${title} | Qraft`);
  // そこから一覧へ戻ると URL は / に整えられる
  await page.getByRole('link', { name: '← クイズ一覧' }).click();
  await page.getByRole('heading', { name: '公開中のクイズ' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  await page.context().close();
}

/* ── 管理画面: 分析（上の 3 回の回答が集計される）→ 複製 ── */
{
  const page = await open(ADMIN, { viewport: { width: 1280, height: 900 } });
  const row = page.getByRole('row', { name: new RegExp(title) });
  await row.getByRole('link', { name: '分析' }).click();
  await page.getByRole('heading', { name: '得点の分布' }).waitFor();
  const kpis = await page.locator('.stats').innerText();
  assert.match(kpis, /3\s*挑戦回数/);
  assert.match(kpis, /50%\s*平均正答率/);
  // 1問目（空の色は？）は全員正解、2問目（1 + 1 は？）は全員 C を選んで不正解
  const rates = await page.locator('.meter-value').allInnerTexts();
  assert.deepEqual(rates, ['100%', '0%']);
  assert.match(await page.locator('.meter-row').nth(1).innerText(), /C\. 3: 3人/);
  assert.match(await page.locator('.history').innerText(), /公開[\s\S]*作成/);
  await shot(page, 'admin-insights');

  await page.goto(ADMIN);
  await page.getByRole('row', { name: new RegExp(title) }).getByRole('button', { name: '複製' }).click();
  await page.getByRole('heading', { name: 'クイズを編集' }).waitFor();
  assert.equal(await page.getByLabel('タイトル').inputValue(), `${title}（コピー）`);
  await page.context().close();
}

/* ── 公開画面: 応答待ちの間に移動したら、遅れて届いた応答で画面を上書きしない ── */
{
  const page = await open(`${WEB}/#quiz/badminton-basics-sample`);
  await page.route('**/v1/quizzes/*/sessions', async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.getByText('準備しています').waitFor();
  await page.getByRole('link', { name: 'Qraft ホーム' }).click();
  await page.getByRole('heading', { name: '公開中のクイズ' }).waitFor();
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('.question-card').count(), 0, '一覧のまま');
  await page.context().close();
}

await browser.close();
assert.deepEqual(problems, [], 'コンソールエラー・CSP 違反がないこと');
console.log('e2e: OK');
