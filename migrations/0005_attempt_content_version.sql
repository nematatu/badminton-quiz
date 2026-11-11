-- 設問ごとの統計を正しく出すため、回答がどの「問題内容の版」に対するものかを記録する。
-- quizzes.version は公開・非公開の切り替えでも増えるので、問題内容の更新でだけ増える
-- content_version を別に持つ。既存の回答は版が不明（NULL）として扱い、件数の合計にだけ含める。
ALTER TABLE quizzes ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE attempts ADD COLUMN content_version INTEGER;

CREATE INDEX idx_attempts_quiz_content ON attempts(quiz_id, content_version);
