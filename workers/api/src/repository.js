import { QUIZ_STATUS } from '../../../packages/shared/src/contracts.js';

/**
 * D1 へのアクセスをここに集約する。SQL はすべて bind parameter を使い、
 * 入力値を文字列連結しない。複数文の書き込みは必ず 1 回の batch（= 1 トランザクション）。
 */

const PUBLIC_LIST_LIMIT = 100;
const ADMIN_LIST_LIMIT = 200;

const now = () => new Date().toISOString();

/* ───────────── 読み取り ───────────── */

export async function listPublishedQuizzes(db) {
  const { results } = await db
    .prepare(
      `SELECT slug, title, description, time_limit_seconds, published_at,
              (SELECT COUNT(*) FROM questions WHERE quiz_id = quizzes.id) AS question_count
         FROM quizzes
        WHERE status = ?1
        ORDER BY published_at DESC
        LIMIT ?2`
    )
    .bind(QUIZ_STATUS.PUBLISHED, PUBLIC_LIST_LIMIT)
    .all();
  return results.map(row => ({
    slug: row.slug,
    title: row.title,
    description: row.description,
    questionCount: row.question_count,
    timeLimitSeconds: row.time_limit_seconds,
    publishedAt: row.published_at
  }));
}

export async function listAllQuizzes(db) {
  const { results } = await db
    .prepare(
      `SELECT id, slug, title, status, version, updated_at, published_at,
              (SELECT COUNT(*) FROM questions WHERE quiz_id = quizzes.id) AS question_count
         FROM quizzes
        ORDER BY updated_at DESC
        LIMIT ?1`
    )
    .bind(ADMIN_LIST_LIMIT)
    .all();
  return results.map(row => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    version: row.version,
    questionCount: row.question_count,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  }));
}

/**
 * 公開中のクイズを正解込みで 1 往復で読む。公開APIへ返す前に必ず
 * `toPublicQuiz` で正解と解説を取り除くこと。
 */
export async function findPublishedQuizBySlug(db, slug) {
  const [quizResult, questionResult] = await db.batch([
    db.prepare('SELECT * FROM quizzes WHERE slug = ?1 AND status = ?2').bind(slug, QUIZ_STATUS.PUBLISHED),
    db
      .prepare(
        `SELECT q.id, q.prompt, q.options_json, q.correct_index, q.explanation
           FROM questions q JOIN quizzes z ON z.id = q.quiz_id
          WHERE z.slug = ?1 AND z.status = ?2
          ORDER BY q.position`
      )
      .bind(slug, QUIZ_STATUS.PUBLISHED)
  ]);
  return assemble(quizResult.results[0], questionResult.results);
}

export async function findQuizById(db, id) {
  const [quizResult, questionResult] = await db.batch([
    db.prepare('SELECT * FROM quizzes WHERE id = ?1').bind(id),
    db.prepare('SELECT id, prompt, options_json, correct_index, explanation FROM questions WHERE quiz_id = ?1 ORDER BY position').bind(id)
  ]);
  return assemble(quizResult.results[0], questionResult.results);
}

function assemble(row, questionRows) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    timeLimitSeconds: row.time_limit_seconds,
    status: row.status,
    version: row.version,
    contentVersion: row.content_version,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    questions: questionRows.map(question => ({
      id: question.id,
      prompt: question.prompt,
      options: JSON.parse(question.options_json),
      correctIndex: question.correct_index,
      explanation: question.explanation
    }))
  };
}

/** 回答者へ渡してよい形。正解・解説・内部IDは含めない。 */
export function toPublicQuiz(quiz) {
  return {
    slug: quiz.slug,
    title: quiz.title,
    description: quiz.description,
    timeLimitSeconds: quiz.timeLimitSeconds,
    questions: quiz.questions.map(({ prompt, options }) => ({ prompt, options }))
  };
}

/* ───────────── 書き込み ───────────── */

