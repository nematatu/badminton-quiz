# Qraft 詳細引き継ぎ資料

更新日時: 2026-07-30 JST  
作業ディレクトリ: `/Users/tatsuki/src/github.com/nematatu/badminton-quiz`

## 1. ユーザーの要求と経緯

最初の要求は、4択クイズを作成・回答でき、全問終了後にハッシュタグ付きでXへ投稿でき、リンクコピー、サービス名、ロゴ、見栄えも備えたクライアントアプリだった。

最初に単一静的SPAを実装したが、ユーザーから以下の重要な訂正を受けた。

- 管理画面と回答者画面は別アプリとして用意する。
- それぞれ別にデプロイする。
- Cloudflareへデプロイする。
- 問題管理を用意する。
- 単純な静的構成ではなく、設計・アーキテクチャをきちんと構成する。
- セキュリティとパフォーマンスを考慮する。

この指摘を受け、最初の単一SPAは削除し、管理Pages、公開Pages、API Worker、D1 migrationに分離して全面的に作り直した。

## 2. 現在のゴール状態

Codex内部goalは `blocked`。

理由は実装の停止ではなく、実Cloudflareデプロイに必要な外部情報・認証が存在しないため。

- `npx wrangler whoami` の結果は未認証。
- D1 database IDが未指定。
- 実ドメインが未指定。
- Cloudflare Access team domainが未指定。
- Cloudflare Access Application AUDが未指定。
- 使用するCloudflare account/zoneが未指定。

同じブロッカーが3回のgoal continuationにわたり継続したため、ルールに従ってblockedへ変更した。再開時は、上記情報が与えられたか、ユーザーが `wrangler login` を完了したかを最初に確認すること。

## 3. 現在のデプロイトポロジー

```text
Internet
  ├─ quiz.example.com
  │    Cloudflare Pages: apps/web
  │        └─ HTTPS -> api.quiz.example.com/v1/*
  │
  └─ admin.quiz.example.com
       Cloudflare Access
         └─ Cloudflare Pages: apps/admin
              └─ Pages Function /api/*
                   └─ Service Binding `API`
                        └─ qraft-api Worker /admin/*

qraft-api Worker
  ├─ D1 binding `DB`
  └─ Workers Rate Limiting binding `ATTEMPT_RATE_LIMIT`
```

管理画面と公開画面は別Cloudflare Pages project、APIは別Workerとしてデプロイする設計。管理Pages Functionから管理APIへの通信は通常の公開HTTPではなくService Bindingを使う。

## 4. ファイル構成と責務

```text
badminton-quiz/
├── package.json
├── package-lock.json
├── README.md
├── HANDOFF.md
├── docs/
│   └── ARCHITECTURE.md
├── apps/
│   ├── admin/
│   │   ├── wrangler.toml
│   │   ├── functions/api/[[path]].js
│   │   └── public/
│   │       ├── index.html
│   │       ├── app.js
│   │       ├── styles.css
│   │       └── _headers
│   └── web/
│       ├── wrangler.toml
│       └── public/
│           ├── index.html
│           ├── app.js
│           ├── config.js
│           ├── styles.css
│           └── _headers
├── workers/api/
│   ├── wrangler.toml
│   └── src/
│       ├── index.js
│       ├── security.js
│       └── validation.js
├── migrations/
│   ├── 0001_initial.sql
│   └── 0002_versioning_audit.sql
├── packages/shared/src/contracts.js
└── tests/validation.test.js
```

### `apps/admin`

問題管理画面。

- クイズ一覧
- 公開中・下書き件数表示
- 新規作成
- タイトル・説明編集
- 1〜50問の問題編集
- 各問題に4選択肢、正解index、任意解説
- 問題追加・削除
- クイズの公開・非公開
- 下書き／非公開クイズの物理削除
- versionを送信して編集競合を検出

`functions/api/[[path]].js` はブラウザからの `/api/...` をService Binding `API`へ `/admin/...` として転送する。Cookie、`x-forwarded-for` は転送前に削除する。Cloudflare Accessの `Cf-Access-Jwt-Assertion` は転送され、API Worker側で再検証される想定。

### `apps/web`

回答者向け画面。

- ブランド名: `Qraft`
- ロゴ: CSS/HTMLで作ったQマーク
- トップ画面
- 公開クイズ一覧
- クイズ読み込み
- 4択回答と進捗表示
- 全回答後にAPIへ回答配列を送信
- 採点結果、正解、解説表示
- 再挑戦
- 回答リンクコピー
- `#Qraft #4択クイズ` 付きX投稿

