import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const b64 = value => Buffer.from(value).toString('base64url');
const random = (bytes = 32) => b64(randomBytes(bytes));
const sha256 = value => b64(createHash('sha256').update(value).digest());
const constantEqual = (a, b) => {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};
const required = (value, name) => {
  if (typeof value !== 'string' || !value) throw new Error(name + '_REQUIRED');
  return value;
};

/** Storage must be durable and shared by all runtime instances in production. */
export function createOAuthSessionManager({
  issuer, clientId, clientSecret, redirectUri, resource, scope = 'metropolis-go',
  store, fetchImpl = fetch, now = Date.now,
}) {
  for (const [name, value] of Object.entries({ issuer, clientId, clientSecret, redirectUri, resource })) required(value, name);
  if (!store || !['put','take','get','delete'].every(key => typeof store[key] === 'function')) throw new Error('SESSION_STORE_REQUIRED');
  const base = new URL(issuer);
  if (base.protocol !== 'https:' || new URL(redirectUri).protocol !== 'https:') throw new Error('HTTPS_REQUIRED');
  const authorizationEndpoint = new URL('/authorize', base).toString();
  const tokenEndpoint = new URL('/token', base).toString();

  async function begin() {
    const state = random(), verifier = random(48);
    await store.put('oauth:' + sha256(state), { verifier, createdAt: now() }, 600);
    const url = new URL(authorizationEndpoint);
    for (const [key, value] of Object.entries({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
      scope, resource, state, code_challenge: sha256(verifier), code_challenge_method: 'S256',
    })) url.searchParams.set(key, value);
    return { url: url.toString(), state };
  }

  async function callback({ code, state, iss }) {
    required(code, 'CODE'); required(state, 'STATE');
    if (iss && iss !== issuer) throw new Error('ISSUER_MISMATCH');
    const attempt = await store.take('oauth:' + sha256(state));
    if (!attempt || !Number.isFinite(attempt.createdAt) || now() - attempt.createdAt > 600000) throw new Error('OAUTH_STATE_INVALID');
    const form = new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      code_verifier: attempt.verifier, client_id: clientId, resource,
    });
    const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const response = await fetchImpl(tokenEndpoint, {
      method: 'POST', headers: { authorization: 'Basic ' + basic, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(), redirect: 'error',
    });
    if (!response.ok) throw new Error('TOKEN_EXCHANGE_FAILED');
    const tokens = await response.json();
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.token_type?.toLowerCase() !== 'bearer' ||
        !Number.isSafeInteger(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('TOKEN_RESPONSE_INVALID');
    const sessionId = random(48), csrfToken = random();
    await store.put('session:' + sha256(sessionId), {
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null,
      expiresAt: now() + tokens.expires_in * 1000, csrfToken,
    }, Math.min(tokens.expires_in, 3600));
    return { sessionId, csrfToken };
  }

  async function resolve(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    const record = await store.get('session:' + sha256(sessionId));
    if (!record || record.expiresAt <= now()) return null;
    return record;
  }
  async function revoke(sessionId) {
    if (typeof sessionId === 'string' && sessionId) await store.delete('session:' + sha256(sessionId));
  }
  return { begin, callback, resolve, revoke };
}
