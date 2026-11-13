-- 回答の受付トークン（POST /v1/quizzes/:slug/sessions で発行）ごとに 1 回だけ採点する。
-- 同じトークンでの再送信は一意制約で拒否し、正解の総当たりに挑戦の開始（レート制限対象）を必要にする。
-- 既存の回答は session_id が NULL（部分インデックスなので制約の対象外）。
ALTER TABLE attempts ADD COLUMN session_id TEXT;

CREATE UNIQUE INDEX idx_attempts_session ON attempts(session_id) WHERE session_id IS NOT NULL;
