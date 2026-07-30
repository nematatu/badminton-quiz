const encoder = new TextEncoder();
let jwksCache = { expires: 0, keys: [] };

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export async function verifyAccessJwt(token, env) {
  if (!token || token.split('.').length !== 3) throw new Error('missing_access_token');
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  const header = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedHeader)));
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (header.alg !== 'RS256' || payload.iss !== issuer || !audiences.includes(env.ACCESS_AUD) || payload.exp <= now || (payload.nbf && payload.nbf > now + 30)) throw new Error('invalid_access_claims');
  if (jwksCache.expires < Date.now()) {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error('jwks_unavailable');
    const body = await response.json();
    jwksCache = { keys: body.keys || body.public_certs || [], expires: Date.now() + 3_600_000 };
  }
  const jwk = jwksCache.keys.find(key => key.kid === header.kid);
  if (!jwk) throw new Error('unknown_signing_key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(signature), encoder.encode(`${encodedHeader}.${encodedPayload}`));
  if (!valid) throw new Error('invalid_signature');
  return payload;
}

export async function enforceRateLimit(request, env, resource) {
  if (!env.ATTEMPT_RATE_LIMIT) return;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.ATTEMPT_RATE_LIMIT.limit({ key:`${resource}:${ip}` });
  if (!success) throw Object.assign(new Error('rate_limited'), { status: 429 });
}
