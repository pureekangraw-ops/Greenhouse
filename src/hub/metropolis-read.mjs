import { randomUUID } from 'node:crypto';

const DEFAULT_ENDPOINT = 'https://metropolis.pureekangraw.workers.dev/mcp';
const WORK_ID = /^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const MAX_AGE_MS = 60_000;

export class MetropolisReadError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'MetropolisReadError';
    this.code = code;
    this.status = status;
  }
}

const text = value => typeof value === 'string' ? value.trim() : '';
function refsOf(record) {
  const all = [];
  for (const journey of Array.isArray(record.journeys) ? record.journeys : []) {
    const refs = journey?.baggageOut;
    for (const key of ['evidenceRefs', 'receiptRefs']) {
      if (Array.isArray(refs?.[key])) all.push(...refs[key]);
    }
  }
  if (Array.isArray(record.return?.evidenceRefs)) all.push(...record.return.evidenceRefs);
  return [...new Set(all.filter(item => text(item) && item.length <= 512))].slice(-8);
}

function reportFromReadback({ workId, data, now }) {
  if (!data || data.isError === true || !data.structuredContent) {
    throw new MetropolisReadError('OWNER_READ_REJECTED', 403);
  }
  const read = data.structuredContent;
  // User identity is not supplied by a Work ID or an HTTP request body.
  const delegation = read.delegatedAccess;
  if (delegation?.owner !== 'BIG' || delegation?.actingAgent !== 'GO' ||
      delegation?.authority !== 'OWNER_DELEGATED' || read.actor !== 'GO') {
    throw new MetropolisReadError('OWNER_DELEGATION_REQUIRED', 403);
  }
  const record = read.record;
  if (read.readbackVerified !== true || !record ||
      record.workId !== workId || !text(record.checkpointId) ||
      !text(record.ownerSystem) || !text(record.state)) {
    throw new MetropolisReadError('OWNER_READBACK_MISMATCH', 409);
  }
  const observedAt = new Date(now).toISOString();
  const lastUpdated = Date.parse(record.updatedAt);
  const age = now - lastUpdated;
  const freshness = Number.isFinite(age) && age >= 0
    ? age <= MAX_AGE_MS ? 'CURRENT' : 'STALE'
    : 'UNKNOWN';
  const evidence = refsOf(record);
  const receiptId = evidence.find(item => item.startsWith('receipt://') || item.startsWith('receipt-')) || null;
  const workStatus = record.state === 'BLOCKED' ? 'BLOCKED'
    : ['WAITING','RETURN_REVIEW','WAIT'].includes(record.state) ? 'WAITING' : null;
  const limitations = [
    'Metropolis City Hall readback only; owner-system execution is not independently verified',
    ...(freshness !== 'CURRENT' ? ['Work state has no current owner update within 60 seconds'] : []),
    ...(!evidence.length ? ['No external evidence reference present in the Work record'] : []),
  ];
  return {
    reportId: 'RPT-' + randomUUID(),
    requestedBy: 'OFFICE',
    observedAt,
    workId: record.workId,
    ownerSource: 'Metropolis City Hall / ' + record.ownerSystem,
    freshness,
    workStatus,
    confidence: evidence.length ? 'CONFIRMED' : 'UNKNOWN',
    evidence,
    nextAction: freshness !== 'CURRENT'
      ? 'Request an updated owner-source readback for this Work'
      : workStatus === 'WAITING' ? 'Review the pending Work at its owner station'
        : 'Review the Work state with its owning system',
    limitations,
    receiptId,
  };
}

/**
 * Read-only owner adapter. Only a server-provided OAuth token is accepted.
 * Never trust caller-provided owner, actor, permissions, or fabricated Work state.
 */
export async function readMetropolisWork({
  workId, token, fetchImpl = fetch, now = Date.now,
  endpoint = DEFAULT_ENDPOINT, timeoutMs = 8000,
} = {}) {
  if (typeof workId !== 'string' || !WORK_ID.test(workId)) {
    throw new MetropolisReadError('WORK_ID_INVALID', 400);
  }
  if (!text(token)) throw new MetropolisReadError('OWNER_CONNECTION_REQUIRED', 503);
  if (endpoint !== DEFAULT_ENDPOINT) throw new MetropolisReadError('ENDPOINT_NOT_ALLOWED', 400);
  const clock = now();
  if (!Number.isSafeInteger(clock) || clock < 0 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) {
    throw new MetropolisReadError('ADAPTER_CONFIG_INVALID', 500);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: randomUUID(), method: 'tools/call',
        params: { name: 'metropolis_work', arguments: { action: 'read', workId } },
      }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (response.status === 401 || response.status === 403) throw new MetropolisReadError('OWNER_AUTH_REQUIRED', 401);
    if (!response.ok) throw new MetropolisReadError('METROPOLIS_UNAVAILABLE', 502);
    const raw = await response.text();
    if (raw.length > 512_000) throw new MetropolisReadError('OWNER_RESPONSE_TOO_LARGE', 502);
    let json;
    try { json = JSON.parse(raw); }
    catch { throw new MetropolisReadError('OWNER_RESPONSE_INVALID', 502); }
    if (json.jsonrpc !== '2.0' || json.error || !json.result) throw new MetropolisReadError('OWNER_RESPONSE_INVALID', 502);
    return reportFromReadback({ workId, data: json.result, now: clock });
  } catch (error) {
    if (error instanceof MetropolisReadError) throw error;
    throw new MetropolisReadError('METROPOLIS_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timeout);
  }
}
