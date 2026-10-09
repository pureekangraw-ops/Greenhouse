import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceRegistry, signGreenhouseEvent, validateSignedGreenhouseEvent } from '../src/greenhouse/events.mjs';

const secret = 'test-secret-that-is-at-least-32-bytes-long';
const now = Date.parse('2026-10-09T05:00:00.000Z');
const timestamp = String(now);
const sourceRegistry = parseSourceRegistry(JSON.stringify({ shop: { secret, eventTypes: ['product.updated'] } }));
const base = {
  schemaVersion: 'greenhouse.event.v1', eventId: 'evt_001', source: 'shop',
  eventType: 'product.updated', occurredAt: new Date(now - 1000).toISOString(),
  correlationId: 'corr-01', workId: null, checkpointId: null,
  payloadRef: null, classification: 'INTERNAL',
};
const signed = envelope => {
  const rawBody = JSON.stringify(envelope);
  return { rawBody, timestamp, signature: signGreenhouseEvent(rawBody, timestamp, secret), sourceRegistry, now };
};

test('source registry rejects malformed and weak credentials', () => {
  assert.deepEqual(parseSourceRegistry(''), {});
  assert.throws(() => parseSourceRegistry('{'), { code: 'SOURCE_REGISTRY_INVALID' });
  assert.throws(() => parseSourceRegistry(JSON.stringify({ shop: { secret: 'short', eventTypes: ['ok'] } })), { code: 'SOURCE_REGISTRY_INVALID' });
});
test('accepts allowlisted signed event and assigns server receive time', () => {
  const event = validateSignedGreenhouseEvent(signed(base));
  assert.equal(event.eventId, base.eventId);
  assert.equal(event.source, 'shop');
  assert.equal(event.receivedAt, new Date(now).toISOString());
});
test('rejects tampered, expired, unregistered, unallowlisted, malformed, and body-bearing events', () => {
  const good = signed(base);
  assert.throws(() => validateSignedGreenhouseEvent({ ...good, signature: 'sha256=' + '0'.repeat(64) }), { code: 'EVENT_SIGNATURE_INVALID' });
  assert.throws(() => validateSignedGreenhouseEvent({ ...good, timestamp: String(now - 600_000) }), { code: 'EVENT_TIMESTAMP_EXPIRED' });
  assert.throws(() => validateSignedGreenhouseEvent(signed({ ...base, source: 'other' })), { code: 'EVENT_SOURCE_NOT_REGISTERED' });
  assert.throws(() => validateSignedGreenhouseEvent(signed({ ...base, eventType: 'not.allowed' })), { code: 'EVENT_SCHEMA_INVALID' });
  assert.throws(() => validateSignedGreenhouseEvent(signed({ ...base, payload: { secret: 'do not put payloads here' } })), { code: 'EVENT_SCHEMA_INVALID' });
  assert.throws(() => validateSignedGreenhouseEvent(signed({ ...base, classification: 'RESTRICTED' })), { code: 'EVENT_RESTRICTED_REFERENCE_REQUIRED' });
});
