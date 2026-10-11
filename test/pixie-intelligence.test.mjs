import test from 'node:test';
import assert from 'node:assert/strict';
import { createPixieIntelligence } from '../src/pixie/intelligence.mjs';

const observedAt = '2026-10-11T02:00:00.000Z';
const evidenceRef = 'owner://greenhouse/attempt/attempt-1';
const input = Object.freeze({
  workId: 'WORK-GREENHOUSE-1',
  checkpointId: 'WORK-GREENHOUSE-1:CP-01',
  attemptId: 'attempt-1',
  state: 'WAITING_ROUTE',
  observedAt,
  task: 'Explain the current delivery blocker and recommend one safe next step.',
  evidence: [{ ref: evidenceRef, excerpt: 'The existing authorized route is not ready.' }],
});
const output = () => ({
  summary: 'The attempt is waiting for its authorized route.',
  findings: [{ kind: 'FACT', text: 'The route is not ready.', evidenceRefs: [evidenceRef] }],
  recommendation: 'Wait for the existing route readback; do not resend.',
  confidence: 'PROBABLE',
});
const fixedClock = () => '2026-10-11T02:00:01.000Z';

test('unconfigured intelligence is a non-blocking shadow result', async () => {
  const result = await createPixieIntelligence({ clock: fixedClock }).analyze(input);
  assert.equal(result.status, 'NOT_CONFIGURED');
  assert.equal(result.mode, 'SHADOW');
  assert.equal(result.executed, false);
  assert.equal(result.analysis, null);
});

test('provider receives scoped evidence only and returns advisory analysis', async () => {
  let received;
  const result = await createPixieIntelligence({
    provider: async call => { received = call; return output(); },
    clock: fixedClock,
  }).analyze(input);
  assert.deepEqual(Object.keys(received).sort(), ['evidence', 'signal', 'system', 'task', 'work']);
  assert.equal(received.work.workId, input.workId);
  assert.equal(received.signal.aborted, false);
  assert.match(received.system, /shadow mode/i);
  assert.equal(result.status, 'SHADOW_PROPOSED');
  assert.equal(result.executed, false);
  assert.equal(result.analysis.confidence, 'PROBABLE');
  assert.deepEqual(result.analysis.evidenceRefs, [evidenceRef]);
});

test('fact findings require an exact supplied evidence reference', async () => {
  const noReference = output();
  noReference.findings[0].evidenceRefs = [];
  const unknownReference = output();
  unknownReference.findings[0].evidenceRefs = ['owner://not-in-context'];
  for (const invalid of [noReference, unknownReference]) {
    const result = await createPixieIntelligence({ provider: async () => invalid, clock: fixedClock }).analyze(input);
    assert.equal(result.status, 'INVALID_OUTPUT');
    assert.equal(result.analysis, null);
    assert.equal(result.executed, false);
  }
});

test('model cannot mark its own conclusion CONFIRMED or add an execution field', async () => {
  const overconfident = { ...output(), confidence: 'CONFIRMED' };
  const withCommand = { ...output(), execute: { operation: 'dispatch' } };
  for (const invalid of [overconfident, withCommand]) {
    const result = await createPixieIntelligence({ provider: async () => invalid, clock: fixedClock }).analyze(input);
    assert.equal(result.status, 'INVALID_OUTPUT');
  }
});

test('provider failure degrades to UNAVAILABLE without changing the input', async () => {
  const snapshot = structuredClone(input);
  const result = await createPixieIntelligence({ provider: async () => { throw new Error('offline'); }, clock: fixedClock }).analyze(input);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.executed, false);
  assert.deepEqual(input, snapshot);
});

test('provider timeout aborts its signal and returns a shadow timeout', async () => {
  let signal;
  const result = await createPixieIntelligence({
    provider: ({ signal: currentSignal }) => { signal = currentSignal; return new Promise(() => {}); },
    timeoutMs: 25,
    clock: fixedClock,
  }).analyze(input);
  assert.equal(signal.aborted, true);
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(result.executed, false);
});

test('invalid or evidence-free work context is rejected before model invocation', async () => {
  let calls = 0;
  const service = createPixieIntelligence({ provider: async () => { calls += 1; return output(); }, clock: fixedClock });
  await assert.rejects(service.analyze({ ...input, checkpointId: 'WORK-OTHER:CP-01' }), /PIXIE_INTELLIGENCE_INPUT_INVALID/);
  await assert.rejects(service.analyze({ ...input, evidence: [] }), /PIXIE_INTELLIGENCE_INPUT_INVALID/);
  assert.equal(calls, 0);
});
