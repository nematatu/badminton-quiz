# 根本見直し（2026-11）: 改善点と対応

コード全体を「可読性」「パフォーマンス」「セキュリティ」「UI/UX」「設計原則」の観点で見直した結果と、
その対応をまとめる。**不具合**は実際に誤動作する（またはしうる）もの。

## 実際の不具合（修正済み）

| # | 内容 | 影響 | 対応 |
|---|---|---|---|
| B1 | 管理画面で問題を削除した後に追加すると、正解ラジオボタンの `name` が既存の問題と重複 | 別の問題の正解が勝手に外れる | グループ名を連番でなく一意IDで生成（`editor.js`） |
| B2 | 公開画面の進捗バーが `style="width:…"` 属性で描画されていた | CSP `style-src 'self'` によりブロックされ、進捗バーが表示されない | CSS 変数を CSSOM で設定（CSP 準拠） |
| B3 | `npm run deploy:admin` / `deploy:web` が `wrangler pages deploy --config …` | Pages は `--config` 非対応でデプロイが失敗する | `--cwd apps/<app>` に変更 |
| B4 | クイズ更新（PUT）が「本体更新」と「問題差し替え」の2回に分かれていた | 後半が失敗すると、タイトルと version だけ進み問題は古いまま | 1 回の D1 batch（トランザクション）に統合。`revision_id` で version 照合の成否を後続文へ伝える（`0004` migration）。結合テストで原子性を検証 |
| B5 | JWT の `exp` が無いトークンを受け入れていた（`undefined <= now` が false） | 有効期限なしのトークンが通る | `exp` 必須化、`sub` 必須化、`iat` 検証を追加 |
| B6 | 壊れた JWT（base64/JSON 不正）で 500 を返していた | 認証エラーがサーバーエラー扱いになり監視ノイズ化 | すべて 401 `unauthorized` に統一 |
| B7 | Access の鍵ローテーション直後、未知の `kid` を最大 1 時間拒否 | 管理画面が突然使えなくなる | 未知の `kid` で JWKS を強制再取得（30 秒間隔で抑制、同時取得は 1 回に集約） |
| B8 | 本文サイズ上限が `Content-Length` ヘッダーがある時だけ有効 | chunked 送信で巨大な本文を読ませられる | ストリームを読みながら実バイト数で判定 |
| B9 | 削除・状態変更でも「確認の SELECT → 更新」が別トランザクション | 確認後に公開された問題を削除しうる | 条件付き DELETE / UPDATE と監査ログを同じ batch に |
| B10 | 公開画面の GET にも `Content-Type: application/json` を付けていた | すべての GET で CORS preflight が発生（往復が倍） | GET ではヘッダーを付けない＋ `Access-Control-Max-Age` |
| B11 | 共有 URL を開いた瞬間にタイマーが開始 | 問題を見る前に持ち時間が減る | 導入画面を追加し「はじめる」で開始 |
| B12 | 回答を選ぶたびに画面全体を再描画 | キーボード・スクリーンリーダー利用時にフォーカスを失う | ネイティブのラジオボタンにし、選択時は再描画しない |
| B13 | トースト通知のタイマーが重なる | 2 回目の通知がすぐ消える | 前のタイマーを解除してから表示 |
| B14 | 管理画面と公開画面の `_headers` で `Cache-Control` が二重指定になりうる | Pages はヘッダーを連結するため矛盾した値になる | ルールを 1 つに整理 |
| B15 | 新しい wrangler で、リポジトリ直下に `package.json` があると Pages の `[[services]]` が読まれない | ローカルでも本番デプロイでも管理画面の API が `env.API` 未定義で 500 | 各 Pages アプリに `package.json` を置く |
| B16 | 削除成功判定が `changes === 1` | 外部キーのカスケード削除分も数えられ、成功しても 404 を返す | `changes > 0` で判定（結合テストで検出） |

## セキュリティ

- **管理API をインターネットから到達不能に**: 同じ Worker の公開ドメインに `/admin/*` も載っていたのを、名前付きエントリポイント `AdminApi` に分離。Admin Pages の Service Binding（`entrypoint = "AdminApi"`）からしか呼べない。JWT 検証は多層防御として維持。
- **CSRF 対策の明示化**: Pages Function で、状態を変えるリクエストは `Sec-Fetch-Site: same-origin`（無い場合は `Origin` 一致）のみ許可。
- **転送ヘッダーを許可リスト化**: Cookie・`X-Forwarded-For`・`Authorization` 等を API へ渡さない。`Authorization: Bearer` での JWT 受け付けも廃止。
- **XSS を構造的に排除**: 文字列 HTML 組み立て（`innerHTML` + 手書きエスケープ）をやめ、DOM API（`h()` ヘルパー）で構築。これにより CSP に **Trusted Types**（`require-trusted-types-for 'script'`）を追加できた。
- **ヘッダー強化**: HSTS、COOP、`object-src 'none'`、API の JSON に `CSP: default-src 'none'` と CORP。管理画面に `X-Robots-Tag: noindex`。
- **CORS**: 管理系に CORS を一切付けない。`Vary: Origin` を常に付与。
- **入力検証**: 長すぎる値を黙って切り詰めず拒否。文字数は DB の `length()` と同じコードポイント単位。重複選択肢は NFKC 正規化して判定。`correctIndex` は文字列を受け付けない。
- **デプロイ事故防止**: `npm run deploy:*` の前に `preflight` が自動実行され、プレースホルダー・CSP と API Origin の不一致・`ENVIRONMENT` の誤り・共有ファイルの同期漏れを検出したら中止。
- **依存関係**: wrangler を最新化し、`npm audit` の high 脆弱性（undici / sharp 経由）を 0 件に。

