PRAGMA foreign_keys = ON;

CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 280),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  prompt TEXT NOT NULL CHECK(length(prompt) BETWEEN 1 AND 300),
  explanation TEXT NOT NULL DEFAULT '' CHECK(length(explanation) <= 500),
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL CHECK(correct_index BETWEEN 0 AND 3),
  UNIQUE(quiz_id, position)
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_quizzes_status_updated ON quizzes(status, updated_at DESC);
CREATE INDEX idx_questions_quiz_position ON questions(quiz_id, position);
CREATE INDEX idx_attempts_quiz_created ON attempts(quiz_id, created_at DESC);
