import test from 'node:test';
import assert from 'node:assert/strict';
import { createGreenhouseServer } from '../server.mjs';
import { parseSourceRegistry, signGreenhouseEvent } from '../src/greenhouse/events.mjs';

const now = Date.parse('2026-10-09T05:00:00.000Z');
const secret = 'test-secret-that-is-at-least-32-bytes-long';
const sourceRegistry = parseSourceRegistry(JSON.stringify({ shop: { secret, eventTypes: ['product.updated'] } }));
const envelope = {
  schemaVersion:'greenhouse.event.v1', eventId:'event-001', source:'shop', eventType:'product.updated',
  occurredAt:new Date(now - 1000).toISOString(), correlationId:'corr-001', workId:null,
  checkpointId:null, payloadRef:null, classification:'INTERNAL',
};
async function withServer(t, options = {}) {
  const server = createGreenhouseServer({ now: () => now, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
function signedHeaders(body, timestamp = String(now)) {
  return { 'content-type':'application/json', 'x-greenhouse-timestamp':timestamp, 'x-greenhouse-signature':signGreenhouseEvent(body, timestamp, secret) };
}

test('serves PWA shell, manifest, icon and offline-only status with private API no-store', async t => {
  const base = await withServer(t);
  const page = await fetch(base + '/greenhouse/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Owner Inbox/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + '/greenhouse/manifest.webmanifest')).status, 200);
  assert.equal((await fetch(base + '/greenhouse/icon.svg')).status, 200);
  const status = await fetch(base + '/api/greenhouse/status');
  assert.deepEqual(await status.json(), { ownerSession:false, inboxReader:false, eventIngress:false, remoteCommands:false, privateDataCached:false });
  assert.equal((await fetch(base + '/api/greenhouse/inbox')).status, 503);
});
test('valid event is forwarded only to the existing Hub sink and returns its receipt, never execution success', async t => {
  const calls = [];
  const base = await withServer(t, { sourceRegistry, hubEventSink: async input => { calls.push(input); return { receiptId:'hub-receipt-1', duplicate:false }; } });
  const body = JSON.stringify(envelope);
  const response = await fetch(base + '/api/greenhouse/events', { method:'POST', headers:signedHeaders(body), body });
  const result = await response.json();
  assert.equal(response.status, 202);
  assert.equal(result.receiptId, 'hub-receipt-1');
  assert.equal(result.execution, 'NOT_ASSERTED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, 'shop:event-001');
  assert.equal(calls[0].event.receivedAt, new Date(now).toISOString());
});
test('valid event fails closed if upstream Hub sink is absent; invalid signature is rejected first', async t => {
  const base = await withServer(t, { sourceRegistry });
  const body = JSON.stringify(envelope);
  const invalid = await fetch(base + '/api/greenhouse/events', { method:'POST', headers:{ ...signedHeaders(body), 'x-greenhouse-signature':'sha256='+'0'.repeat(64) }, body });
  assert.equal(invalid.status, 401);
  const unavailable = await fetch(base + '/api/greenhouse/events', { method:'POST', headers:signedHeaders(body), body });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { code:'HUB_EVENT_SINK_UNAVAILABLE' });
});
test('owner inbox requires an owner session and returns only upstream readback', async t => {
  let seen;
  const base = await withServer(t, {
    ownerSessionResolver: async () => ({ actorId:'owner-verified' }),
    inboxReader: async input => { seen=input; return { items:[{ title:'Verified work', workId:'WORK-123', ownerSource:'Owner System', observedAt:new Date(now).toISOString(), confidence:'CONFIRMED', freshness:'CURRENT', payload:'must-not-leak' }], observedAt:new Date(now).toISOString(), nextCursor:null, rawSecret:'must-not-leak' }; },
  });
  const response = await fetch(base + '/api/greenhouse/inbox?cursor=cursor-1');
  assert.equal(response.status, 200);
  assert.deepEqual(seen, { session:{ actorId:'owner-verified' }, cursor:'cursor-1' });
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['items','observedAt','nextCursor']);
  assert.deepEqual(Object.keys(body.items[0]), ['title','ownerSource','confidence','observedAt','freshness','workId']);
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('commands refuse by default; configured relay receives server actor and requires CSRF origin', async t => {
  const off = await withServer(t);
  assert.equal((await fetch(off + '/api/greenhouse/commands', { method:'POST', headers:{ origin:off }, body:'{}' })).status, 503);
  let seen;
  const base = await withServer(t, {
    ownerSessionResolver: async () => ({ actorId:'owner-session-17', csrfToken:'csrf-verified' }),
    commandAuthorizer: async ({ command, session }) => ({ authorized:true, actorId:session.actorId, target:command.target, workId:command.workId, checkpointId:command.checkpointId }),
    hubCommandSubmitter: async input => { seen=input; return { receiptId:'command-receipt', state:'ACCEPTED' }; },
    allowedCommandTargets:['existing.test.handoff'], highImpactCommandTargets:['existing.test.handoff'],
  });
  const cmd = { schemaVersion:'greenhouse.command.v1', commandId:'cmd-1', idempotencyKey:'idem-1', target:'existing.test.handoff', ownerConfirmed:true, workId:'WORK-123', checkpointId:'WORK-123:CP-1', intent:'handoff to approved station', requestedAt:new Date(now).toISOString() };
  const noOrigin = await fetch(base + '/api/greenhouse/commands', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(cmd) });
  assert.equal(noOrigin.status, 403);
  const response = await fetch(base + '/api/greenhouse/commands', { method:'POST', headers:{'content-type':'application/json', origin:base, 'x-csrf-token':'csrf-verified'}, body:JSON.stringify(cmd) });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.execution, 'NOT_ASSERTED');
  assert.equal(seen.command.actor, 'owner-session-17');
  assert.equal(seen.authorization.workId, cmd.workId);
  assert.equal(seen.authorization.target, cmd.target);
  const cancel = { ...cmd, commandId:'cmd-2', ownerConfirmed:false };
  const denied = await fetch(base + '/api/greenhouse/commands', { method:'POST', headers:{'content-type':'application/json', origin:base, 'x-csrf-token':'csrf-verified'}, body:JSON.stringify(cancel) });
  assert.equal(denied.status, 400);
  assert.equal((await denied.json()).code, 'COMMAND_SCHEMA_INVALID');
});
