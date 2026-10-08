import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetropolisMcpClient, createMetropolisReportReader } from '../src/adapters/metropolis-read.mjs';

const now = Date.parse('2026-10-08T14:00:00.000Z');
const workId = 'WORK-EXISTING-001';
const checkpointId = workId + ':CP-01';
const actor = 'GO';
const ownerSystem = 'GREENHOUSE';
const work = {
  workId, checkpointId, ownerSystem, state: 'RECEIVED',
  updatedAt: '2026-10-07T10:00:00.000Z',
  reports: [{ evidenceRefs: ['r2://proof/report-1', 'r2://proof/report-1'] }],
};
const arrival = overrides => ({
  actor, observedAt: new Date(now).toISOString(),
  current: { works: [{ workId, present: true, checkpointId, ownerSystem, authorizedActions: ['read'] }] },
  ...overrides,
});
const reply = overrides => ({
  actor, readbackVerified: true, ownerExecutionVerified: false,
  record: work, ...overrides,
});
const fakeClient = (arrive = arrival(), read = reply()) => {
  const calls = [];
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === 'metropolis_arrive') return arrive;
      if (name === 'metropolis_work') return read;
      throw Error('unexpected call');
    },
  };
};
const readWith = client => createMetropolisReportReader({ client, clock: () => now }).readWork(workId);

test('confirmed read uses the existing work, checkpoint and actor', async () => {
  const client = fakeClient();
  const result = await readWith(client);
  assert.deepEqual(client.calls, [
    { name: 'metropolis_arrive', args: {} },
    { name: 'metropolis_work', args: { action: 'read', workId } },
  ]);
  assert.equal(result.work.checkpointId, checkpointId);
  assert.equal(result.work.lifecycleState, 'RECEIVED');
  assert.equal(result.report.requestedBy, 'GREENHOUSE');
  assert.equal(result.report.ownerSource, 'METROPOLIS_WORK_SYSTEM');
  assert.equal(result.report.freshness, 'CURRENT');
  assert.equal(result.report.confidence, 'CONFIRMED');
  assert.equal(result.report.workStatus, null);
  assert.deepEqual(result.report.evidence, ['r2://proof/report-1']);
  assert.equal(result.verification.workReadbackVerified, true);
  assert.equal(result.verification.ownerExecutionVerified, false);
  assert.match(result.report.limitations.join(' '), /does not verify an Owner System operation/);
});

test('ungranted work never calls metropolis_work', async () => {
  const client = fakeClient(arrival({
    current: { works: [{ workId, present: true, checkpointId, ownerSystem, authorizedActions: [] }] },
  }));
  const result = await readWith(client);
  assert.equal(result.reason, 'WORK_NOT_GRANTED');
  assert.equal(result.report.confidence, 'UNKNOWN');
  assert.equal(result.report.freshness, 'UNKNOWN');
  assert.equal(result.work, null);
  assert.equal(client.calls.length, 1);
});

test('missing pointer and missing checkpoint both fail closed', async () => {
  for (const works of [[], [{ workId, present: true, checkpointId: null, ownerSystem, authorizedActions: ['read'] }]]) {
    const client = fakeClient(arrival({ current: { works } }));
    assert.equal((await readWith(client)).reason, 'WORK_NOT_GRANTED');
    assert.equal(client.calls.length, 1);
  }
});

test('stale or unverified arrival is never used to read work', async () => {
  for (const observedAt of ['2026-10-07T14:00:00Z', 'not-a-date']) {
    const client = fakeClient(arrival({ observedAt }));
    assert.equal((await readWith(client)).reason, 'ARRIVAL_UNVERIFIED');
    assert.equal(client.calls.length, 1);
  }
});

test('actor, checkpoint, owner and readback mismatches deny confirmation', async () => {
  const mismatches = [
    { actor: 'LIGHT' },
    { readbackVerified: false },
    { record: { ...work, checkpointId: 'WRONG' } },
    { record: { ...work, ownerSystem: 'WRONG' } },
    { record: { ...work, workId: 'OTHER' } },
    { record: { ...work, state: null } },
  ];
  for (const mismatch of mismatches) {
    const result = await readWith(fakeClient(arrival(), reply(mismatch)));
    assert.equal(result.reason, 'WORK_READBACK_MISMATCH');
    assert.equal(result.verification.workReadbackVerified, false);
    assert.equal(result.work, null);
  }
});

