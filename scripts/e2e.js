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
import { mkdirSync, readFileSync } from 'node:fs';
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

/**
 * アクセシビリティの自動検査（axe-core、WCAG 2.2 AA + ベストプラクティス）。
 * 違反が 1 件でもあれば、どの画面のどの要素かを示して失敗する。
 * CSP でスクリプトの挿入は禁止しているため、DevTools 経由（page.evaluate）で読み込む。
 */
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
async function audit(page, name) {
  await page.evaluate(axeSource);
  const { violations } = await page.evaluate(() =>
    globalThis.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })
  );
  const report = violations.map(violation => `${violation.id}（${violation.help}）: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`);
  assert.deepEqual(report, [], `アクセシビリティ違反: ${name}`);
}

/** 主要な画面ごとの確認点: アクセシビリティ検査と（指定時は）スクリーンショット。 */
const shot = async (page, name) => {
  await audit(page, name);
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
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

  // 保存前でも、回答者の見え方をプレビューできる（並べ替え後の順番・正解・制限時間）
  await page.getByRole('button', { name: 'プレビュー' }).click();
  const preview = page.getByRole('dialog', { name: title });
  await preview.waitFor();
  assert.match(await preview.innerText(), /全2問・制限時間1分/);
  assert.deepEqual(await preview.locator('.preview-prompt').allInnerTexts(), ['空の色は？', '1 + 1 は？']);
  assert.match(await preview.locator('.preview-question').nth(1).locator('.is-correct').innerText(), /2\s*正解/);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '閉じる', '開いたら「閉じる」にフォーカス');
  await shot(page, 'admin-preview');
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'detached' });

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
  // モバイルでは端末の共有メニュー（Web Share API）がある想定にする（テスト用のブラウザには無い）
  if (name === 'mobile') {
    await page.evaluate(() => {
      window.sharedData = [];
      navigator.share = async data => {
        window.sharedData.push(data);
      };
    });
  }

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

  // フォーカスがクイズの外にある間は、1 文字のショートカットは効かない（WCAG 2.1.4）
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('2');
  assert.equal(await page.locator('input[name="answer"]:checked').count(), 0);
  await page.locator('#app').focus();

  // 1問目はキーボード（1キー=青）で、2問目はクリックで回答する
  await page.keyboard.press('1');
  await page.getByRole('button', { name: '次の問題へ' }).click();
  await page.getByRole('heading', { name: '1 + 1 は？' }).waitFor();
  await page.getByText('3', { exact: true }).click();
  await page.getByRole('button', { name: '採点する' }).click();

  await page.getByRole('heading', { name: /いい感じ/ }).waitFor();
  assert.match(await page.locator('.score').innerText(), /1\s*\/\s*2問正解/);
  assert.equal(await page.locator('#announcer').innerText(), '採点結果: 2問中1問正解', '得点をスクリーンリーダーへ読み上げる');
  assert.match(await page.locator('.review').innerText(), /正解\s*B\. 2/);
  const share = await page.getByRole('link', { name: 'Xでシェア' }).getAttribute('href');
  assert.match(decodeURIComponent(share), /#Qraft #4択クイズ/);
  const shareUrl = new URL(share).searchParams.get('url');
  assert.match(shareUrl, /\/q\/[^/#]+$/, '共有URLは OGP の入る /q/<slug> 形式');
  // 共有メニューに対応した端末でだけ「ほかのアプリで共有」を出し、結果の文面と共有URLを渡す
  const nativeShare = page.getByRole('button', { name: 'ほかのアプリで共有' });
  if (name === 'mobile') {
    await nativeShare.click();
    const [shared] = await page.evaluate(() => window.sharedData);
    assert.equal(shared.url, shareUrl);
    assert.match(shared.text, /2問中1問正解/);
    assert.equal(shared.title, `${title} | Qraft`);
  } else {
    assert.equal(await nativeShare.count(), 0);
  }
  await shot(page, `web-${name}-result`);

  // 間違えた問題だけを復習できる（ブラウザの中だけで進み、回答数には数えない）
  if (name === 'mobile') {
    await page.getByRole('button', { name: '間違えた 1 問を復習する' }).click();
    await page.getByRole('heading', { name: '1 + 1 は？' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '答えを確かめる' }).isDisabled(), true);
    await page.getByText('3', { exact: true }).click();
    await page.getByRole('button', { name: '答えを確かめる' }).click();
    await page.getByRole('status').filter({ hasText: '不正解' }).waitFor();
    assert.match(await page.getByRole('status').filter({ hasText: '不正解' }).innerText(), /正解は B\. 2/);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '復習を終える', '確かめた後は「次へ」にフォーカスが移る');
    assert.equal(await page.locator('input[name="answer"]:not(:disabled)').count(), 0, '確かめた後は答えを変えられない');
    await shot(page, 'web-mobile-practice-checked');
    await page.getByRole('button', { name: '復習を終える' }).click();
    await page.getByRole('heading', { name: '復習おつかれさまでした。あと 1 問です。' }).waitFor();
    await page.getByRole('button', { name: '間違えた 1 問をもう一度' }).click();
    await page.getByText('2', { exact: true }).click();
    await page.getByRole('button', { name: '答えを確かめる' }).click();
    await page.getByRole('status').filter({ hasText: '正解' }).waitFor();
    await page.getByRole('button', { name: '復習を終える' }).click();
    await page.getByRole('heading', { name: '復習した問題をすべて正解しました！' }).waitFor();
    await shot(page, 'web-mobile-practice-done');
    await page.getByRole('button', { name: '結果に戻る' }).click();
    assert.match(await page.locator('.score').innerText(), /1\s*\/\s*2問正解/);
  }

  // もう一度挑戦して全問正解すると自己ベスト更新を知らせ、導入画面に前回・自己ベストが出る（このブラウザの記録）
  if (name === 'desktop') {
    await page.getByRole('button', { name: 'もう一度挑戦' }).click();
    await page.getByRole('heading', { name: '空の色は？' }).waitFor();
    await page.locator('#app').focus();
    await page.keyboard.press('1');
    await page.getByRole('button', { name: '次の問題へ' }).click();
    await page.getByRole('heading', { name: '1 + 1 は？' }).waitFor();
    await page.getByText('2', { exact: true }).click();
    await page.getByRole('button', { name: '採点する' }).click();
    await page.getByText('自己ベスト更新！（前回までのベスト 1問）').waitFor();
    assert.match(await page.locator('#announcer').innerText(), /自己ベスト更新/);
    await shot(page, 'web-desktop-new-best');
    await page.goto(shareUrl);
    await page.getByRole('button', { name: 'はじめる' }).waitFor();
    assert.equal(await page.locator('.record').innerText(), '前回 2 / 2問正解・自己ベスト 2 / 2問（2回挑戦）');
  }


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

/* ── 管理画面: 分析（上の 4 回の回答が集計される: 1 問正解 × 3、全問正解 × 1）→ 複製 ── */
{
  const page = await open(ADMIN, { viewport: { width: 1280, height: 900 } });
  const row = page.getByRole('row', { name: new RegExp(title) });
  await row.getByRole('link', { name: '分析' }).click();
  await page.getByRole('heading', { name: '得点の分布' }).waitFor();
  const kpis = await page.locator('.stats').innerText();
  assert.match(kpis, /4\s*挑戦回数/);
  assert.match(kpis, /63%\s*平均正答率/); // (1 + 1 + 1 + 2) / 8 = 62.5%
  // 1問目（空の色は？）は全員正解、2問目（1 + 1 は？）は 3 人が C、1 人が正解の B
  const rates = await page.locator('.meter-value').allInnerTexts();
  assert.deepEqual(rates, ['100%', '25%']);
  assert.match(await page.locator('.meter-row').nth(1).innerText(), /B\. 2: 1人[\s\S]*C\. 3: 3人/);
  assert.match(await page.locator('.history').innerText(), /公開[\s\S]*作成/);
  await shot(page, 'admin-insights');

  await page.goto(ADMIN);
  await page.getByRole('row', { name: new RegExp(title) }).getByRole('button', { name: '複製' }).click();
  await page.getByRole('heading', { name: 'クイズを編集' }).waitFor();
  assert.equal(await page.getByLabel('タイトル').inputValue(), `${title}（コピー）`);
  await page.context().close();
}

/* ── 管理画面: CSV から問題を読み込み、書き出すと同じ内容になる ── */
{
  const page = await open(`${ADMIN}/#/new`, { viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await page.getByLabel('タイトル').waitFor();
  const csv = '\uFEFF問題文,選択肢1,選択肢2,選択肢3,選択肢4,正解,解説\r\nシャトルの羽根は何枚？,14枚,16枚,18枚,20枚,2,16枚です\r\n"カンマ, を含む問題",A,B,C,D,4,\r\n';
  await page.locator('input[type="file"]').setInputFiles({ name: 'questions.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('[data-question]').nth(1).waitFor();
  assert.equal(await page.locator('[data-question]').count(), 2);
  assert.equal(await page.locator('[data-question]').nth(0).getByLabel('問題文').inputValue(), 'シャトルの羽根は何枚？');
  assert.equal(await page.locator('[data-question]').nth(0).getByLabel('選択肢2を正解にする').isChecked(), true);
  assert.equal(await page.locator('[data-question]').nth(1).getByLabel('問題文').inputValue(), 'カンマ, を含む問題');
  await shot(page, 'admin-csv-imported');

  // ヘッドレス Chromium は日本語のファイル名を download に置き換えるため、E2E では英数字のタイトルで確かめる
  await page.getByLabel('タイトル').fill('CSV round/trip');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV に書き出す' }).click()]);
  assert.equal(download.suggestedFilename(), 'CSV round_trip.csv');
  const exported = readFileSync(await download.path(), 'utf8');
  assert.equal(exported.replace(/,\r\n$/, ',\r\n'), csv, '読み込んだ CSV と同じ内容で書き出される');

  // 誤りのある CSV は読み込まず、何行目が悪いかを表示する（今の問題は消さない）
  await page.locator('input[type="file"]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('正解が範囲外の問題,A,B,C,D,9,\n') });
  await page.getByText('1 行目: 正解は 1〜4 の数字で入力してください').waitFor();
  assert.equal(await page.locator('[data-question]').count(), 2);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: '問題一覧' }).click();
  await page.context().close();
}

/* ── 管理画面: スマートフォン幅（375px）で主要画面が横にはみ出さない ── */
{
  const page = await open(`${ADMIN}/#/new`, { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  await page.getByLabel('タイトル').waitFor();
  for (const [hash, ready] of [
    ['#/new', page.getByLabel('タイトル')],
    ['#/', page.locator('.quiz-table tbody tr').first()]
  ]) {
    await page.goto(`${ADMIN}/${hash}`);
    await ready.waitFor();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
    assert.ok(scrollWidth <= innerWidth, `${hash} が横にはみ出している（${scrollWidth}px > ${innerWidth}px）`);
  }
  await page.goto(`${ADMIN}/#/new`);
  const saveButton = page.getByRole('button', { name: '下書きとして保存' });
  await saveButton.waitFor();
  const save = await saveButton.boundingBox();
  assert.ok(save.x >= 0 && save.x + save.width <= 375, '保存ボタンが画面内にある');
  await page.context().close();
}

/* ── 管理画面: 絞り込みを変えた直後は、前の条件の「もっと見る」を出さない（API 応答は固定） ── */
{
  const quiz = (index, status) => ({
    id: `00000000-0000-4000-c000-${String(index).padStart(12, '0')}`,
    slug: `mock-${index}`,
    title: `モック ${index}`,
    status,
    version: 1,
    questionCount: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null
  });
  const counts = { all: 3, draft: 1, published: 2, archived: 0 };
  const page = await open('about:blank');
  const requested = [];
  await page.route('**/api/quizzes**', async route => {
    const params = new URL(route.request().url()).searchParams;
    requested.push(params.toString());
    if (params.get('status') === 'published') {
      await new Promise(resolve => setTimeout(resolve, 1200));
      return route.fulfill({ json: { quizzes: [quiz(1, 'published')], total: 2, counts, nextCursor: 'published-page-2' } });
    }
    return route.fulfill({ json: { quizzes: [quiz(1, 'published'), quiz(2, 'draft')], total: 3, counts, nextCursor: 'all-page-2' } });
  });
  await page.goto(ADMIN);
  await page.getByRole('button', { name: 'もっと見る' }).waitFor();
  await page.getByRole('combobox', { name: '状態で絞り込み' }).selectOption('published');
  assert.equal(await page.getByRole('button', { name: 'もっと見る' }).isVisible(), false, '新しい条件の 1 ページ目が届くまで隠す');
  await page.getByRole('button', { name: 'もっと見る' }).waitFor();
  assert.deepEqual(await page.locator('.quiz-table tbody tr .status').allInnerTexts(), ['公開中']);
  assert.ok(!requested.some(query => query.includes('status=published') && query.includes('all-page-2')), '前の条件の続き位置を新しい条件で使わない');
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