function insertQuestion(db, quizId, question, guard) {
  const values = [crypto.randomUUID(), quizId, question.position, question.prompt, question.explanation, JSON.stringify(question.options), question.correctIndex];
  if (!guard) {
    return db
      .prepare('INSERT INTO questions (id, quiz_id, position, prompt, explanation, options_json, correct_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(...values);
  }
  return db
    .prepare(
      `INSERT INTO questions (id, quiz_id, position, prompt, explanation, options_json, correct_index)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
        WHERE EXISTS (SELECT 1 FROM quizzes WHERE id = ?2 AND revision_id = ?8)`
    )
    .bind(...values, guard);
}

function insertAudit(db, { actor, action, quizId, metadata = {}, guard }) {
  const values = [crypto.randomUUID(), actor, action, quizId, JSON.stringify(metadata), now()];
  if (!guard) {
    return db.prepare('INSERT INTO audit_events (id, actor, action, quiz_id, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(...values);
  }
  return db
    .prepare(
      `INSERT INTO audit_events (id, actor, action, quiz_id, metadata_json, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE EXISTS (SELECT 1 FROM quizzes WHERE id = ?4 AND revision_id = ?7)`
    )
    .bind(...values, guard);
}

export async function createQuiz(db, { input, slug, actor, duplicatedFrom }) {
  const id = crypto.randomUUID();
  const timestamp = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO quizzes (id, slug, title, description, time_limit_seconds, status, created_by, created_at, updated_at, version, revision_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 1, ?9)`
      )
      .bind(id, slug(id), input.title, input.description, input.timeLimitSeconds, QUIZ_STATUS.DRAFT, actor, timestamp, crypto.randomUUID()),
    ...input.questions.map(question => insertQuestion(db, id, question)),
    insertAudit(db, { actor, action: 'quiz.create', quizId: id, metadata: { title: input.title, ...(duplicatedFrom ? { duplicatedFrom } : {}) } })
  ]);
  return id;
}

/**
 * version が一致した場合だけ、本体の更新・問題の全差し替え・監査ログを
 * 1 トランザクションで行う。
 *
 * 最初の UPDATE が成功すると revision_id が今回だけの乱数になり、後続の文は
 * その値を条件に実行される。UPDATE が 0 件なら後続も 0 件になり、何も変わらない。
 *
 * @returns {Promise<'updated' | 'not_found' | { conflict: number }>}
 */
export async function updateQuiz(db, { id, version, input, actor }) {
  const guard = crypto.randomUUID();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quizzes
            SET title = ?1, description = ?2, time_limit_seconds = ?3, updated_at = ?4,
                version = version + 1, content_version = content_version + 1, revision_id = ?5
          WHERE id = ?6 AND version = ?7`
      )
      .bind(input.title, input.description, input.timeLimitSeconds, now(), guard, id, version),
    db.prepare('DELETE FROM questions WHERE quiz_id = ?1 AND EXISTS (SELECT 1 FROM quizzes WHERE id = ?1 AND revision_id = ?2)').bind(id, guard),
    ...input.questions.map(question => insertQuestion(db, id, question, guard)),
    insertAudit(db, { actor, action: 'quiz.update', quizId: id, metadata: { fromVersion: version }, guard })
  ]);
  if (updated.meta.changes > 0) return 'updated';
  return explainMiss(db, id);
}

/**
 * @returns {Promise<'updated' | 'unchanged' | 'not_found' | { conflict: number }>}
 */
