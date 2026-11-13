# Qraft

Cloudflare 上で、管理系と公開系を分離して動かす 4 択クイズサービス。

- **公開画面**（`apps/web`）: クイズ一覧 → 導入 → 回答 → サーバー採点 → 解説・X でシェア（共有URLにはクイズ名のプレビュー付き）
- **管理画面**（`apps/admin`）: クイズの作成・編集・複製・並べ替え・公開管理、回答の分析と変更履歴。Cloudflare Access で保護
- **API**（`workers/api`）: 公開API（インターネット向け）と管理API（Service Binding 専用）、D1

設計の詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、今回の見直し内容は [docs/REFACTORING.md](docs/REFACTORING.md)、
本番構築の手順と残作業は [HANDOFF.md](HANDOFF.md) を参照。

## ディレクトリ

```text
apps/
  web/     公開画面（Cloudflare Pages。共有URL /q/<slug> だけ Pages Function）
  admin/   管理画面（Cloudflare Pages + Pages Function で API へ中継）
workers/api/src/
  index.js        エントリポイント（default = 公開API / AdminApi = 管理API / scheduled = 保守）
  public-api.js   公開ルート      admin-api.js  管理ルート
  repository.js   D1 の SQL       validation.js 入力検証
  auth.js         Access JWT 検証 http.js / router.js / rate-limit.js
  maintenance.js  定期実行（古い回答記録の削除）
packages/shared/src/  Worker と画面で共有する契約（上限値・エラーメッセージ）と DOM ヘルパー
migrations/           D1 スキーマ
scripts/              開発・検証・デプロイ前チェック
tests/                単体テスト・結合テスト（Miniflare + D1）
```

## ローカル開発

Node.js 20 以上。

```sh
npm install
npm run dev
```

| URL | 内容 |
|---|---|
| http://localhost:3000 | 公開画面（サンプルの「バドミントン基礎クイズ」入り） |
| http://localhost:3001 | 管理画面（開発用の Access JWT を自動付与。本番と同じ検証コードが動く） |

`npm run dev` はローカル D1 への migration とサンプルデータ投入を自動で行う。

## 検証

```sh
npm run check   # 全 JS の構文チェック・共有ファイルの同期確認
npm test        # 単体 + 結合テスト（実 workerd + D1）
npm run verify  # 上記 + Worker / Pages Function のビルド確認
npm run e2e     # npm run dev 起動中に、実ブラウザで作成→公開→回答の通しテスト + 各画面のアクセシビリティ検査
npm run e2e:ci  # 開発環境の起動 → E2E → 停止までを 1 コマンドで（CI でも実行）
```

E2E は初回だけ `npx playwright install chromium` でブラウザを入れる。

`packages/shared/src` を編集したら `npm run sync:shared` で各アプリへ反映する（忘れると `npm test` が失敗する）。

## デプロイ

1. 実値を設定する（`npm run preflight` が未設定箇所を一覧表示する）
   - `workers/api/wrangler.toml`: API のドメイン、`ALLOWED_ORIGINS`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、D1 の `database_id`
   - `apps/web/public/config.js` と `apps/web/public/_headers`（CSP `connect-src`）: API の Origin
   - 回答の受付トークンの署名鍵（secret）: `npx wrangler secret put ATTEMPT_TOKEN_SECRET --config workers/api/wrangler.toml`（32 文字以上のランダム値。例: `openssl rand -base64 48`）
2. remote D1 へ migration を適用し、API → 管理画面 → 公開画面の順にデプロイする

```sh
npm run db:migrate:remote
npm run deploy:api     # 各 deploy の前に preflight が自動実行され、問題があれば中止する
npm run deploy:admin
npm run deploy:web
```

3. 管理画面のドメインを Cloudflare Access Application で保護し、その AUD を `ACCESS_AUD` に設定する
