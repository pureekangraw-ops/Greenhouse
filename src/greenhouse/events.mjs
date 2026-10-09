import { createHmac, timingSafeEqual } from 'node:crypto';

const SOURCE = /^[a-z][a-z0-9-]{1,62}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORK_ID = /^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const CLASSIFICATIONS = new Set(['PUBLIC', 'INTERNAL', 'RESTRICTED']);
const ALLOWED_KEYS = new Set([
  'schemaVersion', 'eventId', 'source', 'eventType', 'occurredAt',
  'correlationId', 'workId', 'checkpointId', 'payloadRef', 'classification',
]);

export class GreenhouseEventError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'GreenhouseEventError';
    this.code = code;
    this.status = status;
  }
}

export function parseSourceRegistry(json = '') {
  if (!json) return Object.freeze({});
  let sourceMap;
  try { sourceMap = JSON.parse(json); }
  catch { throw new GreenhouseEventError('SOURCE_REGISTRY_INVALID', 500); }
  if (!sourceMap || typeof sourceMap !== 'object' || Array.isArray(sourceMap)) {
    throw new GreenhouseEventError('SOURCE_REGISTRY_INVALID', 500);
  }
  for (const [source, config] of Object.entries(sourceMap)) {
    if (!SOURCE.test(source) || !config || typeof config !== 'object' ||
        typeof config.secret !== 'string' || Buffer.byteLength(config.secret) < 32 ||
        !Array.isArray(config.eventTypes) || config.eventTypes.length === 0 ||
        config.eventTypes.some(item => typeof item !== 'string' || !OPAQUE_ID.test(item))) {
      throw new GreenhouseEventError('SOURCE_REGISTRY_INVALID', 500);
    }
  }
  return Object.freeze(sourceMap);
}

export function signGreenhouseEvent(rawBody, timestamp, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(timestamp + '.').update(rawBody).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateSignedGreenhouseEvent({ rawBody, timestamp, signature, sourceRegistry, now = Date.now(), maxSkewMs = 300_000 }) {
  if (typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp) ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(maxSkewMs) || maxSkewMs < 1) {
    throw new GreenhouseEventError('EVENT_SIGNATURE_INVALID', 401);
  }
  const timeMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (Math.abs(now - timeMs) > maxSkewMs) throw new GreenhouseEventError('EVENT_TIMESTAMP_EXPIRED', 401);
  let envelope;
  try { envelope = JSON.parse(rawBody); }
  catch { throw new GreenhouseEventError('EVENT_JSON_INVALID', 400); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      Object.keys(envelope).some(key => !ALLOWED_KEYS.has(key))) {
    throw new GreenhouseEventError('EVENT_SCHEMA_INVALID', 400);
  }
  const config = sourceRegistry?.[envelope.source];
  if (!config) throw new GreenhouseEventError('EVENT_SOURCE_NOT_REGISTERED', 403);
  if (typeof signature !== 'string' || !safeEqual(signature, signGreenhouseEvent(rawBody, timestamp, config.secret))) {
    throw new GreenhouseEventError('EVENT_SIGNATURE_INVALID', 401);
  }
  if (envelope.schemaVersion !== 'greenhouse.event.v1' ||
      !OPAQUE_ID.test(envelope.eventId || '') || !SOURCE.test(envelope.source || '') ||
      typeof envelope.eventType !== 'string' || !config.eventTypes.includes(envelope.eventType) ||
      !Number.isFinite(Date.parse(envelope.occurredAt)) ||
      (envelope.correlationId != null && !OPAQUE_ID.test(envelope.correlationId)) ||
      (envelope.workId != null && !WORK_ID.test(envelope.workId)) ||
      (envelope.checkpointId != null && (typeof envelope.checkpointId !== 'string' || envelope.checkpointId.length > 160)) ||
      (envelope.payloadRef != null && (typeof envelope.payloadRef !== 'string' || envelope.payloadRef.length > 512)) ||
      !CLASSIFICATIONS.has(envelope.classification)) {
    throw new GreenhouseEventError('EVENT_SCHEMA_INVALID', 400);
  }
  if (envelope.classification === 'RESTRICTED' && !envelope.payloadRef) {
    throw new GreenhouseEventError('EVENT_RESTRICTED_REFERENCE_REQUIRED', 400);
  }
  return Object.freeze({ ...envelope, receivedAt: new Date(now).toISOString() });
}
