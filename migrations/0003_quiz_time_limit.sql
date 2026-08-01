ALTER TABLE quizzes ADD COLUMN time_limit_seconds INTEGER
  CHECK(time_limit_seconds IS NULL OR time_limit_seconds BETWEEN 10 AND 3600);
