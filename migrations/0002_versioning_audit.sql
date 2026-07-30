ALTER TABLE quizzes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('quiz.create','quiz.update','quiz.publish','quiz.archive','quiz.delete')),
  quiz_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_events_quiz_created ON audit_events(quiz_id, created_at DESC);
CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
