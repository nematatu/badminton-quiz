-- 更新を 1 トランザクション（D1 batch）で原子的に行うための書き込みトークン。
-- UPDATE が version 照合に成功した時だけ revision_id が今回の乱数値になり、
-- 同じ batch 内の問題差し替え・監査ログはその値を条件に実行される。
-- version 照合に失敗した場合は batch 全体が何も変更しない。
ALTER TABLE quizzes ADD COLUMN revision_id TEXT;

-- 公開一覧は published_at の新しい順に並べるため、その並びの index を用意する。
CREATE INDEX idx_quizzes_status_published ON quizzes(status, published_at DESC);

-- 管理一覧は状態を問わず更新日時の新しい順に並べる。
CREATE INDEX idx_quizzes_updated ON quizzes(updated_at DESC);
