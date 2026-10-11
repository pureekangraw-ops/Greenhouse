import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLocalAiCapture } from '../scripts/evaluate-local-ai-capture.mjs';

const expected = {
  intent: 'REMINDER',
  fields: { date: '2026-10-12', time: '09:00', subject: 'ส่งเอกสาร' },
  needsClarification: false,
};
const reply = {
  intent: 'REMINDER',
  fields: { date: '2026-10-12', time: '09:00', subject: 'ส่งเอกสาร' },
  needsClarification: false,
};
const trial = (overrides = {}) => ({
  caseId: 'INTENT-REMINDER-01',
  state: 'WARM',
  expected,
  actual: reply,
  elapsedMs: 5000,
  tokensPerSecond: 10,
  clientTimedOut: false,
  serverCompleted: true,
  ...overrides,
});
const capture = cases => ({
  observedAt: '2026-10-11T08:00:00.000Z',
  model: 'Gemma-4-E2B-it',
  cases,
});

test('capture scorer checks schema and expected intent, fields, and clarification', () => {
  const result = scoreLocalAiCapture(capture([trial()]));
  assert.equal(result.schemaValid, 1);
  assert.equal(result.intentExact, 1);
  assert.equal(result.fieldsExact, 1);
  assert.equal(result.clarificationExact, 1);
  assert.equal(result.exactMatch, 1);
  assert.equal(result.qualification, 'NOT_SET');
});

test('capture scorer reads a JSON string in the OpenAI-compatible response envelope', () => {
  const actual = { choices: [{ message: { content: JSON.stringify(reply) } }] };
  const result = scoreLocalAiCapture(capture([trial({ actual })]));
  assert.equal(result.exactMatch, 1);
});

test('malformed and extra-key model outputs fail the output schema check', () => {
  const malformed = scoreLocalAiCapture(capture([
    trial({ caseId: 'bad-json', actual: '{"intent":' }),
    trial({ caseId: 'extra-key', actual: { ...reply, action: 'EXECUTE' } }),
  ]));
  assert.equal(malformed.schemaValid, 0);
  assert.equal(malformed.exactMatch, 0);
});

test('model mistakes remain visible instead of being coerced into a pass', () => {
  const result = scoreLocalAiCapture(capture([
    trial({ actual: { ...reply, intent: 'CALCULATE' } }),
  ]));
  assert.equal(result.schemaValid, 1);
  assert.equal(result.intentExact, 0);
  assert.equal(result.exactMatch, 0);
});

test('cold startup and warm request latency are summarized separately', () => {
  const result = scoreLocalAiCapture(capture([
    trial({ caseId: 'cold', state: 'COLD', elapsedMs: 65718, tokensPerSecond: null }),
    trial({ caseId: 'warm-1', elapsedMs: 4200, tokensPerSecond: 8.5 }),
    trial({ caseId: 'warm-2', elapsedMs: 8700, tokensPerSecond: 11.5 }),
  ]));
  assert.deepEqual(result.coldElapsedMs, { n: 1, min: 65718, p50: 65718, p95: 65718, max: 65718 });
  assert.deepEqual(result.warmElapsedMs, { n: 2, min: 4200, p50: 4200, p95: 8700, max: 8700 });
  assert.deepEqual(result.warmTokensPerSecond, { n: 2, min: 8.5, p50: 8.5, p95: 11.5, max: 11.5 });
});

test('client timeouts remain separate and expose late or unresolved server outcomes', () => {
  const result = scoreLocalAiCapture(capture([
    trial({ caseId: 'late', clientTimedOut: true, serverCompleted: true, actual: null, elapsedMs: 9000 }),
    trial({ caseId: 'unknown', clientTimedOut: true, serverCompleted: null, actual: null, elapsedMs: null }),
  ]));
  assert.equal(result.clientTimeouts, 2);
  assert.equal(result.serverCompletedAfterClientTimeout, 1);
  assert.equal(result.serverOutcomeUnknownAfterClientTimeout, 1);
  assert.equal(result.warmElapsedMs.n, 0);
});

test('capture scorer output omits raw prompts and responses', () => {
  const secretMarker = 'PRIVATE-TEST-PROMPT';
  const result = scoreLocalAiCapture(capture([
    trial({ actual: secretMarker }),
  ]));
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
});

test('capture input fails closed for duplicate IDs and invalid measurement values', () => {
  assert.throws(() => scoreLocalAiCapture(capture([trial(), trial()])), /LOCAL_AI_CAPTURE_CASE_INVALID/);
  assert.throws(() => scoreLocalAiCapture(capture([trial({ elapsedMs: -1 })])), /LOCAL_AI_CAPTURE_CASE_INVALID/);
});

test('capture scorer rejects impossible calendar dates and clock times', () => {
  const badDate = { ...reply, fields: { ...reply.fields, date: '2026-02-29' } };
  const badTime = { ...reply, fields: { ...reply.fields, time: '24:00' } };
  assert.equal(scoreLocalAiCapture(capture([trial({ actual: badDate })])).schemaValid, 0);
  assert.equal(scoreLocalAiCapture(capture([trial({ actual: badTime })])).schemaValid, 0);
  assert.equal(scoreLocalAiCapture(capture([
    trial({ actual: { ...reply, fields: { ...reply.fields, date: '2028-02-29' } } }),
  ])).schemaValid, 1);
});