API URLは `apps/web/public/config.js` の `window.QRAFT_CONFIG.API_ORIGIN` から読む。現在はダミーの `https://api.quiz.example.com`。

### `workers/api`

公開APIと管理APIを同一Worker内でパス分離している。

公開API:

| Method | Path | 内容 |
|---|---|---|
| GET | `/health` | ヘルスチェック |
| GET | `/v1/quizzes` | 公開クイズ一覧、最大100件 |
| GET | `/v1/quizzes/:slug` | 公開問題。正解・解説は返さない |
| POST | `/v1/quizzes/:slug/attempts` | 回答検証、サーバー採点、attempt保存 |

管理API:

| Method | Path | 内容 |
|---|---|---|
| GET | `/admin/quizzes` | 管理用一覧、最大200件 |
| POST | `/admin/quizzes` | クイズ作成 |
| GET | `/admin/quizzes/:id` | 正解・解説を含む編集データ取得 |
| PUT | `/admin/quizzes/:id` | version照合付き更新 |
| DELETE | `/admin/quizzes/:id` | published以外のみ削除 |
| POST | `/admin/quizzes/:id/status` | `published` / `archived` 切替 |

## 5. データモデル

### `quizzes`

- `id`: UUID
- `slug`: タイトル由来文字列 + UUID先頭6文字、一意
- `title`: 1〜80文字
- `description`: 最大280文字
- `status`: `draft | published | archived`
- `created_by`: Access identityのemailまたはsub
- `created_at`, `updated_at`, `published_at`
- `version`: 楽観的ロック用。初期値1

### `questions`

- `id`: UUID
- `quiz_id`: quizzesへのFK、cascade delete
- `position`: 問題順
- `prompt`: 1〜300文字
- `explanation`: 最大500文字
- `options_json`: 4選択肢JSON
- `correct_index`: 0〜3
- `(quiz_id, position)` unique

### `attempts`

- `id`: UUID
- `quiz_id`: quizzesへのFK、cascade delete
- `score`, `total`
- `answers_json`
- `created_at`

IP、氏名、メール等の個人識別子はattemptへ保存しない。

### `audit_events`

- `actor`
- `action`: `quiz.create | quiz.update | quiz.publish | quiz.archive | quiz.delete`
- `quiz_id`
- `metadata_json`
- `created_at`

物理削除後も監査レコードを残せるよう、`quiz_id` にFKは付けていない。

## 6. 実装済みセキュリティ

### 認証・認可境界

- 管理画面custom domainをCloudflare Accessで保護する前提。
- API WorkerもAccess JWTを再検証。
- JWTはRS256のみ許可。
- `iss`、`aud`、`exp`、`nbf`を検証。
- `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` からJWKSを取得。
- JWKSはWorker isolate内で1時間キャッシュ。
- 管理APIはJWT検証後でないとルーティングしない。
- 管理PagesからWorkerへService Bindingを使用。

### データ漏えい防止

- 公開問題取得では `correct_index` と`explanation`をレスポンスから除外。
- 採点はWorkerがD1の正解と照合。
- 全問題送信後のみ、正解indexと解説を返す。

### 入力検証

- Content-Typeは`application/json`必須。
- Content-Lengthがある場合100KB超を413。
- title、description、prompt、option、explanationをtrimし長さ制限。
- 問題数1〜50。
- 選択肢は必ず4件。
- 空選択肢を拒否。
- 大文字小文字を無視して重複選択肢を拒否。
- 正解indexは0〜3の整数。
- 回答数が問題数と完全一致することを確認。
- 回答値は0〜3の整数のみ。
- SQLはすべてD1 prepared statementのbind parameterを使用。

### レート制限

- 最初はKV read-modify-write方式だったが競合に弱いため削除済み。
- 現在はCloudflare Workers Rate Limiting binding。
- binding: `ATTEMPT_RATE_LIMIT`
- 20 requests / 60 seconds。
- key: `${quizSlug}:${CF-Connecting-IP}`。
- Rate Limiting APIは拠点単位、eventually consistentで厳密課金用途には向かない。WAF/Bot Managementとの併用が必要。

### HTTPセキュリティ

