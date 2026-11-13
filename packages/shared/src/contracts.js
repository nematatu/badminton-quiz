/**
 * API・管理画面・公開画面で共有する唯一の契約定義。
 *
 * このファイルは Worker からは直接 import され、ブラウザ向けには
 * `npm run sync:shared` で各アプリの `public/shared/` へコピーされる。
 * コピーとの差分は `npm test` が検出する。
 */

export const QUIZ_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived'
});

export const STATUS_LABELS = Object.freeze({
  draft: '下書き',
  published: '公開中',
  archived: '非公開'
});

/** 選択肢の数は4択で固定。 */
export const OPTION_COUNT = 4;

/** 時間切れで未回答だった設問を表す回答値。 */
export const UNANSWERED = -1;

/** 文字数はコードポイント単位（SQLite の length() と同じ数え方）。 */
export const LIMITS = Object.freeze({
  title: 80,
  description: 280,
  prompt: 300,
  option: 160,
  explanation: 500,
  questions: 50,
  timeLimitSeconds: Object.freeze({ min: 10, max: 3600 })
});

/** 公開URLに使う slug の形式。Unicode の文字・数字とハイフンのみ。 */
export const SLUG_PATTERN = /^[\p{L}\p{N}-]{1,64}$/u;

/**
 * API が返すエラーコードと、利用者向けの日本語メッセージ。
 * 画面はコードを直接表示せず、必ずこの表を通す。
 */
export const ERROR_MESSAGES = Object.freeze({
  not_found: '見つかりませんでした。公開が終了した可能性があります。',
  rate_limited: 'アクセスが集中しています。少し待ってからもう一度お試しください。',
  invalid_answers: '回答の形式が正しくありません。もう一度最初から挑戦してください。',
  invalid_session: '回答の受付情報が正しくありません。もう一度最初から挑戦してください。',
  quiz_updated: '回答中にこのクイズが更新されました。最新の問題でもう一度挑戦してください。',
  attempt_expired: '制限時間を過ぎたため採点できませんでした。もう一度挑戦してください。',
  attempt_already_submitted: 'この挑戦はすでに採点済みです。もう一度挑戦する場合は最初から始めてください。',
  invalid_json: 'リクエストの形式が正しくありません。',
  invalid_cursor: '一覧の続きを読み込めませんでした。ページを再読み込みしてください。',
  json_required: 'リクエストの形式が正しくありません。',
  payload_too_large: 'データが大きすぎます。',
  invalid_title: `タイトルは1〜${LIMITS.title}文字で入力してください。`,
  invalid_description: `説明は${LIMITS.description}文字以内で入力してください。`,
  invalid_time_limit: `制限時間は${LIMITS.timeLimitSeconds.min}〜${LIMITS.timeLimitSeconds.max}秒の整数で入力してください。`,
  invalid_question_count: `問題は1〜${LIMITS.questions}問にしてください。`,
  invalid_question: '入力内容に誤りがある問題があります。',
  invalid_status: '指定できない公開状態です。',
  invalid_version: '編集データが古い可能性があります。再読み込みしてください。',
  edit_conflict: '他の画面で先に更新されました。最新の内容を読み込み直してください。',
  quiz_published: '公開中のクイズは削除できません。先に非公開にしてください。',
  forbidden_origin: '不正な送信元からのリクエストです。',
  unauthorized: 'ログインの有効期限が切れました。ページを再読み込みしてください。',
  network_error: '通信できませんでした。接続を確認してもう一度お試しください。',
  internal_error: 'サーバーで問題が発生しました。時間をおいて再度お試しください。'
});

/** 問題単位の入力エラーで、どの欄が誤っているかを表す。 */
export const QUESTION_FIELD_MESSAGES = Object.freeze({
  prompt: `問題文を1〜${LIMITS.prompt}文字で入力してください。`,
  options: `選択肢を${OPTION_COUNT}つ、それぞれ1〜${LIMITS.option}文字で入力してください。`,
  duplicate_options: '同じ内容の選択肢があります。',
  correctIndex: '正解の選択肢を選んでください。',
  explanation: `解説は${LIMITS.explanation}文字以内で入力してください。`
});

export function errorMessage(code) {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal_error;
}

/** SQLite の length() と同じくコードポイント数で数える。 */
export function charLength(value) {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}
