import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

export const ISSUER = 'https://qraft-test.cloudflareaccess.com';
export const AUDIENCE = 'qraft-test-aud';

/** テスト用の Cloudflare Access 署名鍵。sign() で JWT を、jwks() で公開鍵一覧を返す。 */
export function createSigner(kid = `test-${randomUUID()}`) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    kid,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' },
    sign(claims = {}, header = {}) {
      const now = Math.floor(Date.now() / 1000);
      const payload = { iss: ISSUER, aud: [AUDIENCE], sub: 'admin-1', email: 'admin@example.test', iat: now, exp: now + 300, ...claims };
      const input = `${encode({ alg: 'RS256', kid, typ: 'JWT', ...header })}.${encode(payload)}`;
      return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
    }
  };
}
