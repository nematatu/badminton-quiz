import assert from 'node:assert/strict';
import test from 'node:test';
import { SUBMIT_GRACE_MS, UNTIMED_SESSION_MS, issueSession, verifySession } from '../workers/api/src/attempt-session.js';

const env = { ATTEMPT_TOKEN_SECRET: 'unit-test-secret-0123456789abcdef' };
const quiz = { slug: 'sample', contentVersion: 3, timeLimitSeconds: 60 };
const T0 = Date.UTC(2026, 0, 1);

test('制限時間 + 猶予までは受け付け、それを過ぎたら attempt_expired', async () => {
  const { token, expiresAt } = await issueSession(env, quiz, T0);
  assert.equal(expiresAt, new Date(T0 + 60_000 + SUBMIT_GRACE_MS).toISOString());
  const verified = await verifySession(env, token, quiz, T0 + 60_000 + SUBMIT_GRACE_MS);
  assert.equal(typeof verified.sessionId, 'string');
  assert.equal(verified.shuffle, false);
  await assert.rejects(verifySession(env, token, quiz, T0 + 60_000 + SUBMIT_GRACE_MS + 1), { status: 409, code: 'attempt_expired' });
});

test('時間制限なしのクイズは 24 時間有効', async () => {
  const untimed = { ...quiz, timeLimitSeconds: null };
  const { token } = await issueSession(env, untimed, T0);
  await verifySession(env, token, untimed, T0 + UNTIMED_SESSION_MS);
  await assert.rejects(verifySession(env, token, untimed, T0 + UNTIMED_SESSION_MS + 1), { code: 'attempt_expired' });
});

test('別の鍵・別のクイズ・壊れたトークンは invalid_session、版違いは quiz_updated', async () => {
  const { token } = await issueSession(env, quiz, T0);
  await assert.rejects(verifySession({ ATTEMPT_TOKEN_SECRET: 'another-secret-0123456789abcdefghij' }, token, quiz, T0), { status: 400, code: 'invalid_session' });
  await assert.rejects(verifySession(env, token, { ...quiz, slug: 'other' }, T0), { code: 'invalid_session' });
  for (const broken of [undefined, '', 'abc', 'a.b.c', `${token}x`, `!${token}`]) {
    await assert.rejects(verifySession(env, broken, quiz, T0), { code: 'invalid_session' }, String(broken));
  }
  await assert.rejects(verifySession(env, token, { ...quiz, contentVersion: 4 }, T0), { status: 409, code: 'quiz_updated' });
});

test('署名鍵が未設定・短すぎる場合は発行も検証もしない（500）', async () => {
  await assert.rejects(issueSession({}, quiz), { status: 500 });
  await assert.rejects(issueSession({ ATTEMPT_TOKEN_SECRET: 'short' }, quiz), { status: 500 });
});

test('選択肢を入れ替えて出題したかはトークンが覚えており、回答中に設定が変わっても見せた順番で採点できる', async () => {
  const issued = await issueSession(env, { ...quiz, shuffleOptions: true }, T0);
  assert.equal(issued.shuffle, true);
  // 発行後に設定を切っても、検証結果はトークンに書いた値（入れ替えた）になる
  assert.deepEqual(await verifySession(env, issued.token, { ...quiz, shuffleOptions: false }, T0), { sessionId: issued.sessionId, shuffle: true });
});
