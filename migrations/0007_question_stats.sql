-- 設問ごとの「みんなの正答率」を、採点のたびに全回答を集計せずに返すための集計表。
-- 回答の記録（attempts）と同じ batch で 1 行ずつ加算する。問題内容の版（content_version）ごとに分け、
-- 古い版の行は定期実行で削除する。個人の回答は含まない（件数と正解数だけ）。
CREATE TABLE question_stats (
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  content_version INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  responses INTEGER NOT NULL DEFAULT 0 CHECK(responses >= 0),
  correct INTEGER NOT NULL DEFAULT 0 CHECK(correct >= 0 AND correct <= responses),
  PRIMARY KEY (quiz_id, content_version, position)
) WITHOUT ROWID;

-- 既存の回答のうち、現在の問題内容への回答から集計を作る（それより古い版の回答は設問と対応しない）。
INSERT INTO question_stats (quiz_id, content_version, position, responses, correct)
SELECT attempts.quiz_id, attempts.content_version, questions.position, COUNT(*), SUM(answer.value = questions.correct_index)
  FROM attempts
  JOIN quizzes ON quizzes.id = attempts.quiz_id AND quizzes.content_version = attempts.content_version
  JOIN json_each(attempts.answers_json) AS answer
  JOIN questions ON questions.quiz_id = attempts.quiz_id AND questions.position = CAST(answer.key AS INTEGER)
 GROUP BY attempts.quiz_id, attempts.content_version, questions.position;