## パフォーマンス

- 公開クイズ取得を「quiz → questions」の 2 往復から D1 batch の 1 往復に。
- 公開一覧の並び順（`published_at`）・管理一覧（`updated_at`）に合う index を追加。
- 公開レスポンスに内容ハッシュの **ETag** を付け、`If-None-Match` で 304。
- `s-maxage` を廃止（CDN に載せないことで、非公開化したクイズが配信され続ける事故を防ぐ）。ブラウザでは `max-age=30, stale-while-revalidate=60`。
- 回答の記録（attempt INSERT）は `ctx.waitUntil` で応答後に実行。
- フロントは `<link rel="modulepreload">` で ES Modules の読み込みの連鎖（ウォーターフォール）を解消。
- 静的ファイルはハッシュ付きファイル名ではないため、長期キャッシュではなく ETag 再検証（`no-cache`）に統一して、HTML と JS の版ずれを防ぐ。

## 可読性・設計原則

- **責務の分離**: Worker を `index`（エントリポイント）/ `router` / `http`（入出力・エラー）/ `auth` / `rate-limit` / `validation` / `repository`（SQL を集約）/ `public-api` / `admin-api` に分割。1 行 1000 文字超のコードを解消。
- **単一の情報源**: 文字数上限・状態・エラーメッセージを `packages/shared/src/contracts.js` に集約し、Worker・管理画面・公開画面が同じ定義を使う（ブラウザへは `npm run sync:shared` でコピー、テストで同期漏れを検出）。
- **型付きエラー**: `HttpError(status, code, { detail })` に統一。メッセージ文字列で 401/500 を判定する処理を廃止。
- **フロントの構造**: minify 状態の 1 ファイルを、`api` / `session`（状態遷移）/ `views`（描画）/ `app`（コントローラー）に分割。
- **ハッシュルーティング**: 管理画面も `#/edit/<id>` 形式にし、再読み込み・戻る操作で同じ画面に戻れる。旧共有 URL（`#quiz/<slug>`, `#quizzes`）は互換維持。
- **未使用設定の削除**: `apps/web/wrangler.toml` の効かない `API_ORIGIN` 変数、使われていなかった `workspaces` 設定。

## UI/UX・アクセシビリティ

- 公開画面: トップに一覧を直接表示（1 クリック削減）、問題数と制限時間を一覧・導入画面に表示、前の問題へ戻れる、1〜4 / A〜D キーで選択、結果画面で各問の「あなたの回答」と「正解」を選択肢の文言付きで表示、時間切れ未回答の明示、残り 60 秒・10 秒の読み上げ、ページタイトルの更新、見出しへのフォーカス移動、スキップリンク、回答途中で閉じる時の確認。
- 管理画面: 検索・状態フィルタ、問題数の列、問題の並べ替え・複製、文字数カウンター、欄単位のエラー表示（サーバーの 400 も該当欄へ）、公開中クイズ編集時の警告、編集競合時に最新を読み込むか確認、未保存変更の離脱確認、Ctrl/⌘+S 保存、公開・非公開の確認ダイアログ。
- 両画面: ダークモード、`prefers-reduced-motion`、44px 以上のタップ領域（公開画面）、エラーコードを利用者向けの日本語に変換、日本語見出しの自然な改行（`word-break: auto-phrase`）。

## 検証

- `npm test`: 単体 + 結合テスト 40 件（Miniflare 上の実 workerd + D1。原子性、競合、ライフサイクル、CORS、JWT、CSRF を含む）
- `npm run check`: 全 JS の構文チェックと共有ファイルの同期確認
- `npm run build:api` / `build:admin`: Worker と Pages Function のビルド確認
- `npm run e2e`（`npm run dev` 起動中）: 実ブラウザで管理画面での作成・公開 → 公開画面での回答・採点（デスクトップ / モバイル / ダーク）。コンソールエラー・CSP 違反 0 件を確認
- GitHub Actions（`.github/workflows/ci.yml`）で check / test / build を実行

## 今回やっていないこと（次の候補）

- 本番 Cloudflare へのデプロイと実 Access での E2E（アカウント・ドメイン情報が必要。`HANDOFF.md` 参照）
- クイズ単位の OGP 画像（hash ルーティングのため、静的配信のままでは不可。Pages Function で `/q/<slug>` を SSR する案）
- 回答の推測耐性の強化（Turnstile、attempt セッション）
- 管理画面のダッシュボード（正答率・設問別正答率）、監査ログ閲覧、attempts の保持期間と Cron 削除
- TypeScript 化（現状は JSDoc コメント + テスト。ビルド工程を持たない方針との兼ね合いで保留）