- 公開Originを`ALLOWED_ORIGINS`完全一致でCORS許可。
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`
- Pages `_headers` でCSP。
- `frame-ancestors 'none'` およびAdminで`X-Frame-Options: DENY`。
- 管理API・採点結果は`Cache-Control: no-store`。
- Xリンクは`target=_blank` + `rel="noopener noreferrer"`。
- 動的HTMLは独自`esc()`でエスケープ。

### データ整合性・運用安全性

- 公開中クイズは直接物理削除不可。
- 更新時はversion一致を確認し、不一致はHTTP 409 `edit_conflict`。
- 作成、更新、公開、非公開、削除を監査ログへ記録。
- D1 foreign key、check constraint、unique constraint、indexを設定。

## 7. 実装済みパフォーマンス施策

- Admin/Webはビルド不要の小さい静的ファイルでCloudflare Pagesから配信。
- 大規模frameworkを入れず、初期JS/CSS依存を抑制。
- AdminからAPIはService Bindingで公開ネットワークを経由しない。
- 公開一覧レスポンス: `public, max-age=60, s-maxage=300`。
- 公開問題レスポンス: `public, max-age=60, s-maxage=600`。
- 管理・採点レスポンス: `no-store`。
- D1 index:
  - `quizzes(status, updated_at DESC)`
  - `questions(quiz_id, position)`
  - `attempts(quiz_id, created_at DESC)`
  - `audit_events(quiz_id, created_at DESC)`
  - `audit_events(created_at DESC)`
- Wrangler observability有効、head sampling 0.1。

重要: Cache-Controlヘッダーは実装済みだが、2026年版Workers Cacheの `[cache] enabled = true` は設定していない。よって生成Workerレスポンスが本番edge cacheで実際にHITすることは未確認。新Cache機能を有効化するなら、公開/非公開切替時の即時purgeと管理/POSTのbypassを設計してから行うこと。古い公開データがarchived後も残る構成にはしないこと。

## 8. migration履歴

### `0001_initial.sql`

- quizzes作成
- questions作成
- attempts作成
- index 3件作成

ローカル適用結果: 8 commands executed successfully。

### `0002_versioning_audit.sql`

- quizzesへversion追加
- audit_events作成
- index 2件作成

ローカル適用結果: 5 commands executed successfully。

remote D1には未適用。実ID設定後に以下を実行する。

```sh
npx wrangler d1 migrations apply qraft-production --remote --config workers/api/wrangler.toml
```

## 9. 実施済み検証と結果

### 依存関係

実行:

```sh
npm install
```

結果:

- `package-lock.json`生成済み。
- Wrangler 4.115.0がインストール済み。
- npm audit: 0 vulnerabilities。

### 構文検査

実行:

```sh
npm run check
```

対象:

- `workers/api/src/index.js`
- `apps/admin/public/app.js`
- `apps/web/public/app.js`

最新結果: 成功。

### unit tests

実行:

```sh
npm test
```

最新結果: 4 tests / 4 pass / 0 fail。

カバー内容:

- 正常クイズのnormalize。
- 選択肢は4件かつ重複不可。
- correctIndex範囲。
- 問題数制約。
- 回答数一致。
- 回答index範囲。

### Worker dry-run

実行:

```sh
npx wrangler deploy --dry-run --config workers/api/wrangler.toml --outdir /tmp/qraft-worker-ratelimit
```

結果: 成功。

認識されたbinding:

- D1 `DB (qraft-production)`
- `ATTEMPT_RATE_LIMIT (20 requests/60s)`
- environment variables

bundle: 約14.58 KiB、gzip約4.30 KiB。

### Admin Pages Function build

実行:

```sh
npx wrangler pages functions build apps/admin/functions \
  --project-directory apps/admin \
  --outdir /tmp/qraft-admin-functions \
  --compatibility-date 2026-07-30
