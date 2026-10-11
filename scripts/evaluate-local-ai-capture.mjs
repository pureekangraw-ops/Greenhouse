import { readFile } from 'node:fs/promises';

const INTENTS = new Set(['REMINDER', 'SUMMARIZE', 'CALCULATE', 'OTHER', 'UNKNOWN']);
const TOP_KEYS = ['fields', 'intent', 'needsClarification'];
const FIELD_KEYS = ['date', 'subject', 'time'];
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validStringOrNull = value => value === null || (typeof value === 'string' && value.trim() !== '');
function validDate(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1];
}
const validTime = value => value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validNumber = value => value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const exactKeys = (value, keys) => isRecord(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');

function parseResponse(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!isRecord(value)) return null;
  if (Array.isArray(value.choices)) {
    const content = value.choices[0]?.message?.content;
    if (typeof content !== 'string') return null;
    try { value = JSON.parse(content); } catch { return null; }
  }
  return isRecord(value) ? value : null;
}

function validResult(value) {
  return exactKeys(value, TOP_KEYS) &&
    INTENTS.has(value.intent) &&
    typeof value.needsClarification === 'boolean' &&
    exactKeys(value.fields, FIELD_KEYS) &&
    validDate(value.fields.date) &&
    validTime(value.fields.time) &&
    validStringOrNull(value.fields.subject);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function summarize(values) {
  if (!values.length) return { n: 0, min: null, p50: null, p95: null, max: null };
  return {
    n: values.length,
    min: Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

function validateCapture(capture) {
  if (!isRecord(capture) || typeof capture.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(capture.observedAt)) ||
      !Array.isArray(capture.cases) || capture.cases.length === 0) {
    throw new TypeError('LOCAL_AI_CAPTURE_INVALID');
  }
  const ids = new Set();
  for (const item of capture.cases) {
    if (!isRecord(item) || typeof item.caseId !== 'string' || !item.caseId.trim() ||
        ids.has(item.caseId) || !['COLD', 'WARM', 'UNKNOWN'].includes(item.state) ||
        !isRecord(item.expected) || !INTENTS.has(item.expected.intent) ||
        typeof item.expected.needsClarification !== 'boolean' ||
        !exactKeys(item.expected.fields, FIELD_KEYS) ||
        !validDate(item.expected.fields.date) || !validTime(item.expected.fields.time) ||
        !validStringOrNull(item.expected.fields.subject) ||
        typeof item.clientTimedOut !== 'boolean' ||
        !(item.serverCompleted === null || typeof item.serverCompleted === 'boolean') ||
        !validNumber(item.elapsedMs) || !validNumber(item.tokensPerSecond)) {
      throw new TypeError('LOCAL_AI_CAPTURE_CASE_INVALID');
    }
    ids.add(item.caseId);
  }
}

export function scoreLocalAiCapture(capture) {
  validateCapture(capture);
  const scored = capture.cases.map(item => {
    const actual = parseResponse(item.actual);
    const schemaValid = validResult(actual);
    const fieldsExact = schemaValid &&
      FIELD_KEYS.every(key => actual.fields[key] === item.expected.fields[key]);
    const intentExact = schemaValid && actual.intent === item.expected.intent;
    const clarificationExact = schemaValid &&
      actual.needsClarification === item.expected.needsClarification;
    return {
      caseId: item.caseId,
      state: item.state,
      clientTimedOut: item.clientTimedOut,
      serverCompleted: item.serverCompleted,
      schemaValid,
      intentExact,
      fieldsExact,
      clarificationExact,
      exactMatch: schemaValid && intentExact && fieldsExact && clarificationExact,
    };
  });

  const timedOut = capture.cases.filter(item => item.clientTimedOut);
  const elapsed = state => capture.cases
    .filter(item => item.state === state && !item.clientTimedOut && item.elapsedMs != null)
    .map(item => item.elapsedMs);
  const tps = capture.cases
    .filter(item => item.state === 'WARM' && !item.clientTimedOut && item.tokensPerSecond != null)
    .map(item => item.tokensPerSecond);

  return {
    schema: 'OLLITERT_CAPTURE_SCORE_V1',
    observedAt: capture.observedAt,
    model: typeof capture.model === 'string' ? capture.model : null,
    total: scored.length,
    schemaValid: scored.filter(item => item.schemaValid).length,
    intentExact: scored.filter(item => item.intentExact).length,
    fieldsExact: scored.filter(item => item.fieldsExact).length,
    clarificationExact: scored.filter(item => item.clarificationExact).length,
    exactMatch: scored.filter(item => item.exactMatch).length,
    clientTimeouts: timedOut.length,
    serverCompletedAfterClientTimeout: timedOut.filter(item => item.serverCompleted === true).length,
    serverOutcomeUnknownAfterClientTimeout: timedOut.filter(item => item.serverCompleted === null).length,
    coldElapsedMs: summarize(elapsed('COLD')),
    warmElapsedMs: summarize(elapsed('WARM')),
    warmTokensPerSecond: summarize(tps),
    cases: scored,
    qualification: 'NOT_SET',
  };
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node scripts/evaluate-local-ai-capture.mjs <capture.json>');
    process.exitCode = 2;
    return;
  }
  try {
    const capture = JSON.parse(await readFile(path, 'utf8'));
    console.log(JSON.stringify(scoreLocalAiCapture(capture), null, 2));
  } catch (error) {
    console.error(error?.message === 'LOCAL_AI_CAPTURE_INVALID' ||
      error?.message === 'LOCAL_AI_CAPTURE_CASE_INVALID'
      ? error.message
      : 'LOCAL_AI_CAPTURE_READ_OR_PARSE_FAILED');
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();