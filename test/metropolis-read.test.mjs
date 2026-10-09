import test from 'node:test';
import assert from 'node:assert/strict';
import { readMetropolisWork, MetropolisReadError } from '../src/hub/metropolis-read.mjs';
import { createGreenhouseServer } from '../server.mjs';

const TIME = Date.parse('2026-10-09T10:00:00.000Z');
const workId = 'WORK-greenhouse-proof-123';
function record(overrides = {}) {
  return {
    workId, checkpointId: workId + ':CP-01', ownerSystem: 'OBSERVATORY',
    state: 'WAITING', updatedAt: new Date(TIME - 5000).toISOString(),
    journeys: [{ baggageOut: { evidenceRefs: ['evidence://factory/proof'], receiptRefs: ['receipt-proof-1'] } }],
    ...overrides,
  };
}
function mcpResponse(overrides = {}) {
  return {
    jsonrpc: '2.0', id: 1, result: {
      isError: false,
      structuredContent: {
        actor: 'GO',
        delegatedAccess: { owner: 'BIG', actingAgent: 'GO', authority: 'OWNER_DELEGATED' },
        readbackVerified: true,
        ownerExecutionVerified: false,
        record: record(),
        ...overrides,
      },
    },
  };
}
const fetchWith = payload => async (_url, options) => {
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.authorization, 'Bearer test-token');
  const call = JSON.parse(options.body);
  assert.equal(call.method, 'tools/call');
  assert.equal(call.params.name, 'metropolis_work');
  assert.deepEqual(call.params.arguments, { action: 'read', workId });
  return Response.json(payload);
};
const invoke = (payload, overrides = {}) => readMetropolisWork({
  workId, token: 'test-token', now: () => TIME, fetchImpl: fetchWith(payload), ...overrides,
});
async function rejectsWith(promise, code) {
  await assert.rejects(promise, error => error instanceof MetropolisReadError && error.code === code);
}

test('real-shaped delegated MCP read creates bounded, source-backed Office report', async () => {
  const report = await invoke(mcpResponse());
  assert.equal(report.requestedBy, 'OFFICE');
  assert.equal(report.workId, workId);
  assert.equal(report.ownerSource, 'Metropolis City Hall / OBSERVATORY');
  assert.equal(report.ownerState, 'WAITING');
  assert.equal(report.checkpointId, workId + ':CP-01');
  assert.equal(report.sourceUpdatedAt, new Date(TIME-5000).toISOString());
  assert.equal(report.freshness, 'CURRENT');
  assert.equal(report.workStatus, 'WAITING');
  assert.equal(report.confidence, 'CONFIRMED');
  assert.equal(report.receiptId, 'receipt-proof-1');
  assert.deepEqual(report.evidence, ['evidence://factory/proof', 'receipt-proof-1']);
  assert.match(report.limitations.join(' '), /not independently verified/);
  assert.equal(JSON.stringify(report).includes('test-token'), false);
});

test('successful HTTP read does not turn stale Work state into CURRENT', async () => {
  const report = await invoke(mcpResponse({ record: record({updatedAt: new Date(TIME - 3600_000).toISOString()}) }));
  assert.equal(report.freshness, 'STALE');
  assert.match(report.nextAction, /updated owner-source/);
});

test('read with no owner evidence remains UNKNOWN confidence, never fabricates evidence', async () => {
  const report = await invoke(mcpResponse({ record: record({ journeys: [] }) }));
  assert.deepEqual(report.evidence, []);
  assert.equal(report.confidence, 'UNKNOWN');
  assert.equal(report.receiptId, null);
});

test('unverified readback, forged delegated owner and context mismatch fail closed', async () => {
  await rejectsWith(invoke(mcpResponse({readbackVerified:false})), 'OWNER_READBACK_MISMATCH');
  await rejectsWith(invoke(mcpResponse({delegatedAccess:{owner:'SOMEONE',actingAgent:'GO',authority:'OWNER_DELEGATED'}})), 'OWNER_DELEGATION_REQUIRED');
  await rejectsWith(invoke(mcpResponse({actor:'LIGHT'})), 'OWNER_DELEGATION_REQUIRED');
  await rejectsWith(invoke(mcpResponse({record:record({workId:'WORK-other'})})), 'OWNER_READBACK_MISMATCH');
  await rejectsWith(invoke(mcpResponse({record:record({checkpointId:null})})), 'OWNER_READBACK_MISMATCH');
});

test('read-only adapter rejects invalid Work IDs, missing token, arbitrary endpoints and HTTP unauthorized', async () => {
  await rejectsWith(readMetropolisWork({ workId:'../../bad',token:'secret' }), 'WORK_ID_INVALID');
  await rejectsWith(readMetropolisWork({ workId,token:'' }), 'OWNER_CONNECTION_REQUIRED');
  await rejectsWith(readMetropolisWork({ workId,token:'abc',endpoint:'https://evil.example/mcp' }), 'ENDPOINT_NOT_ALLOWED');
  await rejectsWith(invoke(null, {fetchImpl: async () => new Response('',{status:401})}), 'OWNER_AUTH_REQUIRED');
  await rejectsWith(invoke({}), 'OWNER_RESPONSE_INVALID');
});

async function withServer(options, cb) {
  const server = createGreenhouseServer(options);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  try { await cb('http://127.0.0.1:' + port); }
  finally { await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('local Office GET reports from server token; no client token accepted', async () => {
  await withServer({ token:'test-token', now:() => TIME, fetchImpl: fetchWith(mcpResponse()) }, async origin => {
    const response = await fetch(origin + '/api/office/work?workId=' + workId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.source, 'METROPOLIS_OWNER_READBACK');
    assert.equal(body.report.workId, workId);
    assert.equal(JSON.stringify(body).includes('test-token'), false);
    const post = await fetch(origin + '/api/office/work?workId=' + workId, {method:'POST'});
    assert.equal(post.status,405);
    const duplicate = await fetch(origin + '/api/office/work?workId=' + workId + '&workId=WORK-other');
    assert.equal(duplicate.status,400);
  });
});

test('local server fails closed without owner OAuth, rejects foreign Origin and traversal', async () => {
  await withServer({}, async origin => {
    const noAuth = await fetch(origin + '/api/office/work?workId=' + workId);
    assert.equal(noAuth.status,503);
    assert.equal((await noAuth.json()).code,'OWNER_CONNECTION_REQUIRED');
    const crossOrigin = await fetch(origin + '/api/office/work?workId=' + workId, {headers:{origin:'https://evil.example'}});
    assert.equal(crossOrigin.status,403);
    const asset = await fetch(origin + '/');
    assert.equal(asset.status,200);
    assert.match(await asset.text(),/Genome Hub/);
    const invalid = await fetch(origin + '/src/agents/policy.mjs');
    assert.equal(invalid.status,404);
  });
});