```

結果: `Compiled Worker successfully`。

注意: config本体のcompatibility dateはworkerd互換性問題を避けるため`2026-07-29`。

### ローカルWorker HTTP確認

確認済み:

- `GET /health`: 200。
- `GET /v1/quizzes`: 200。
- 許可OriginでCORS headerあり。
- `GET /admin/quizzes` tokenなし: 401 `missing_access_token`。

### 公開問題・採点E2E

ローカルD1へ次のテストクイズを投入した。

- slug: `e2e-security`
- 問題: `2 + 2 は？`
- 選択肢: 3, 4, 5, 6
- 正解index: 1

`GET /v1/quizzes/e2e-security` の実レスポンスではprompt/optionsのみ返り、correctIndex/explanationなしを確認。

`POST /v1/quizzes/e2e-security/attempts` に `{"answers":[1]}` を送信し、201 Created、score 1/1、採点後のcorrectIndex/explanation返却を確認。

このE2EデータはローカルD1 `.wrangler` stateにのみ存在し、remoteには存在しない。

## 10. 未確認・未完成事項

以下は「実装済み」と誤認しないこと。

### P0: デプロイ前に必須

1. Cloudflare認証
   - `npx wrangler login`
   - `npx wrangler whoami` で対象accountを確認。

2. 実ドメイン決定
   - 公開Pages例: `quiz.example.com`
   - 管理Pages例: `admin.quiz.example.com`
   - API Worker例: `api.quiz.example.com`

3. placeholder置換
   - `workers/api/wrangler.toml`
     - API custom domain
     - `ALLOWED_ORIGINS`
     - `ACCESS_TEAM_DOMAIN`
     - `ACCESS_AUD`
     - `database_id`
     - Rate Limit `namespace_id`
   - `apps/web/public/config.js`
     - API origin
   - `apps/web/public/_headers`
     - CSP `connect-src` API origin
   - docs内のexample domain。

4. Cloudflare resources作成
   - production D1。
   - Admin/Web Pages project。
   - API Worker custom domain。
   - Access Application + policy。
   - Admin Pages service binding `API -> qraft-api`。

5. remote migration。

6. 3サービスをAPI -> Admin -> Web順にデプロイ。

7. 実Cloudflare環境でE2E。

### P0/P1: セキュリティ・整合性で次に直すべき点

1. 更新の完全transaction化
   - 現在PUTは、quizzesのversion/title更新を単独実行した後、questions delete/insertをD1 batchで行う。
   - question batchが失敗するとquiz version/titleだけ進む可能性がある。
   - D1で安全なtransaction/session設計へ変更し、クイズ更新と問題差し替えを原子的にする。

2. JWT key rotation
   - JWKSを1時間キャッシュしている。
   - 新しい`kid`が見つからない場合に強制再fetchせず、`unknown_signing_key`になる。
   - unknown kid時に一度だけJWKSを強制refreshして再検証する。

3. 実Access E2E
   - 署名検証コードの構文とロジックはあるが、実Cloudflare Access発行tokenでは未検証。
   - Access login、Pages Function転送、Worker検証、管理CRUDを実環境で確認する。

4. CSRF/Origin防御の明示化
   - AdminはAccess + same-origin Pages Function前提だが、mutationで`Origin`/`Sec-Fetch-Site`を明示検証していない。
   - Admin FunctionまたはWorkerでsame-origin checkを加える。

5. payload実サイズ制限
   - `Content-Length`がある場合のみ100KBを検査。
   - chunked/lengthなしでも読み込み後byte lengthを検証する実装へ変更する。

6. 採点endpointの推測耐性
   - 正解はGETで漏れないが、attempt APIを繰り返せば正解を推測できる。
   - Rate LimitとWAFに加え、必要ならTurnstile、attempt session、one-time token、問題単位ではなく全問一括のみという現仕様の維持を検討。

7. cache整合性
   - Cache-Control headerはあるがWorkers Cache有効化・HIT・purge未確認。
   - archived直後に公開問題がcacheから配信されないことを必ず設計・検証。

8. error分類
   - Access関連errorの401/500分類はmessage文字列判定。
   - typed error/codeへ変更する。

### P1: 機能・運用

- 管理一覧の検索、フィルタ、pagination。
- 問題並べ替えUI。
- 公開前preview。
- 公開予約。
- quiz複製。
- attempt数、正答率、設問別正答率の管理dashboard。
- audit log閲覧画面。
- attempts保持期間決定とCron Trigger削除。
- D1 backup/restore手順。
- staging/prod完全分離。
- structured logsとalert設定。
- WAF managed rules/Bot Management。
- MFA必須Access policy。
- custom 404/500。
- OGP画像、favicon、X card metadata。
- X投稿先が`twitter.com/intent/tweet`でよいか確認。必要なら`x.com/intent/post`を検証。

### P1/P2: 品質

- Worker API integration testの自動化。現在のE2Eは手動curl。
- JWT署名検証unit test。
- CORS、415、413、429、409、404のcontract test。
- 管理CRUDのブラウザE2E。
- 公開回答フローのブラウザE2E。
- accessibility audit。
- mobile/desktop screenshot visual regression。
- Lighthouse/performance計測。
- CSP実環境違反確認。
- CI workflow。現在GitHub Actionsなし。
- TypeScript化。現在はvanilla JS。
- `packages/shared/src/contracts.js` は現在実コードからimportされず、validation側と定数重複。共有contractを実利用するか削除する。

## 11. 既知のドキュメント不整合

次の担当は修正すること。

- `docs/ARCHITECTURE.md` のRemaining production decisionsに古い`D1/KV ID`表記が残っている。KVは既にRate Limiting bindingへ移行済みなので、`D1 ID / Rate Limiting namespace ID`へ直す。
- `apps/web/wrangler.toml` の`API_ORIGIN` varは静的`config.js`へ自動注入されない。現在の実動作は`public/config.js`の値。デプロイ時のconfig生成方法を決めるべき。

## 12. Git・ワークツリー状態

`/Users/tatsuki/src/github.com/nematatu/badminton-quiz` はGit repositoryではない。

実行結果:

```text
fatal: not a git repository (or any of the parent directories): .git
```

したがってcommit、branch、diff、PRは一切作成していない。親の`nematatu`にも`.git`はなく、隣の`blog`等は別repository。ユーザーがどのrepositoryへ入れるか決める必要がある。

## 13. 実デプロイ再開手順

### 13.1 最初に確認

```sh
cd /Users/tatsuki/src/github.com/nematatu/badminton-quiz
npx wrangler whoami
```

未認証ならユーザーに`npx wrangler login`を実施してもらう。AIが勝手に別accountへ作成しないこと。

次をユーザーから確認する。

- Cloudflare account名/ID。
- zone/domain。
- 公開、管理、APIの3 hostname。
- Accessで許可するemail/domain/IdP group。
- stagingも同時に作るか。
- attempts保持期間。

### 13.2 resource作成例

認証後、名前・accountを確認してから実行する。出力されたIDを記録する。

```sh
npx wrangler d1 create qraft-production
```

Rate Limiting namespace IDはCloudflare account内で一意な正整数を設定する。現在は仮に`1001`。

### 13.3 設定置換後のpreflight

```sh
rg -n 'replace-with|example\.com|your-team' . -g '!node_modules/**' -g '!HANDOFF.md' -g '!docs/**'
npm run check
npm test
npx wrangler deploy --dry-run --config workers/api/wrangler.toml --outdir /tmp/qraft-worker-final
npx wrangler pages functions build apps/admin/functions --project-directory apps/admin --outdir /tmp/qraft-admin-functions --compatibility-date 2026-07-29
```

placeholderが実行設定内に1件でも残っていたら本番deployしない。

### 13.4 migrationとdeploy

```sh
npx wrangler d1 migrations apply qraft-production --remote --config workers/api/wrangler.toml
npm run deploy:api
npm run deploy:admin
npm run deploy:web
```

Pages deploy commandがFunctionsとService Bindingを含めることを実deployment outputとDashboardで確認する。Workerを先にdeployしないとAdmin service binding先が存在しない。

### 13.5 本番E2E checklist

- 公開Webが200。
- Adminへ未ログインアクセスするとAccess loginへ遷移。
- 許可ユーザーがAdminへログインできる。
- 未許可ユーザーは拒否。
- Adminでクイズ作成。
- draftは公開一覧に出ない。
- publish後に公開一覧へ出る。
- 公開GETにcorrectIndex/explanationがない。
- 全問回答後のscoreが正しい。
- X投稿文にタイトル、得点、`#Qraft #4択クイズ`、回答URLがある。
- コピーリンクがHTTPS URL。
- Adminで編集し、公開Webへ反映。
- 2タブ同時編集で古い保存が409。
- archived後、公開GETが即404。cacheから古い200が出ない。
- published状態のDELETEが409。
- archived後のDELETEが204。
- tokenなし管理APIが401。
- 不正OriginにCORS許可がない。
- 21回目付近の連続attemptで429。Rate Limiting APIはeventually consistentのため厳密な21回目保証ではなく挙動幅を記録。
- Cloudflare logsに秘密・JWT・answers全体を不用意に出していない。
- audit_eventsにactor/actionが記録される。

## 14. 直近の推奨優先順位

1. ユーザーからCloudflare account/domain/Access policyを受け取り、Wrangler認証を確認。
2. PUT更新の完全transaction化。
3. JWT unknown kid refresh、Admin mutation Origin check、実payload byte limit。
4. placeholderを実値へ置換しremote migration。
5. API Worker deploy。
6. Admin Pages + Access + Service Binding deploy。
7. Web Pages deploy。
8. 本番E2E checklistを全件実行。
9. Workers cacheはarchive即時無効化を解決してから有効化。
10. CI/E2E/monitoring/backup/retentionを追加。

## 15. 次のエージェントへの注意

- 現状を「デプロイ済み」「本番完成」と表現しない。
- placeholderのままdeployしない。
- 管理画面と公開画面を再び単一SPAへ統合しない。
- 正解を公開GETへ追加しない。
- AccessでPagesを保護するだけで満足せず、Worker側JWT検証を維持する。
- KVカウンター方式へ戻さない。
- cacheを有効化する場合はarchive/delete時の即時無効化を先に解決する。
- `badminton-quiz` がGit repositoryではない点を忘れない。
- ユーザーは簡素な見せかけではなく、設計・安全性・性能・運用まで要求している。未確認事項は未確認と明示する。
