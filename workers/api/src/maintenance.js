import { deleteAttemptsBefore } from './repository.js';

/**
 * 定期実行（Cron Trigger）の保守処理。
 *
 * 回答記録（attempts）は個人を特定しない集計用データだが、無期限には持たない。
 * ATTEMPT_RETENTION_DAYS（既定 365 日）を過ぎたものを毎日削除する。
 */

export const DEFAULT_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionDays(env) {
  const raw = env.ATTEMPT_RETENTION_DAYS;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_RETENTION_DAYS;
  const days = Number(raw);
  // 設定ミスで全件消すことがないよう、範囲外は既定値に倒す。
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    console.error(JSON.stringify({ event: 'invalid_retention_days', value: String(raw) }));
    return DEFAULT_RETENTION_DAYS;
  }
  return days;
}

export async function purgeExpiredAttempts(env, now = new Date()) {
  const days = retentionDays(env);
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const deleted = await deleteAttemptsBefore(env.DB, cutoff);
  console.log(JSON.stringify({ event: 'attempts_purged', deleted, retentionDays: days, cutoff: cutoff.toISOString() }));
  return deleted;
}
