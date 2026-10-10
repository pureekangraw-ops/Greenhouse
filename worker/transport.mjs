// Greenhouse transport inbox. Existing Metropolis owns Work and permissions.
// Required Worker bindings: PIXIE_DB (D1), PIXIE_DELIVERY_QUEUE (Queue),
// METROPOLIS_GREENHOUSE_TRANSPORT_SECRET (secret).
const reply = (value, status = 200) => Response.json(value, { status });
const valid = value => typeof value === 'string' && value.trim().length > 0;
const ready = env => Boolean(env.PIXIE_DB && env.PIXIE_DELIVERY_QUEUE && valid(env.METROPOLIS_GREENHOUSE_TRANSPORT_SECRET));
const receiptId = transportId => 'GH:' + transportId;

export default {
  async fetch(request, env) {
    if (!ready(env)) return reply({ error: 'TRANSPORT_BINDINGS_UNAVAILABLE' }, 503);
    if (request.headers.get('authorization') !== 'Bearer ' + env.METROPOLIS_GREENHOUSE_TRANSPORT_SECRET) {
      return reply({ error: 'UNAUTHORIZED' }, 401);
    }
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/station/health') {
      return reply({ status: 'NOT_READY', reason: 'DOWNSTREAM_EXECUTOR_NOT_CONFIGURED', stationId: 'GREENHOUSE_STATION', railId: 'RAIL_GREENHOUSE', ownerSystem: 'GREENHOUSE', observedAt: new Date().toISOString() }, 503);
    }
    if (request.method === 'POST' && url.pathname === '/station/receive') {
      let input;
      try { input = await request.json(); } catch { return reply({ error: 'INVALID_JSON' }, 400); }
      const fields = ['transportId', 'workId', 'checkpointId', 'targetStation', 'operation', 'workPassRef', 'actingActor'];
      if (!fields.every(key => valid(input?.[key])) || input.targetStation === 'GREENHOUSE_STATION') return reply({ error: 'INVALID_WORK_CONTEXT' }, 400);
      const id = receiptId(input.transportId);
      const key = input.transportId;
      try {
        const existing = await env.PIXIE_DB.prepare('SELECT delivery_id, work_id, checkpoint_id, status FROM pixie_deliveries WHERE idempotency_key = ?').bind(key).first();
        if (existing) {
          if (existing.work_id !== input.workId || existing.checkpoint_id !== input.checkpointId) return reply({ error: 'IDEMPOTENCY_CONFLICT' }, 409);
          if (existing.status === 'PENDING' || existing.status === 'FAILED' || existing.status === 'UNKNOWN') return reply({ error: 'DELIVERY_NOT_CONFIRMED', receiptId: existing.delivery_id, status: existing.status }, 503);
          return reply({ accepted: true, receiptId: existing.delivery_id, workId: existing.work_id, checkpointId: existing.checkpoint_id, duplicate: true });
        }
        await env.PIXIE_DB.prepare('INSERT INTO pixie_deliveries (delivery_id,work_id,checkpoint_id,source_station,destination_station,operation,status,idempotency_key) VALUES (?,?,?,?,?,?,?,?)')
          .bind(id,input.workId,input.checkpointId,'METROPOLIS',input.targetStation,input.operation,'PENDING',key).run();
        // Queue delivery is at-least-once; DB key prevents duplicate receipts.
        await env.PIXIE_DELIVERY_QUEUE.send({ receiptId:id, workId:input.workId, checkpointId:input.checkpointId, targetStation:input.targetStation, operation:input.operation, workPassRef:input.workPassRef, actingActor:input.actingActor, payload:input.payload || {} });
        await env.PIXIE_DB.prepare("UPDATE pixie_deliveries SET status='QUEUED',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?").bind(id).run();
        return reply({ accepted:true, receiptId:id, workId:input.workId, checkpointId:input.checkpointId }, 202);
      } catch {
        return reply({ error:'DELIVERY_NOT_CONFIRMED', receiptId:id }, 503);
      }
    }
    if (request.method === 'GET' && url.pathname.startsWith('/station/readback/')) {
      const id = decodeURIComponent(url.pathname.slice('/station/readback/'.length));
      const row = await env.PIXIE_DB.prepare('SELECT * FROM pixie_deliveries WHERE delivery_id=?').bind(id).first();
      if (!row) return reply({ error:'RECEIPT_NOT_FOUND' },404);
      // Receipt persistence is not evidence that a downstream tool executed.
      return reply({ receiptId:id, workId:row.work_id, checkpointId:row.checkpoint_id, targetStation:row.destination_station, status:row.status, verified:false, evidenceRef:null });
    }
    return reply({ error:'NOT_FOUND' },404);
  },
  async queue(batch, env) {
    // Until tool adapters are registered, preserve messages for retry/dead-letter;
    // never acknowledge delivery as executed without a downstream receipt.
    // Fail closed: do not enable this consumer until a downstream adapter is implemented.
    // A bounded retry policy must be configured before activation.
    for (const message of batch.messages) message.retry();
  },
};