test('readback with no owner evidence does not invent evidence', async () => {
  const result = await readWith(fakeClient(arrival(), reply({
    record: { ...work, reports: [], return: { verified: true, evidenceRefs: [] } },
    ownerExecutionVerified: true,
  })));
  assert.deepEqual(result.report.evidence, []);
  assert.equal(result.verification.ownerExecutionVerified, false);
  assert.match(result.report.limitations.join(' '), /No external evidence/);
});

test('workStatus is only copied for exact BLOCKED or WAITING states', async () => {
  for (const state of ['WAITING', 'BLOCKED', 'COMPLETED']) {
    const result = await readWith(fakeClient(arrival(), reply({ record: { ...work, state } })));
    assert.equal(result.report.workStatus, ['WAITING', 'BLOCKED'].includes(state) ? state : null);
    assert.equal(result.verification.ownerExecutionVerified, false);
  }
});

test('source outage yields UNKNOWN, never falls back to mock status', async () => {
  const client = { async callTool() { throw Error('Bearer secret-leak'); } };
  const result = await readWith(client);
  assert.equal(result.reason, 'METROPOLIS_UNAVAILABLE');
  assert.equal(result.report.confidence, 'UNKNOWN');
  assert.equal(result.work, null);
  assert.doesNotMatch(JSON.stringify(result), /secret-leak/);
});

test('reader input and configuration are validated', async () => {
  assert.throws(() => createMetropolisReportReader(), /CONFIG_INVALID/);
  const reader = createMetropolisReportReader({ client: fakeClient(), clock: () => now });
  await assert.rejects(reader.readWork(''), /WORK_ID_REQUIRED/);
  await assert.rejects(reader.readWork('a'.repeat(257)), /WORK_ID_REQUIRED/);
});

test('MCP client sends only authenticated read-only tools to the configured HTTPS endpoint', async () => {
  const calls = [];
  const client = createMetropolisMcpClient({
    endpoint: 'https://metro.example/mcp',
    getAccessToken: async () => 'private-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { isError: false, structuredContent: arrival() },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(await client.callTool('metropolis_arrive'), arrival());
  assert.equal(calls[0].url, 'https://metro.example/mcp');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.authorization, 'Bearer private-token');
  assert.equal(JSON.parse(calls[0].options.body).params.name, 'metropolis_arrive');
  assert.equal(calls.length, 1);
  await assert.rejects(client.callTool('metropolis_work', { action: 'complete', workId }), /READ_ONLY_TOOL_REQUIRED/);
  await assert.rejects(client.callTool('metropolis_reception', {}), /READ_ONLY_TOOL_REQUIRED/);
  await assert.rejects(client.callTool('metropolis_work', { action: 'read', workId, payload: {} }), /READ_ONLY_TOOL_REQUIRED/);
  assert.equal(calls.length, 1);
});

test('endpoint without HTTPS or exact MCP route is rejected', () => {
  for (const endpoint of ['http://example.com/mcp', 'https://example.com/private',
    'https://user:password@example.com/mcp', 'https://example.com/mcp?key=123']) {
    assert.throws(() => createMetropolisMcpClient({ endpoint, getAccessToken: () => 'token' }), /MCP_ENDPOINT_INVALID/);
  }
});

test('tool JSON text is supported, errors and malformed source fail closed', async () => {
  const client = createMetropolisMcpClient({
    endpoint: 'https://metro.example/mcp',
    getAccessToken: () => 'token',
    fetchImpl: async () => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify(arrival()) }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal((await client.callTool('metropolis_arrive')).actor, 'GO');

  const denied = createMetropolisMcpClient({
    endpoint: 'https://metro.example/mcp',
    getAccessToken: () => 'token',
    fetchImpl: async () => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { isError: true, structuredContent: { reason: 'NO_GRANT' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(denied.callTool('metropolis_arrive'), /METROPOLIS_READ_UNAVAILABLE/);
});

test('HTTP unauthorized does not echo auth data', async () => {
  const client = createMetropolisMcpClient({
    endpoint: 'https://metro.example/mcp',
    getAccessToken: () => 'my-secret-token',
    fetchImpl: async () => new Response('Bearer my-secret-token', { status: 401 }),
  });
  await assert.rejects(client.callTool('metropolis_arrive'), error => {
    assert.equal(error.message, 'METROPOLIS_READ_UNAVAILABLE');
    assert.doesNotMatch(error.message, /my-secret-token/);
    return true;
  });
});
