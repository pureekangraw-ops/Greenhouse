import test from 'node:test';
import assert from 'node:assert/strict';
import { readMetropolisWork, MetropolisReadError } from '../src/hub/metropolis-read.mjs';
import { createGreenhouseServer } from '../server.mjs';

const TIME = Date.parse('2026-10-09T11:40:32.539Z');
const workId = 'WORK-GREENHOUSE-READBACK-TEST-001';
const checkpointId = workId + ':CP-01';
function record(overrides = {}) {
  return {
    kind: 'WORK_RECORD', workId, ownerSystem: 'GO', state: 'RECEIVED', checkpointId,
    updatedAt: '2026-10-07T22:27:43.984Z',
    workPass: {
      kind: 'WORK_PASS', status: 'ACTIVE', actor: 'GO', workId, checkpointId,
      permissions: { actions: ['read', 'handoff', 'return', 'cancel', 'complete'] },
    },
    journeys: [], reports: [], dataLifecycle: [{ evidenceRefs: [] }],
    ...overrides,
  };
}
function arrival(overrides = {}) {
  return {
    actor: 'LIGHT',
    observedAt: new Date(TIME).toISOString(),
    current: { works: [{ workId, present: true, state: 'RECEIVED', checkpointId,
      ownerSystem: 'GO', authorizedActions: ['read'], accessSource: 'EXPLICIT_POLICY' }] },
    ...overrides,
  };
}
function reply(overrides = {}) {
  return {
    actor: 'LIGHT', record: record(),
    receipt: { operation: 'READ_WORK', workId, checkpointId,
      readbackVerified: true, observedAt: new Date(TIME).toISOString(), persisted: false },
    readbackVerified: true, ownerExecutionVerified: false, workTruthChanged: false,
    ...overrides,
  };
}
const rpc = structuredContent => ({ jsonrpc: '2.0', id: 1, result: { isError: false, structuredContent } });
function fetchWith(results) {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer test-token');
    const call = JSON.parse(options.body);
    assert.equal(call.method, 'tools/call');
    calls.push(call.params);
    const expected = calls.length === 1 ? 'metropolis_arrive' : 'metropolis_work';
    assert.equal(call.params.name, expected);
    if (expected === 'metropolis_arrive') assert.deepEqual(call.params.arguments, {});
    else assert.deepEqual(call.params.arguments, { action: 'read', workId });
    return Response.json(results.shift());
  };
  return { fetchImpl, calls };
}
const invoke = (results, overrides = {}) => {
  const fake = fetchWith(results);
  return { promise: readMetropolisWork({
    workId, token: 'test-token', now: () => TIME, fetchImpl: fake.fetchImpl, ...overrides,
  }), fake };
};
async function rejectsWith(promise, code) {
  await assert.rejects(promise, error => error instanceof MetropolisReadError && error.code === code);
}

test('live-shaped delegated LIGHT arrival then exact read grant returns verified read-only Work report', async () => {
  const { promise, fake } = invoke([rpc(arrival()), rpc(reply())]);
  const report = await promise;
  assert.equal(fake.calls.length, 2);
  assert.equal(report.requestedBy, 'GREENHOUSE');
  assert.equal(report.actor, 'LIGHT');
  assert.equal(report.workId, workId);
  assert.equal(report.checkpointId, checkpointId);
  assert.equal(report.ownerSource, 'Metropolis City Hall / GO');
  assert.equal(report.ownerState, 'RECEIVED');
  assert.equal(report.sourceUpdatedAt, '2026-10-07T22:27:43.984Z');
  assert.equal(report.freshness, 'CURRENT');
  assert.equal(report.confidence, 'CONFIRMED');
  assert.equal(report.ownerExecutionVerified, false);
  assert.equal(report.receiptId, null);
  assert.equal(report.evidence.length, 0);
  assert.match(report.limitations.join(' '), /execution is not independently verified/);
  assert.match(report.limitations.join(' '), /lifecycle timestamp/);
  assert.equal(JSON.stringify(report).includes('test-token'), false);
});

test('fresh source readback remains CURRENT even when Work lifecycle updatedAt is older', async () => {
  const { promise } = invoke([rpc(arrival()), rpc(reply())]);
  const report = await promise;
  assert.equal(report.freshness, 'CURRENT');
  assert.equal(report.sourceUpdatedAt, '2026-10-07T22:27:43.984Z');
});

