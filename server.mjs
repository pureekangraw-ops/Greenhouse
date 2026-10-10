import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readMetropolisWork, MetropolisReadError } from './src/hub/metropolis-read.mjs';
import { GreenhouseEventError, parseSourceRegistry, validateSignedGreenhouseEvent } from './src/greenhouse/events.mjs';
import { projectOperations } from './src/greenhouse/state-intelligence.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/greenhouse/', ['greenhouse/index.html', 'text/html; charset=utf-8']],
  ['/greenhouse/index.html', ['greenhouse/index.html', 'text/html; charset=utf-8']],
  ['/greenhouse/app.js', ['greenhouse/app.js', 'text/javascript; charset=utf-8']],
  ['/greenhouse/ui-state.mjs', ['greenhouse/ui-state.mjs', 'text/javascript; charset=utf-8']],
  ['/greenhouse/app.css', ['greenhouse/app.css', 'text/css; charset=utf-8']],
  ['/greenhouse/manifest.webmanifest', ['greenhouse/manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/greenhouse/icon.svg', ['greenhouse/icon.svg', 'image/svg+xml; charset=utf-8']],
  ['/greenhouse/sw.js', ['greenhouse/sw.js', 'text/javascript; charset=utf-8']],
]);
const commonHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'",
};
function send(response, code, data, contentType = 'application/json; charset=utf-8') {
  response.writeHead(code, { ...commonHeaders, 'content-type': contentType });
  response.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function validOrigin(request) {
  const host = request.headers.host;
  // Reject DNS-rebinding hosts, including requests with no Origin header.
  if (!/^127\.0\.0\.1:\d+$/.test(host || '')) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === 'http://' + host;
}
async function readRequestBody(request, maxBytes = 65_536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new GreenhouseEventError('REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function sanitizeInboxResult(result) {
  if (!result || !Array.isArray(result.items) || result.items.length > 100 ||
      typeof result.observedAt !== 'string' || !Number.isFinite(Date.parse(result.observedAt)) ||
      (result.nextCursor != null && (typeof result.nextCursor !== 'string' || result.nextCursor.length > 512))) return null;
  const fields = ['title', 'ownerSource', 'confidence', 'observedAt', 'freshness', 'workId'];
  const items = [];
  for (const item of result.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const safe = {};
    for (const field of fields) {
      if (item[field] != null) {
        if (typeof item[field] !== 'string' || item[field].length > 512) return null;
        safe[field] = item[field];
      }
    }
    items.push(safe);
  }
  return { items, observedAt: result.observedAt, nextCursor: result.nextCursor ?? null };
}
function parseCommand(raw, session, allowedTargets, highImpactTargets) {
  let command;
  try { command = JSON.parse(raw); }
  catch { throw new GreenhouseEventError('COMMAND_JSON_INVALID', 400); }
  const opaque = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  if (!command || typeof command !== 'object' || Array.isArray(command) ||
      command.schemaVersion !== 'greenhouse.command.v1' || !opaque(command.commandId) ||
      !opaque(command.idempotencyKey) || !allowedTargets.has(command.target) ||
      typeof command.workId !== 'string' || !/^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(command.workId) ||
      typeof command.checkpointId !== 'string' || command.checkpointId.length > 160 ||
      !command.checkpointId.startsWith(command.workId + ':CP-') ||
      typeof command.intent !== 'string' || command.intent.trim().length < 8 || command.intent.length > 500 ||
      !Number.isFinite(Date.parse(command.requestedAt)) ||
      (command.expectedVersion != null && !opaque(command.expectedVersion)) ||
      (command.checkpointId.trim().length === 0) ||
      (highImpactTargets.has(command.target) && command.ownerConfirmed !== true) ||
      Object.keys(command).some(key => !new Set(['schemaVersion','commandId','idempotencyKey','target','workId','checkpointId','intent','requestedAt','expectedVersion','ownerConfirmed']).has(key))) {
    throw new GreenhouseEventError('COMMAND_SCHEMA_INVALID', 400);
  }
  return Object.freeze({ ...command, actor: session.actorId });
}

/**
 * Local-only preview. Auth, inbox, event sink, and command handlers are explicit
 * injected owner/Hub boundaries; absent integrations fail closed and store no data.
 */
export function createGreenhouseServer({
  token = '', fetchImpl = fetch, now = Date.now, sourceRegistry = {},
  hubEventSink = null, ownerSessionResolver = null, inboxReader = null, operationsReader = null,
  commandAuthorizer = null, hubCommandSubmitter = null,
  allowedCommandTargets = [], highImpactCommandTargets = [],
} = {}) {
  if (!Array.isArray(allowedCommandTargets) || !Array.isArray(highImpactCommandTargets) ||
      allowedCommandTargets.some(target => typeof target !== 'string' || !target.trim()) ||
      highImpactCommandTargets.some(target => !allowedCommandTargets.includes(target))) {
    throw new Error('COMMAND_POLICY_INVALID');
  }
  const commandTargets = new Set(allowedCommandTargets);
  const highImpactTargets = new Set(highImpactCommandTargets);
  return createServer(async (request, response) => {
    if (!validOrigin(request)) return send(response, 403, { code: 'ORIGIN_DENIED' });
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/api/greenhouse/status' && request.method === 'GET') {
      // Adapter presence is not authentication: never advertise an owner session
      // until the existing session resolver has verified this request.
      let ownerSession = false;
      if (ownerSessionResolver) {
        try {
          const session = await ownerSessionResolver(request);
          ownerSession = typeof session?.actorId === 'string' && session.actorId.trim().length > 0;
        } catch {
          ownerSession = false;
        }
      }
      return send(response, 200, {
        ownerSession,
        inboxReader: Boolean(inboxReader),
        eventIngress: Boolean(Object.keys(sourceRegistry).length && hubEventSink),
        remoteCommands: Boolean(ownerSession && commandAuthorizer && hubCommandSubmitter && commandTargets.size),
        privateDataCached: false,
      });
    }
    if (url.pathname === '/api/greenhouse/operations') {
      if (request.method !== 'GET') return send(response, 405, { code: 'READ_ONLY' });
      if (!ownerSessionResolver || !operationsReader) return send(response, 503, { code: 'OPERATIONS_READER_UNAVAILABLE' });
      if ([...url.searchParams.keys()].some(k => k !== 'workId') ||
        url.searchParams.getAll('workId').length > 1) return send(response, 400, { code: 'WORK_ID_INVALID' });
      const workId = url.searchParams.get('workId') || null;
      if (workId && !/^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(workId))
        return send(response, 400, { code: 'WORK_ID_INVALID' });
      let session;
      try { session = await ownerSessionResolver(request); }
      catch { return send(response, 401, { code: 'OWNER_SESSION_REQUIRED' }); }
      if (typeof session?.actorId !== 'string' || !session.actorId.trim())
        return send(response, 401, { code: 'OWNER_SESSION_REQUIRED' });
      try {
        const events = await operationsReader({ session, workId });
        if (!Array.isArray(events) || events.length > 2000)
          return send(response, 502, { code: 'OPERATION_JOURNAL_INVALID' });
        const result = projectOperations(events, { now: new Date(now()).toISOString() });
        return send(response, 200, { observedAt: result.observedAt,
          counts: result.counts, items: result.items.slice(0, 50) });
      } catch {
        return send(response, 502, { code: 'OPERATION_JOURNAL_UNVERIFIED' });
      }
    }
    if (url.pathname === '/api/greenhouse/inbox') {
      if (request.method !== 'GET') return send(response, 405, { code: 'READ_ONLY' });
      if (!ownerSessionResolver || !inboxReader) return send(response, 503, { code: 'HUB_READER_UNAVAILABLE' });
      try {
        const session = await ownerSessionResolver(request);
        if (typeof session?.actorId !== 'string' || !session.actorId.trim()) return send(response, 401, { code: 'OWNER_SESSION_REQUIRED' });
        if ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1 || (url.searchParams.get('cursor') || '').length > 512) {
          return send(response, 400, { code: 'CURSOR_INVALID' });
        }
        const result = await inboxReader({ session, cursor: url.searchParams.get('cursor') || null });
        const safeResult = sanitizeInboxResult(result);
        if (!safeResult) return send(response, 502, { code: 'HUB_READBACK_INVALID' });
        return send(response, 200, safeResult);
      } catch {
        return send(response, 502, { code: 'HUB_READBACK_FAILED' });
      }
    }
    if (url.pathname === '/api/greenhouse/events') {
      if (request.method !== 'POST') return send(response, 405, { code: 'METHOD_NOT_ALLOWED' });
      let event;
      try {
        const rawBody = await readRequestBody(request);
        event = validateSignedGreenhouseEvent({
          rawBody,
          timestamp: request.headers['x-greenhouse-timestamp'],
          signature: request.headers['x-greenhouse-signature'],
          sourceRegistry,
          now: now(),
        });
      } catch (error) {
        const known = error instanceof GreenhouseEventError;
        return send(response, known ? error.status : 400, { code: known ? error.code : 'EVENT_REJECTED' });
      }
      if (!hubEventSink) return send(response, 503, { code: 'HUB_EVENT_SINK_UNAVAILABLE' });
      try {
        const receipt = await hubEventSink({
          event,
          idempotencyKey: event.source + ':' + event.eventId,
        });
        if (!receipt || typeof receipt.receiptId !== 'string' || !receipt.receiptId.trim() || typeof receipt.duplicate !== 'boolean') {
          return send(response, 502, { code: 'HUB_RECEIPT_INVALID' });
        }
        return send(response, receipt.duplicate ? 200 : 202, {
          receiptId: receipt.receiptId,
          duplicate: receipt.duplicate,
          receivedAt: event.receivedAt,
          execution: 'NOT_ASSERTED',
        });
      } catch {
        return send(response, 502, { code: 'HUB_EVENT_DELIVERY_FAILED' });
      }
    }
    if (url.pathname === '/api/greenhouse/commands') {
      if (request.method !== 'POST') return send(response, 405, { code: 'METHOD_NOT_ALLOWED' });
      if (request.headers.origin !== 'http://' + request.headers.host) return send(response, 403, { code: 'CSRF_ORIGIN_REQUIRED' });
      if (!ownerSessionResolver) return send(response, 503, { code: 'OWNER_SESSION_UNAVAILABLE' });
      if (!commandAuthorizer || !hubCommandSubmitter || commandTargets.size === 0) return send(response, 503, { code: 'HUB_COMMAND_INTERFACE_UNAVAILABLE' });
      let session;
      try { session = await ownerSessionResolver(request); }
      catch { return send(response, 401, { code: 'OWNER_SESSION_REQUIRED' }); }
      if (typeof session?.actorId !== 'string' || !session.actorId.trim()) return send(response, 401, { code: 'OWNER_SESSION_REQUIRED' });
      const csrf = request.headers['x-csrf-token'];
      if (typeof session.csrfToken !== 'string' || typeof csrf !== 'string' || csrf !== session.csrfToken) {
        return send(response, 403, { code: 'CSRF_TOKEN_INVALID' });
      }
      let command;
      try { command = parseCommand(await readRequestBody(request, 16_384), session, commandTargets, highImpactTargets); }
      catch (error) {
        const known = error instanceof GreenhouseEventError;
        return send(response, known ? error.status : 400, { code: known ? error.code : 'COMMAND_REJECTED' });
      }
      try {
        const authorization = await commandAuthorizer({ command, session, request });
        if (!authorization || authorization.authorized !== true || authorization.actorId !== session.actorId ||
            authorization.target !== command.target || authorization.workId !== command.workId ||
            authorization.checkpointId !== command.checkpointId) {
          return send(response, 403, { code: 'COMMAND_NOT_AUTHORIZED' });
        }
        const receipt = await hubCommandSubmitter({ command, session, authorization });
        if (!receipt || typeof receipt.receiptId !== 'string' || !receipt.receiptId.trim() ||
            (receipt.state != null && !['ACCEPTED', 'REJECTED', 'UNKNOWN'].includes(receipt.state))) {
          return send(response, 502, { code: 'HUB_RECEIPT_INVALID' });
        }
        // A Hub receipt is transport evidence only, not an execution result.
        return send(response, 202, { receiptId: receipt.receiptId, state: receipt.state || 'UNKNOWN', execution: 'NOT_ASSERTED' });
      } catch {
        return send(response, 502, { code: 'HUB_COMMAND_DELIVERY_FAILED' });
      }
    }
    if (request.method !== 'GET') return send(response, 405, { code: 'READ_ONLY' });
    if (url.pathname === '/api/office/work') {
      if ([...url.searchParams.keys()].some(key => key !== 'workId') || url.searchParams.getAll('workId').length !== 1) {
        return send(response, 400, { code: 'WORK_ID_INVALID' });
      }
      try {
        // Prefer the existing verified owner session; never accept a token from the browser.
        let workToken = token;
        if (ownerSessionResolver) {
          const session = await ownerSessionResolver(request);
          if (typeof session?.actorId !== 'string' || !session.actorId.trim() ||
              typeof session?.accessToken !== 'string' || !session.accessToken) {
            return send(response, 401, { code: 'OWNER_SESSION_REQUIRED' });
          }
          workToken = session.accessToken;
        }
        if (!workToken) return send(response, 401, { code: 'OWNER_SESSION_REQUIRED' });
        const report = await readMetropolisWork({ workId: url.searchParams.get('workId'), token: workToken, fetchImpl, now });
        return send(response, 200, { source: 'METROPOLIS_OWNER_READBACK', report });
      } catch (error) {
        const known = error instanceof MetropolisReadError;
        return send(response, known ? error.status : 502, { code: known ? error.code : 'OWNER_READ_FAILED' });
      }
    }
    const item = staticFiles.get(url.pathname);
    if (!item) return send(response, 404, { code: 'NOT_FOUND' });
    try {
      const content = await readFile(join(root, item[0]), 'utf8');
      return send(response, 200, content, item[1]);
    } catch {
      return send(response, 503, { code: 'STATIC_ASSET_UNAVAILABLE' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const host = '127.0.0.1';
  const port = Number(process.env.PORT || '4173');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('PORT_INVALID');
  const sourceRegistry = parseSourceRegistry(process.env.GREENHOUSE_SOURCES_JSON || '');
  const server = createGreenhouseServer({ token: process.env.METROPOLIS_ACCESS_TOKEN || '', sourceRegistry });
  server.listen(port, host, () => {
    console.log('Greenhouse preview: http://' + host + ':' + port);
    console.log(process.env.METROPOLIS_ACCESS_TOKEN ? 'Metropolis adapter configured' : 'Metropolis adapter not configured; static/mock only');
    console.log('Greenhouse Hub session, inbox, event sink and command interfaces remain unavailable until owner-authorized adapters are provided.');
  });
}
