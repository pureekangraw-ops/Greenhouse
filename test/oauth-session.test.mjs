import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthSessionManager } from '../src/greenhouse/oauth-session.mjs';

function setup() {
  const rows = new Map();
  const store = {
    put: async (key, value) => rows.set(key, value),
    take: async key => { const value = rows.get(key); rows.delete(key); return value; },
    get: async key => rows.get(key),
    delete: async key => rows.delete(key),
  };
  let exchange;
  const manager = createOAuthSessionManager({
    issuer: 'https://issuer.example', clientId: 'greenhouse', clientSecret: 'private',
    redirectUri: 'https://greenhouse.example/auth/metropolis/callback',
    resource: 'https://issuer.example/mcp', store,
    fetchImpl: async (url, init) => {
      exchange = { url, init };
      return { ok: true, json: async () => ({ access_token: 'secret-token', token_type: 'Bearer', expires_in: 300 }) };
    },
  });
  return { manager, rows, getExchange: () => exchange };
}

test('PKCE uses S256 and stores verifier only on server', async () => {
  const { manager, rows } = setup();
  const { url, state } = await manager.begin();
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('state'), state);
  assert.equal(parsed.searchParams.has('code_verifier'), false);
  assert.equal(rows.size, 1);
});
test('callback consumes state once and keeps tokens out of cookie value', async () => {
  const { manager, getExchange } = setup();
  const { state } = await manager.begin();
  const { sessionId } = await manager.callback({ code: 'test-code', state });
  assert.ok(sessionId);
  assert.equal(sessionId.includes('secret-token'), false);
  assert.match(getExchange().init.headers.authorization, /^Basic /);
  assert.equal((await manager.resolve(sessionId)).accessToken, 'secret-token');
  await assert.rejects(manager.callback({ code: 'test-code', state }), /OAUTH_STATE_INVALID/);
  await manager.revoke(sessionId);
  assert.equal(await manager.resolve(sessionId), null);
});
test('rejects issuer mismatch before token exchange', async () => {
  const { manager } = setup();
  const { state } = await manager.begin();
  await assert.rejects(manager.callback({ code: 'abc', state, iss: 'https://other.example' }), /ISSUER_MISMATCH/);
});
