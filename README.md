# Qraft

Cloudflare上で管理系と公開系を分離した4択クイズサービスです。

## 構成

- `apps/admin`: 問題の作成・編集・公開管理。別Cloudflare Pagesへデプロイし、Cloudflare Accessで保護
- `apps/web`: 回答者向け画面。別Cloudflare Pagesへデプロイ
- `workers/api`: 公開/管理API、サーバー採点、D1・Workers Rate Limitingアクセス
- `migrations`: D1 schema
- `packages/shared`: 共有contract/constants
- `docs/ARCHITECTURE.md`: 境界、セキュリティ、性能、運用設計

## ローカル検証

```sh
npm install
npm run check
npm test
```

APIを起動する前に `.dev.vars` とローカルD1を用意します。

```sh
npx wrangler d1 migrations apply qraft-production --local --config workers/api/wrangler.toml
npm run dev
```

`npm run dev` はローカルAPI Workerと公開画面を起動します。公開画面は
`http://localhost:3000`、APIは `http://localhost:8787` です。

## Cloudflare初期構築

1. D1 databaseを作成し、`workers/api/wrangler.toml` のIDを更新。Rate Limiting namespace IDはアカウント内で一意な正整数を割り当てる。
2. `ALLOWED_ORIGINS`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` を実値へ更新。
3. `apps/web/public/config.js` とWeb CSPのAPI originを実値へ更新。
4. migrationをremote D1へ適用後、API、Admin、Webの順にデプロイ。
5. Admin Pagesのcustom domainをCloudflare Access Applicationで保護。Access application AUDをWorker設定と一致させる。
6. Admin Pages projectにWorker service binding `API = qraft-api` が設定されていることを確認。

```sh
npx wrangler d1 migrations apply qraft-production --remote --config workers/api/wrangler.toml
npm run deploy:api
npm run deploy:admin
npm run deploy:web
```

ダミーIDのままでは本番デプロイできません。詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。
