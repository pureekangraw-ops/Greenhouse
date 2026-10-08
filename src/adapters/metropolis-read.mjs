// Server-side read-only consumer of the existing Metropolis MCP Work System.
// This file neither creates Work nor acts as a source of owner operational truth.
const ALLOWED_TOOLS = new Set(['metropolis_arrive', 'metropolis_work']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const filled = value => typeof value === 'string' && value.trim().length > 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function unpackToolResult(body) {
  if (!isObject(body) || body.jsonrpc !== '2.0' || body.error || !isObject(body.result)) {
    throw new Error('MCP_RPC_UNAVAILABLE');
  }
  const toolResult = body.result;
  if (toolResult.isError === true) throw new Error('MCP_TOOL_REJECTED');
  if (isObject(toolResult.structuredContent)) return toolResult.structuredContent;
  const text = Array.isArray(toolResult.content)
    ? toolResult.content.find(item => item?.type === 'text' && typeof item.text === 'string')?.text
    : null;
  if (!text) throw new Error('MCP_RESULT_UNAVAILABLE');
  try {
    const decoded = JSON.parse(text);
    if (isObject(decoded)) return decoded;
  } catch { /* Invalid MCP content fails closed. */ }
  throw new Error('MCP_RESULT_INVALID');
}

export function createMetropolisMcpClient({
  endpoint, getAccessToken, fetchImpl = globalThis.fetch, timeoutMs = 8000,
} = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('MCP_ENDPOINT_INVALID'); }
  if (url.protocol !== 'https:' || url.pathname !== '/mcp' || url.search ||
    url.hash || url.username || url.password || !url.hostname) {
    throw new Error('MCP_ENDPOINT_INVALID');
  }
  if (typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function' ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('MCP_CLIENT_CONFIG_INVALID');
  }
  let sequence = 0;
  return Object.freeze({
    async callTool(name, args = {}) {
      if (!ALLOWED_TOOLS.has(name) || !isObject(args) ||
        (name === 'metropolis_arrive' && Object.keys(args).length !== 0) ||
        (name === 'metropolis_work' &&
          (Object.keys(args).length !== 2 || args.action !== 'read' ||
            !filled(args.workId) || args.workId.length > 256))) {
        throw new Error('READ_ONLY_TOOL_REQUIRED');
      }
      const token = await getAccessToken();
      if (!filled(token)) throw new Error('MCP_ACCESS_TOKEN_REQUIRED');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.href, {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          headers: {
            'authorization': 'Bearer ' + token.trim(),
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-06-18',
          },
          body: JSON.stringify({
            jsonrpc: '2.0', id: ++sequence, method: 'tools/call',
            params: { name, arguments: args },
          }),
          signal: controller.signal,
        });
        if (!response?.ok || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('MCP_HTTP_UNAVAILABLE');
        }
        const raw = await response.text();
        if (raw.length > 1048576) throw new Error('MCP_RESPONSE_TOO_LARGE');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { throw new Error('MCP_RESPONSE_INVALID'); }
        return unpackToolResult(parsed);
      } catch {
        // Never expose HTTP response bodies, tokens, or OAuth internals to callers.
        throw new Error('METROPOLIS_READ_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

const readEvidence = record => {
  const refs = [
    ...(Array.isArray(record.return?.evidenceRefs) ? record.return.evidenceRefs : []),
    ...(Array.isArray(record.reports) ? record.reports.flatMap(item =>
      Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : []) : []),
  ];
  return [...new Set(refs.filter(filled))].slice(0, 32);
};

function makeResult(workId, observedAt, reason, record = null) {
  const verified = reason === null;
  const refs = verified ? readEvidence(record) : [];
  const limitations = verified
    ? ['Metropolis Work readback only; this does not verify an Owner System operation.',
       'Work updatedAt is a lifecycle timestamp, not an Owner System observation.',
       ...(refs.length ? [] : ['No external evidence references in the returned Work record.'])]
    : ['No verified current Metropolis Work readback; do not use mock or cached values as truth.'];
  const report = {
    reportId: 'GREENHOUSE-READ:' + workId,
    requestedBy: 'GREENHOUSE',
    observedAt,
    workId,
    ownerSource: 'METROPOLIS_WORK_SYSTEM',
    freshness: verified ? 'CURRENT' : 'UNKNOWN',
    workStatus: verified && ['BLOCKED', 'WAITING'].includes(record.state) ? record.state : null,
    confidence: verified ? 'CONFIRMED' : 'UNKNOWN',
    evidence: refs,
    nextAction: verified
      ? 'For operational completion, request separate current readback from ' + record.ownerSystem + '.'
      : 'Recheck authenticated Metropolis arrival, Work grant, and current readback.',
    limitations,
    receiptId: null,
  };
  return Object.freeze({
    report,
    work: verified ? {
      workId: record.workId,
      checkpointId: record.checkpointId,
      ownerSystem: record.ownerSystem,
      lifecycleState: record.state,
      updatedAt: record.updatedAt ?? null,
    } : null,
    verification: { workReadbackVerified: verified, ownerExecutionVerified: false },
    reason,
  });
}

export function createMetropolisReportReader({
  client, clock = Date.now, maxArrivalAgeMs = 60000,
} = {}) {
  if (typeof client?.callTool !== 'function' || typeof clock !== 'function' ||
    !Number.isInteger(maxArrivalAgeMs) || maxArrivalAgeMs < 1000 || maxArrivalAgeMs > 300000) {
    throw new Error('MCP_READER_CONFIG_INVALID');
  }
  return Object.freeze({
    async readWork(workId) {
      if (!filled(workId) || workId.length > 256) throw new Error('WORK_ID_REQUIRED');
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error('CLOCK_INVALID');
      const observedAt = new Date(now).toISOString();
      try {
        // Always resolve current actor, grants, and checkpoint from the City, never from the caller.
        const arrival = await client.callTool('metropolis_arrive', {});
        if (!['GO', 'LIGHT'].includes(arrival?.actor) ||
          !validTime(arrival.observedAt) ||
          Math.abs(now - Date.parse(arrival.observedAt)) > maxArrivalAgeMs) {
          return makeResult(workId, observedAt, 'ARRIVAL_UNVERIFIED');
        }
        const pointers = arrival.current?.works;
        const pointer = Array.isArray(pointers)
          ? pointers.find(item => item?.workId === workId) : null;
        if (!pointer || pointer.present !== true || !filled(pointer.checkpointId) ||
          !filled(pointer.ownerSystem) || !Array.isArray(pointer.authorizedActions) ||
          !pointer.authorizedActions.includes('read')) {
          return makeResult(workId, observedAt, 'WORK_NOT_GRANTED');
        }
        const reply = await client.callTool('metropolis_work', { action: 'read', workId });
        const record = reply?.record;
        if (reply?.actor !== arrival.actor || reply.readbackVerified !== true ||
          !isObject(record) || record.workId !== workId ||
          record.checkpointId !== pointer.checkpointId ||
          record.ownerSystem !== pointer.ownerSystem || !filled(record.state)) {
          return makeResult(workId, observedAt, 'WORK_READBACK_MISMATCH');
        }
        return makeResult(workId, new Date(clock()).toISOString(), null, record);
      } catch {
        return makeResult(workId, observedAt, 'METROPOLIS_UNAVAILABLE');
      }
    },
  });
}
