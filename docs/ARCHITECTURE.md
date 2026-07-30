# Qraft architecture

## Deployment topology

```text
Internet
  ├─ quiz.example.com       Cloudflare Pages: apps/web/public
  │    └─ public HTTPS ───► qraft-api Worker /v1/*
  └─ admin.quiz.example.com Cloudflare Access + Pages: apps/admin
       └─ Pages Function ─► Service Binding ─► qraft-api Worker /admin/*
                                                ├─ D1 (content/attempts)
                                                └─ Workers Rate Limiting binding
```

管理画面と回答画面は、プロジェクト・ドメイン・デプロイを分離する。管理画面をCloudflare Access Applicationで保護し、Pages Functionが受け取ったAccess JWTをService Binding先へ転送する。WorkerもAccess公開鍵でJWTを再検証するため、管理APIはFunctionを信頼しただけの構成にはしない。

## Trust boundaries

- ブラウザ入力、URL、JSON、ヘッダーはすべて信頼しない。
- 公開GETでは `correct_index` と解説を返さない。採点はWorker内で行う。
- 管理APIはAccess JWTの署名、`iss`、`aud`、`exp`、`nbf`を検証する。
- D1はbind parameterのみを使い、SQL文字列へ入力を連結しない。
- 管理PagesからAPIへはインターネット向けURLでなくService Bindingを使う。
- 公開POSTはquizと接続元を組み合わせたkeyでWorkers Rate Limiting bindingを適用する。KV read-modify-writeの競合を避け、同一拠点内の高速なカウンターを利用する。共有IPへの影響と拠点単位・eventual consistencyという特性があるため、Bot Management/WAF Rate Limitingも外側で併用する。

## Data lifecycle

`draft → published → archived`。公開中の問題だけが公開APIに現れる。物理削除は公開中には許可せず、事故を防ぐ。更新時はversionを照合し、古い編集画面による上書きをHTTP 409で拒否する。作成・更新・公開・非公開・削除はactorと時刻を監査ログへ保存する。回答履歴は個人識別子を保存せず、採点・集計に必要な回答配列と時刻だけを保存する。保持期間を決め、Cron Triggerで古いattemptsを削除する運用を推奨する。

## Performance

- Web/Adminは静的Pagesでエッジ配信。
- 公開一覧は `s-maxage=300`、問題は `s-maxage=600`。公開状態変更時の即時反映が必要ならCache API key purgeを追加する。
- 管理レスポンス、採点結果は `no-store`。
- D1には公開一覧、問題順、回答集計向けindexを作成。
- 依存のない小さなES Modulesで初期JavaScriptを抑制。

## Remaining production decisions

- 実ドメイン、Access team domain/application AUD、D1/KV IDを環境別設定へ入れる。
- Access policyは許可するメール/IdP groupを明示し、MFAを要求する。
- WAF managed rules、bot対策、Worker CPU/exception alert、D1 backupをCloudflare Dashboardで設定する。
- staging/prodでD1、KV、Access Application、Pages projectを分離する。
