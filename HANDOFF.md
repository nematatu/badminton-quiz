# Qraft 引き継ぎ資料

更新: 2026-11-07（根本見直し後）

## 現在の状態

- 実装・ローカル検証は完了。**本番 Cloudflare へは未デプロイ**（アカウント・ドメイン・Access の情報が未提供のため）。
- 見直しの内容と、見つけて直した不具合の一覧は [docs/REFACTORING.md](docs/REFACTORING.md)。
- 設計（信頼境界・一貫性・キャッシュ方針）は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

検証済み:

| 項目 | 方法 | 結果 |
|---|---|---|
| 入力検証・JWT・HTTP 入出力・ルーター・Pages Function・画面の状態遷移 | `npm test`（単体） | 成功 |
| 公開API・管理API・D1（原子性、409 競合、公開→非公開→削除、監査ログ、CORS、405） | `npm test`（Miniflare 上の workerd + D1） | 成功 |
| Worker / Pages Function のビルド | `npm run build:api` / `build:admin` | 成功 |
| 管理画面で作成→公開、公開画面で回答→採点（デスクトップ / モバイル / ダーク） | `npm run e2e`（Playwright、ローカル） | 成功、コンソールエラー・CSP 違反 0 |
| 時間切れの自動採点、2 タブ同時編集の競合、未保存変更の確認 | Playwright（手動スクリプト） | 成功 |

未検証（本番環境が必要）:

- 実 Cloudflare Access が発行する JWT での管理API認証
- 本番 Pages の `[[services]] entrypoint = "AdminApi"` がデプロイ後も有効であること（ローカルの `pages dev` では確認済み）
- Workers Rate Limiting の実際の挙動（ローカルでは binding が無視される）

## 本番構築の手順

1. `npx wrangler login` → `npx wrangler whoami` で対象アカウントを確認する（別アカウントに作らないこと）。
2. ユーザーに確認する: アカウント、ドメイン（公開 / 管理 / API の 3 つ）、Access で許可するメールまたは IdP グループ、staging の要否、attempts の保持期間。
3. `npx wrangler d1 create qraft-production` で D1 を作り、出力された ID を控える。
4. 実値を設定し、`npm run preflight` が `OK` になるまで直す。
   - `workers/api/wrangler.toml`: `routes`、`ALLOWED_ORIGINS`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`database_id`、Rate Limiting の `namespace_id`（アカウント内で一意な正整数）
   - `apps/web/public/config.js` の `PRODUCTION_API_ORIGIN` と `apps/web/public/_headers` の `connect-src`
5. `npm run db:migrate:remote`
6. `npm run deploy:api` → `npm run deploy:admin` → `npm run deploy:web`（この順。Admin の Service Binding 先が先に必要）
7. Admin Pages の custom domain を Access Application で保護し、その AUD が `ACCESS_AUD` と一致していることを確認する。
8. 本番 E2E（下記チェックリスト）。

## 本番 E2E チェックリスト

- [ ] 管理画面へ未ログインでアクセスすると Access のログインへ遷移し、許可外のユーザーは拒否される
- [ ] `https://api…/admin/quizzes` は 404（管理APIが公開ドメインに無い）
- [ ] 管理画面でクイズ作成 → 下書きは公開一覧に出ない → 公開すると出る
- [ ] 公開問題の GET に `correctIndex` / `explanation` が無い
- [ ] 全問回答後の得点・解説が正しい。X 投稿文にタイトル・得点・`#Qraft #4択クイズ`・URL がある
- [ ] 2 タブで同時編集すると後から保存した側が 409 になり、内容は上書きされない
- [ ] 非公開にすると公開 GET が（ブラウザキャッシュの 30 秒以内を除き）404 になる
- [ ] 公開中の削除は 409、非公開後の削除は 204
- [ ] 連続した回答送信で 429（Rate Limiting は拠点単位・結果整合なので、回数の幅を記録する）
- [ ] 公開画面・管理画面でブラウザの CSP 違反が出ない
- [ ] `audit_events` に actor / action が記録される
- [ ] Worker のログに JWT・回答内容などを不用意に出していない

## 次の担当への注意

- 管理画面と公開画面を 1 つのアプリに統合しない。管理API を公開ドメインの default export に戻さない。
- 公開 GET に正解を含めない。採点は必ず Worker で行う。
- Access で Pages を守るだけで済ませず、Worker 側の JWT 検証を維持する。
- CDN キャッシュ（`s-maxage` や Workers Cache）を入れるなら、公開状態の変更時の即時 purge を先に作る。
- 画面で `innerHTML` 等の文字列 HTML を使わない（CSP の Trusted Types で動かなくなる）。DOM は `shared/dom.js` の `h()` で作る。
- `packages/shared/src` を変えたら `npm run sync:shared`。
- 各 Pages アプリ直下の `package.json` は消さない（無いと新しい wrangler が `[[services]]` を読み落とす。docs/REFACTORING.md の B15）。
- 未確認のことを「デプロイ済み」「本番で動作確認済み」と書かない。
