import { randomUUID } from 'node:crypto';

const DEFAULT_ENDPOINT = 'https://metropolis.pureekangraw.workers.dev/mcp';
const WORK_ID = /^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const MAX_ARRIVAL_AGE_MS = 60_000;
const MAX_RESPONSE_BYTES = 512_000;
const text = value => typeof value === 'string' ? value.trim() : '';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class MetropolisReadError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'MetropolisReadError';
    this.code = code;
    this.status = status;
  }
}

function unpackResult(body) {
  if (!object(body) || body.jsonrpc !== '2.0' || body.error || !object(body.result)) {
    throw new MetropolisReadError('OWNER_RESPONSE_INVALID', 502);
  }
  const result = body.result;
  if (result.isError === true) throw new MetropolisReadError('OWNER_READ_REJECTED', 403);
  if (object(result.structuredContent)) return result.structuredContent;
  const encoded = Array.isArray(result.content)
    ? result.content.find(item => item?.type === 'text' && typeof item.text === 'string')?.text
    : null;
  if (!encoded) throw new MetropolisReadError('OWNER_RESPONSE_INVALID', 502);
  try {
    const decoded = JSON.parse(encoded);
    if (object(decoded)) return decoded;
  } catch { /* malformed MCP content fails closed */ }
  throw new MetropolisReadError('OWNER_RESPONSE_INVALID', 502);
}

function evidenceOf(record) {
  const refs = [];
  for (const journey of Array.isArray(record.journeys) ? record.journeys : []) {
    const baggage = journey?.baggageOut;
    for (const key of ['evidenceRefs', 'receiptRefs']) {
      if (Array.isArray(baggage?.[key])) refs.push(...baggage[key]);
    }
  }
  for (const entry of Array.isArray(record.dataLifecycle) ? record.dataLifecycle : []) {
    if (Array.isArray(entry?.evidenceRefs)) refs.push(...entry.evidenceRefs);
  }
  if (Array.isArray(record.return?.evidenceRefs)) refs.push(...record.return.evidenceRefs);
  return [...new Set(refs.filter(item => text(item) && item.length <= 512))].slice(-16);
}

function verifyArrival(arrival, workId, now) {
  if (!['GO', 'LIGHT'].includes(arrival?.actor) ||
      !Number.isFinite(Date.parse(arrival.observedAt)) ||
      Math.abs(now - Date.parse(arrival.observedAt)) > MAX_ARRIVAL_AGE_MS) {
    throw new MetropolisReadError('ARRIVAL_UNVERIFIED', 409);
  }
  const works = arrival.current?.works;
  const pointer = Array.isArray(works) ? works.find(item => item?.workId === workId) : null;
  if (!pointer || pointer.present !== true || !text(pointer.checkpointId) ||
      !text(pointer.ownerSystem) || !Array.isArray(pointer.authorizedActions) ||
      !pointer.authorizedActions.includes('read')) {
    throw new MetropolisReadError('WORK_NOT_GRANTED', 403);
  }
  return pointer;
}

function reportFromReadback({ workId, actor, pointer, reply, now }) {
  const record = reply?.record;
  const receipt = reply?.receipt;
  const pass = record?.workPass;
  if (reply?.actor !== actor || reply.readbackVerified !== true ||
      reply.ownerExecutionVerified !== false || reply.workTruthChanged !== false ||
      !object(record) || record.workId !== workId ||
      record.checkpointId !== pointer.checkpointId ||
      record.ownerSystem !== pointer.ownerSystem || !text(record.state) ||
      pass?.status !== 'ACTIVE' || pass.workId !== workId ||
      pass.checkpointId !== pointer.checkpointId ||
      !Array.isArray(pass.permissions?.actions) || !pass.permissions.actions.includes('read') ||
      receipt?.operation !== 'READ_WORK' || receipt.workId !== workId ||
      receipt.checkpointId !== pointer.checkpointId || receipt.readbackVerified !== true ||
      receipt.persisted !== false || !Number.isFinite(Date.parse(receipt.observedAt))) {
    throw new MetropolisReadError('OWNER_READBACK_MISMATCH', 409);
  }
  const observedMs = Date.parse(receipt.observedAt);
  const readAge = now - observedMs;
  const freshness = Number.isFinite(readAge) && readAge >= 0
    ? readAge <= MAX_ARRIVAL_AGE_MS ? 'CURRENT' : 'STALE'
    : 'UNKNOWN';
  const lastUpdated = Date.parse(record.updatedAt);
  const evidence = evidenceOf(record);
  const workStatus = record.state === 'BLOCKED' ? 'BLOCKED'
    : ['WAITING', 'RETURN_REVIEW', 'WAIT'].includes(record.state) ? 'WAITING' : null;
  const limitations = [
    'Verified City Hall Work readback only; owner-system execution is not independently verified',
    'Work updatedAt is a lifecycle timestamp, not an Owner System observation',
    ...(!evidence.length ? ['No external evidence reference is present in the Work record'] : []),
    ...(freshness !== 'CURRENT' ? ['The readback receipt is not within the current 60-second freshness window'] : []),
  ];
  return {
    reportId: 'RPT-' + randomUUID(),
    requestedBy: 'GREENHOUSE',
    observedAt: receipt.observedAt,
    workId: record.workId,
    checkpointId: record.checkpointId,
    ownerState: record.state,
    sourceUpdatedAt: Number.isFinite(lastUpdated) ? new Date(lastUpdated).toISOString() : null,
    ownerSource: 'Metropolis City Hall / ' + record.ownerSystem,
    actor,
    freshness,
    workStatus,
    confidence: 'CONFIRMED',
    evidence,
    nextAction: freshness !== 'CURRENT'
      ? 'Request a fresh readback of this exact Work from its existing authorized station'
      : 'Treat this as Work lifecycle state only; verify any operational result with its owner system',
    limitations,
    receiptId: null,
    ownerExecutionVerified: false,
  };
}

/**
 * Read-only adapter for the existing Metropolis MCP entry. The bearer token is
 * supplied only by the server-side OAuth/session provider; browser credentials
 * and caller-supplied identity/permissions are never accepted.
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
  let requestId = 0;
  const callTool = async (name, args) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token.trim(),
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: ++requestId, method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      throw new MetropolisReadError('OWNER_AUTH_REQUIRED', 401);
    }
    if (!response.ok) throw new MetropolisReadError('METROPOLIS_UNAVAILABLE', 502);
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new MetropolisReadError('OWNER_RESPONSE_TOO_LARGE', 502);
    let body;
    try { body = JSON.parse(raw); }
    catch { throw new MetropolisReadError('OWNER_RESPONSE_INVALID', 502); }
    return unpackResult(body);
  };

  try {
    const arrival = await callTool('metropolis_arrive', {});
    const pointer = verifyArrival(arrival, workId, clock);
    const reply = await callTool('metropolis_work', { action: 'read', workId });
    return reportFromReadback({ workId, actor: arrival.actor, pointer, reply, now: clock });
  } catch (error) {
    if (error instanceof MetropolisReadError) throw error;
    throw new MetropolisReadError('METROPOLIS_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timeout);
  }
}
