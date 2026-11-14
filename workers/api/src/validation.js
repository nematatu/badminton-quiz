import { LIMITS, OPTION_COUNT, QUIZ_STATUS, UNANSWERED, charLength } from '../../../packages/shared/src/contracts.js';
import { HttpError } from './http.js';

/**
 * 入力の検証と正規化。
 *
 * 長すぎる値は黙って切り詰めず、どの欄が誤りかを示すエラーで拒否する。
 * 画面側はエラーの detail を見て該当欄を強調表示する。
 */

const invalid = (code, detail) => new HttpError(400, code, detail ? { detail } : undefined);

function text(value, { max, required }) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (required && !trimmed) return null;
  return charLength(trimmed) <= max ? trimmed : null;
}

/** 重複判定用。全角半角・大文字小文字の違いは同じ選択肢とみなす。 */
function comparable(value) {
  return value.normalize('NFKC').toLocaleLowerCase('ja');
}

function timeLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const seconds = typeof value === 'string' ? Number(value) : value;
  const { min, max } = LIMITS.timeLimitSeconds;
  if (!Number.isInteger(seconds) || seconds < min || seconds > max) throw invalid('invalid_time_limit');
  return seconds;
}

function question(item, index) {
  const fail = field => invalid('invalid_question', { question: index + 1, field });

  const prompt = text(item?.prompt, { max: LIMITS.prompt, required: true });
  if (prompt === null) throw fail('prompt');

  if (!Array.isArray(item?.options) || item.options.length !== OPTION_COUNT) throw fail('options');
  const options = item.options.map(option => text(option, { max: LIMITS.option, required: true }));
  if (options.includes(null)) throw fail('options');
  if (new Set(options.map(comparable)).size !== OPTION_COUNT) throw fail('duplicate_options');

  const correctIndex = item?.correctIndex;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= OPTION_COUNT) throw fail('correctIndex');

  const explanation = text(item?.explanation, { max: LIMITS.explanation, required: false });
  if (explanation === null) throw fail('explanation');

  return { position: index, prompt, options, correctIndex, explanation };
}

/** 管理画面から送られたクイズ本体を検証する。 */
export function validateQuizInput(input) {
  if (input === null || typeof input !== 'object') throw invalid('invalid_json');

  const title = text(input.title, { max: LIMITS.title, required: true });
  if (title === null) throw invalid('invalid_title');

  const description = text(input.description, { max: LIMITS.description, required: false });
  if (description === null) throw invalid('invalid_description');

  const timeLimitSeconds = timeLimit(input.timeLimitSeconds);

  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > LIMITS.questions) throw invalid('invalid_question_count');

  // 選択肢の順番を挑戦ごとに入れ替えるか。真偽値の true のときだけ有効（既定は入れ替えない）
  const shuffleOptions = input.shuffleOptions === true;

  return { title, description, timeLimitSeconds, shuffleOptions, questions: questions.map(question) };
}

/** 楽観的ロック用の version。 */
export function validateVersion(input) {
  const version = input?.version;
  if (!Number.isInteger(version) || version < 1) throw invalid('invalid_version');
  return version;
}

/** 公開状態の切り替え先。下書きへは戻さない。 */
export function validateStatusChange(input) {
  const status = input?.status;
  if (status !== QUIZ_STATUS.PUBLISHED && status !== QUIZ_STATUS.ARCHIVED) throw invalid('invalid_status');
  return { status, version: validateVersion(input) };
}

/**
 * 回答者の回答配列。時間切れ送信（timedOut）の場合だけ未回答を許す。
 */
export function validateAnswers(input, questionCount) {
  const answers = input?.answers;
  const timedOut = input?.timedOut === true;
  const min = timedOut ? UNANSWERED : 0;
  const valid =
    Array.isArray(answers) &&
    answers.length === questionCount &&
    answers.every(answer => Number.isInteger(answer) && answer >= min && answer < OPTION_COUNT);
  if (!valid) throw invalid('invalid_answers');
  return { answers, timedOut };
}