test('stale arrival and missing exact read grant fail closed before the Work read', async () => {
  const oldArrival = arrival({ observedAt: new Date(TIME - 120_000).toISOString() });
  const old = invoke([rpc(oldArrival), rpc(reply())]);
  await rejectsWith(old.promise, 'ARRIVAL_UNVERIFIED');
  assert.equal(old.fake.calls.length, 1);
  const noGrant = arrival({ current: { works: [{ ...arrival().current.works[0], authorizedActions: [] }] } });
  const denied = invoke([rpc(noGrant), rpc(reply())]);
  await rejectsWith(denied.promise, 'WORK_NOT_GRANTED');
  assert.equal(denied.fake.calls.length, 1);
});

test('readback actor, Work, checkpoint, Work Pass and source receipt must all agree', async () => {
  await rejectsWith(invoke([rpc(arrival()), rpc(reply({ actor: 'GO' }))]).promise, 'OWNER_READBACK_MISMATCH');
  await rejectsWith(invoke([rpc(arrival()), rpc(reply({ readbackVerified: false }))]).promise, 'OWNER_READBACK_MISMATCH');
  await rejectsWith(invoke([rpc(arrival()), rpc(reply({ workTruthChanged: true }))]).promise, 'OWNER_READBACK_MISMATCH');
  await rejectsWith(invoke([rpc(arrival()), rpc(reply({ record: record({ workId: 'WORK-other' }) }))]).promise, 'OWNER_READBACK_MISMATCH');
  await rejectsWith(invoke([rpc(arrival()), rpc(reply({ record: record({ checkpointId: 'WORK-other:CP-1' }) }))]).promise, 'OWNER_READBACK_MISMATCH');
  await rejectsWith(invoke([rpc(arrival()), rpc(reply({ record: record({ workPass: { status: 'REVOKED', workId, checkpointId, permissions: { actions: ['read'] } } }) }))]).promise, 'OWNER_READBACK_MISMATCH');
  await rejectsWith(invoke([rpc(arrival()), rpc(reply({ receipt: { operation: 'HANDOFF', workId, checkpointId, readbackVerified: true, observedAt: new Date(TIME).toISOString(), persisted: false } }))]).promise, 'OWNER_READBACK_MISMATCH');
});

test('adapter rejects invalid Work IDs, missing token, arbitrary endpoints and unauthorized HTTP', async () => {
  await rejectsWith(readMetropolisWork({ workId:'../../bad',token:'secret' }), 'WORK_ID_INVALID');
  await rejectsWith(readMetropolisWork({ workId,token:'' }), 'OWNER_CONNECTION_REQUIRED');
  await rejectsWith(readMetropolisWork({ workId,token:'abc',endpoint:'https://evil.example/mcp' }), 'ENDPOINT_NOT_ALLOWED');
  const unauthorized = invoke([null, null], { fetchImpl: async () => new Response('', {status:401}) });
  await rejectsWith(unauthorized.promise, 'OWNER_AUTH_REQUIRED');
});

async function withServer(options, cb) {
  const server = createGreenhouseServer(options);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  try { await cb('http://127.0.0.1:' + port); }
  finally { await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('local Office GET uses server token and performs fresh arrival before exact Work read', async () => {
  const fake = fetchWith([rpc(arrival()), rpc(reply())]);
  await withServer({ token:'test-token', now:() => TIME, fetchImpl: fake.fetchImpl }, async origin => {
    const response = await fetch(origin + '/api/office/work?workId=' + workId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.source, 'METROPOLIS_OWNER_READBACK');
    assert.equal(body.report.workId, workId);
    assert.equal(body.report.freshness, 'CURRENT');
    assert.equal(body.report.ownerExecutionVerified, false);
    assert.equal(JSON.stringify(body).includes('test-token'), false);
    assert.equal(fake.calls.length, 2);
    const post = await fetch(origin + '/api/office/work?workId=' + workId, {method:'POST'});
    assert.equal(post.status,405);
    const duplicate = await fetch(origin + '/api/office/work?workId=' + workId + '&workId=WORK-other');
    assert.equal(duplicate.status,400);
  });
});

test('local server fails closed without owner connection and rejects foreign Origin', async () => {
  await withServer({}, async origin => {
    const noAuth = await fetch(origin + '/api/office/work?workId=' + workId);
    assert.equal(noAuth.status,401);
    assert.equal((await noAuth.json()).code,'OWNER_SESSION_REQUIRED');
    const crossOrigin = await fetch(origin + '/api/office/work?workId=' + workId, {headers:{origin:'https://evil.example'}});
    assert.equal(crossOrigin.status,403);
    const asset = await fetch(origin + '/');
    assert.equal(asset.status,200);
    assert.match(await asset.text(),/Genome Hub/);
    const invalid = await fetch(origin + '/src/agents/policy.mjs');
    assert.equal(invalid.status,404);
  });
});
