import { GreenhouseEventError } from './events.mjs';

// GO owns writes to these tables. Select only submission metadata: no brief,
// messages, customer identity, generated Work pointer, or delivery content.
const SELECT = `SELECT e.event_id, e.request_id, e.timestamp
 FROM ygg_request_events e JOIN ygg_requests r ON r.request_id=e.request_id
 WHERE e.kind='STATUS' AND e.from_value='DRAFT' AND e.to_value='SUBMITTED'
 AND e.actor_type='CUSTOMER' AND e.actor_id=r.owner_hash`;
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const reference = id => 'ygg_request_events:' + id;

/** Local evidence adapter for the existing sink/reader injection contracts.
 * No second event ledger and no write access: the owner's submission transaction
 * must already have persisted the source event. This is NOT a Hub transport.
 */
export function createRequestEventReadback({ db, source, evidenceScope, authorize, now = Date.now } = {}) {
  if (!db?.prepare || !/^[a-z][a-z0-9-]{1,62}$/.test(source || '') ||
      evidenceScope !== 'LOCAL_TEST' || typeof authorize !== 'function') {
    throw new GreenhouseEventError('REQUEST_ADAPTER_CONFIG_INVALID', 500);
  }
  const project = row => {
    if (!opaque(row?.event_id) || !opaque(row?.request_id) || typeof row.timestamp !== 'string' || !Number.isFinite(Date.parse(row.timestamp))) {
      throw new GreenhouseEventError('REQUEST_SOURCE_INVALID', 502);
    }
    return {
      title: 'Request submitted', ownerSource: source, sourceEventId: row.event_id,
      correlationId: row.request_id, category: 'REQUEST_SUBMITTED',
      occurredAt: row.timestamp, persistedAt: row.timestamp, observedAt: row.timestamp,
      confidence: 'LOCAL_EVIDENCE', freshness: 'UNKNOWN', evidence: [reference(row.event_id)],
      evidenceScope: 'LOCAL_TEST', receiptId: null, receiptStatus: 'MISSING',
    };
  };
  return {
    async hubEventSink({ event, idempotencyKey }) {
      // Envelopes have been authenticated by the HTTP boundary. Independently
      // match every provenance claim to owner storage; a signature is not proof
      // that a request exists or that a Work/Checkpoint was authorized.
      if (event?.source !== source || event.eventType !== 'request.submitted' ||
          !opaque(event.eventId) || !opaque(event.correlationId) ||
          idempotencyKey !== source + ':' + event.eventId ||
          event.payloadRef !== reference(event.eventId) || event.classification !== 'INTERNAL' ||
          event.workId != null || event.checkpointId != null) {
        throw new GreenhouseEventError('REQUEST_PROVENANCE_MISMATCH', 409);
      }
      const row = await db.prepare(SELECT + ' AND e.event_id=?').bind(event.eventId).first();
      if (!row || row.request_id !== event.correlationId || row.timestamp !== event.occurredAt) {
        throw new GreenhouseEventError('REQUEST_PROVENANCE_MISMATCH', 409);
      }
      const item = project(row);
      // Already persisted by the producer, including the first notification.
      // duplicate describes source-event persistence, not delivery accounting.
      return { duplicate: true, persisted: true, evidenceScope: 'LOCAL_TEST',
        receiptId: null, receiptStatus: 'MISSING', sourceEventId: item.sourceEventId,
        persistedAt: item.persistedAt, evidence: item.evidence };
    },
    async inboxReader({ session, cursor }) {
      if (await authorize(session) !== true) throw new GreenhouseEventError('REQUEST_READ_DENIED', 403);
      if (cursor != null && (typeof cursor !== 'string' || !/^\d{1,7}$/.test(cursor))) throw new GreenhouseEventError('CURSOR_INVALID', 400);
      const offset = Number(cursor || 0);
      const result = await db.prepare(SELECT + ' ORDER BY e.timestamp DESC,e.event_id DESC LIMIT 101 OFFSET ?').bind(offset).all();
      return {items: result.results.slice(0,100).map(project), observedAt: new Date(now()).toISOString(),
        nextCursor: result.results.length > 100 ? String(offset + 100) : null};
    },
  };
}