export async function changeQuizStatus(db, { id, version, status, actor }) {
  const guard = crypto.randomUUID();
  const timestamp = now();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quizzes
            SET status = ?1, updated_at = ?2, version = version + 1, revision_id = ?3,
                published_at = CASE WHEN ?1 = ?4 THEN COALESCE(published_at, ?2) ELSE published_at END
          WHERE id = ?5 AND version = ?6 AND status != ?1`
      )
      .bind(status, timestamp, guard, QUIZ_STATUS.PUBLISHED, id, version),
    insertAudit(db, { actor, action: status === QUIZ_STATUS.PUBLISHED ? 'quiz.publish' : 'quiz.archive', quizId: id, guard })
  ]);
  if (updated.meta.changes > 0) return 'updated';

  const current = await db.prepare('SELECT status, version FROM quizzes WHERE id = ?1').bind(id).first();
  if (!current) return 'not_found';
  if (current.status === status) return 'unchanged';
  return { conflict: current.version };
}

/**
 * 公開中でないクイズだけを削除する。監査ログは削除後も残す。
 *
 * @returns {Promise<'deleted' | 'not_found' | 'published'>}
 */
export async function deleteQuiz(db, { id, actor }) {
  const [, deleted] = await db.batch([
    db
      .prepare(
        `INSERT INTO audit_events (id, actor, action, quiz_id, metadata_json, created_at)
         SELECT ?1, ?2, 'quiz.delete', id, json_object('title', title), ?3
           FROM quizzes WHERE id = ?4 AND status != ?5`
      )
      .bind(crypto.randomUUID(), actor, now(), id, QUIZ_STATUS.PUBLISHED),
    db.prepare('DELETE FROM quizzes WHERE id = ?1 AND status != ?2').bind(id, QUIZ_STATUS.PUBLISHED)
  ]);
  if (deleted.meta.changes > 0) return 'deleted';
  const exists = await db.prepare('SELECT 1 FROM quizzes WHERE id = ?1').bind(id).first();
  return exists ? 'published' : 'not_found';
}

export function recordAttempt(db, { quizId, contentVersion, score, total, answers }) {
  return db
    .prepare('INSERT INTO attempts (id, quiz_id, content_version, score, total, answers_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(crypto.randomUUID(), quizId, contentVersion, score, total, JSON.stringify(answers), now())
    .run();
}

/* ───────────── 統計・履歴・保守 ───────────── */

/**
 * 回答の集計。設問別の数値は「現在の問題内容（content_version）」への回答だけで出す。
 * 問題を編集すると設問の並びや選択肢が変わり、古い回答と混ぜると意味を失うため。
 * 集計は 1 回の batch（D1 への往復 1 回）で行い、answers_json は json_each で展開する。
 */
export async function getQuizStats(db, quiz) {
  const version = quiz.contentVersion;
  const [all, current, distribution, answers] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE quiz_id = ?1').bind(quiz.id),
    db
      .prepare(
        `SELECT COUNT(*) AS n,
                AVG(CAST(score AS REAL) / total) AS average_rate,
                SUM(score = total) AS perfect,
                MAX(created_at) AS last_attempt_at
           FROM attempts WHERE quiz_id = ?1 AND content_version = ?2`
      )
      .bind(quiz.id, version),
    db.prepare('SELECT score, COUNT(*) AS n FROM attempts WHERE quiz_id = ?1 AND content_version = ?2 GROUP BY score').bind(quiz.id, version),
    db
      .prepare(
        `SELECT CAST(answer.key AS INTEGER) AS position, answer.value AS selected, COUNT(*) AS n
           FROM attempts, json_each(attempts.answers_json) AS answer
          WHERE attempts.quiz_id = ?1 AND attempts.content_version = ?2
          GROUP BY answer.key, answer.value`
      )
      .bind(quiz.id, version)
  ]);

  const total = quiz.questions.length;
  const summary = current.results[0];
  const scoreDistribution = Array(total + 1).fill(0);
  for (const row of distribution.results) if (row.score >= 0 && row.score <= total) scoreDistribution[row.score] = row.n;

  const questions = quiz.questions.map(question => ({ prompt: question.prompt, options: question.options, correctIndex: question.correctIndex, optionCounts: [0, 0, 0, 0], unanswered: 0 }));
  for (const row of answers.results) {
    const question = questions[row.position];
    if (!question) continue;
    if (row.selected >= 0 && row.selected < question.optionCounts.length) question.optionCounts[row.selected] = row.n;
    else question.unanswered += row.n;
  }
  for (const question of questions) {
    const responses = question.optionCounts.reduce((sum, count) => sum + count, 0) + question.unanswered;
    question.correctRate = responses ? question.optionCounts[question.correctIndex] / responses : null;
  }

  return {
    contentVersion: version,
    totalAttempts: all.results[0].n,
    attempts: summary.n,
    averageRate: summary.n ? summary.average_rate : null,
    perfectCount: summary.perfect ?? 0,
    lastAttemptAt: summary.last_attempt_at,
    scoreDistribution,
    questions
  };
}

const HISTORY_LIMIT = 50;

/** クイズの変更履歴（監査ログ）。新しい順。 */
export async function listQuizHistory(db, quizId) {
  const { results } = await db
    .prepare('SELECT action, actor, metadata_json, created_at FROM audit_events WHERE quiz_id = ?1 ORDER BY created_at DESC LIMIT ?2')
    .bind(quizId, HISTORY_LIMIT)
    .all();
  return results.map(row => ({ action: row.action, actor: row.actor, metadata: JSON.parse(row.metadata_json), createdAt: row.created_at }));
}

/** 保持期間を過ぎた回答記録を削除し、削除件数を返す。 */
export async function deleteAttemptsBefore(db, cutoff) {
  const result = await db.prepare('DELETE FROM attempts WHERE created_at < ?1').bind(cutoff.toISOString()).run();
  return result.meta.changes;
}

async function explainMiss(db, id) {
  const current = await db.prepare('SELECT version FROM quizzes WHERE id = ?1').bind(id).first();
  return current ? { conflict: current.version } : 'not_found';
}
