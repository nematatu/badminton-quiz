# Qraft architecture

## デプロイ構成

```text
Internet
  ├─ quiz.example.com        Cloudflare Pages: apps/web（静的配信 + 共有URL /q/<slug> の Function）
  │    ├─ HTTPS ───────────► qraft-api Worker  default export（公開API /v1/*）
  │    └─ /q/<slug> Function ─ Service Binding ─► 同上（OGP 用にクイズ名を取得）
  │
  └─ admin.quiz.example.com  Cloudflare Access ─► Pages: apps/admin
       └─ Pages Function /api/*
            └─ Service Binding（entrypoint = AdminApi）─► qraft-api Worker  AdminApi（管理API /admin/*）
                                                          ├─ D1（クイズ・問題・回答・監査ログ）
                                                          └─ Workers Rate Limiting
```

- 公開画面・管理画面・API は別プロジェクト・別ドメイン・別デプロイ。
- 管理API は Worker の **名前付きエントリポイント `AdminApi`** にだけ存在する。公開ドメインの
  default export は公開ルートしか持たないため、管理API はインターネットから到達できない。

## 信頼境界

| 境界 | 対策 |
|---|---|
| ブラウザ → 公開API | CORS は `ALLOWED_ORIGINS` 完全一致のみ。入力はすべて検証。正解・解説は採点結果としてのみ返す |
| ブラウザ → 管理画面 | Cloudflare Access（IdP + MFA を推奨）。CSP + Trusted Types、`frame-ancestors 'none'` |
| 管理画面 → Pages Function | 状態を変える要求は同一オリジン（`Sec-Fetch-Site` / `Origin`）のみ。転送ヘッダーは許可リスト |
| Pages Function → AdminApi | Service Binding。AdminApi は Access JWT（RS256、iss/aud/exp/nbf/iat/sub）を毎回再検証 |
| Worker → D1 | bind parameter のみ。複数文の書き込みは 1 batch = 1 トランザクション |

## データの一貫性

- 状態遷移は `draft → published ⇄ archived`。公開中は物理削除不可。
- 更新は **楽観的ロック**（`version`）。古い画面からの保存は HTTP 409 `edit_conflict`。
- 更新・状態変更・削除は、本体・問題・監査ログを **1 つの D1 batch** で実行する。
  version 照合に成功した UPDATE だけが `revision_id` に今回の乱数を書き、後続の文はその値を条件に
  実行されるため、照合に失敗した場合は何も変わらない。途中の文が失敗すれば batch 全体が巻き戻る。
- 監査ログ（`audit_events`）は物理削除後も残す（`quiz_id` に外部キーなし）。
- 回答履歴（`attempts`）は個人識別子を持たない（回答配列・得点・時刻のみ）。

## API

公開（`https://api…`）:

| Method | Path | 内容 | キャッシュ |
|---|---|---|---|
| GET | `/health` | ヘルスチェック | no-cache |
| GET | `/v1/quizzes?cursor=` | 公開クイズ一覧を新しい順に 30 件ずつ（`{ quizzes, total, nextCursor }`。キーセット方式） | 30 秒 + ETag |
| GET | `/v1/quizzes/:slug` | 問題（正解・解説なし） | 30 秒 + ETag |
| POST | `/v1/quizzes/:slug/sessions` | 挑戦の開始。受付トークンと、同じ版の問題（正解なし）を返す | no-store |
| POST | `/v1/quizzes/:slug/attempts` | `{ token, answers, timedOut }` を採点（トークン 1 つにつき 1 回） | no-store |

**受付トークン**（`workers/api/src/attempt-session.js`）: HMAC-SHA256 で署名した
`{ sid, slug, 問題内容の版, 発行時刻, 期限 }`。期限は「制限時間 + 15 秒」（時間制限なしは 24 時間）。
採点時に検証し、問題が更新されていれば 409 `quiz_updated`、期限切れは 409 `attempt_expired`、
`sid` は `attempts.session_id`（一意）に保存して再送信を 409 `attempt_already_submitted` で拒否する。
これにより、時間制限をサーバーでも守り、1 回の挑戦で何度も採点して正解を探ることを防ぐ
（挑戦の開始もレート制限の対象）。

公開画面の共有URL `https://quiz…/q/<slug>` は Pages Function が返す。中身は通常の画面と同じで、
`<title>` と OGP タグだけをクイズの内容に差し替える（X などのクローラーは JavaScript を実行しないため）。
共有カード画像は `apps/web/public/og.png`（1200×630、全クイズ共通）で、X では大きい画像のカードになる。
Pages の `_headers` は Function のレスポンスに適用されないので、同じセキュリティヘッダーを
`apps/web/functions/_lib/security-headers.js` で付け、テストで `_headers` との一致を確認している。

管理（Service Binding 経由のみ）:

| Method | Path | 内容 |
|---|---|---|
| GET | `/admin/quizzes` | 一覧（version・問題数を含む、最大 200 件） |
| POST | `/admin/quizzes` | 作成（下書き） |
| GET | `/admin/quizzes/:id` | 正解・解説を含む取得 |
| PUT | `/admin/quizzes/:id` | 更新（`version` 必須） |
| DELETE | `/admin/quizzes/:id` | 削除（公開中は 409 `quiz_published`） |
| POST | `/admin/quizzes/:id/status` | `{ status: published \| archived, version }` |
| POST | `/admin/quizzes/:id/duplicate` | 下書きとして複製（タイトルに「（コピー）」） |
| GET | `/admin/quizzes/:id/stats` | 回答統計（挑戦回数・平均正答率・得点分布・設問別の正答率と選択肢分布） |
| GET | `/admin/quizzes/:id/history` | 変更履歴（監査ログ、新しい順に最大 50 件） |

設問別の統計は、回答時の **問題内容の版（`content_version`）** が現在と同じ回答だけで出す。
`content_version` は問題の編集（PUT）でだけ増える（公開・非公開では増えない）。
編集前の回答は合計件数にだけ含める。

## 定期実行

Cron Trigger（毎日 03:17 UTC）で、`ATTEMPT_RETENTION_DAYS`（既定 365 日）を過ぎた回答記録を削除する。
設定値が不正な場合は、誤って全件を消さないよう既定値で動く。

エラーは `{ "error": "<code>", "detail"?: {...} }`。コードと日本語メッセージの対応は
`packages/shared/src/contracts.js` の `ERROR_MESSAGES`。

## パフォーマンス

- 画面はビルド不要の小さな ES Modules。`modulepreload` で読み込みの連鎖を避ける。
- 公開クイズの取得は D1 batch 1 往復。一覧・並び順に合わせた index。
- 公開 GET は ETag による 304。CDN（`s-maxage`）には載せない — 非公開化を即時に反映するため。
  CDN キャッシュを導入する場合は、公開状態の変更時に purge する仕組みを先に作ること。
- 回答の記録は `ctx.waitUntil` で応答後に行う。
- GET では `Content-Type` を送らず、CORS preflight を発生させない。preflight 自体も `Access-Control-Max-Age` でキャッシュ。

## 残っている本番判断

- 実ドメイン、Access の team domain / Application AUD、D1 ID を設定する（`npm run preflight` が検出）。
- Access policy で許可するメール / IdP グループを明示し、MFA を要求する。
- WAF managed rules・Bot 対策（回答 API の総当たり対策）、Worker のエラー・CPU アラート、D1 のバックアップ。
- staging / production で D1・Access Application・Pages project を分離する。
- attempts の保持期間（`ATTEMPT_RETENTION_DAYS`、既定 365 日）を運用ルールに合わせて決める。
