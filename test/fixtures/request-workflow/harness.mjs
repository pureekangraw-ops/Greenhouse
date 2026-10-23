// Test only: durable implementation of the producer's existing D1 interface.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { requestWorkflow } from './producer.mjs';
import { createGreenhouseServer } from '../../../server.mjs';
import { createRequestEventReadback } from '../../../src/greenhouse/request-event-readback.mjs';
const [mode, file] = process.argv.slice(2);
const sqlite = new DatabaseSync(file, {readOnly: mode !== 'seed'});
sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const db = {
 prepare(query) { return { bind(...args) { return {
  async first() { return sqlite.prepare(query).get(...args) ?? null; },
  async all() { return { results: sqlite.prepare(query).all(...args) }; },
  async run() { return { meta: { changes: Number(sqlite.prepare(query).run(...args).changes) } }; }
 }; } }; },
 async batch(statements) {
  sqlite.exec('BEGIN IMMEDIATE');
  try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
 }
};
if (mode === 'seed') {
 sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
 let cookie;
 const call = async (path, body) => {
  const response = await requestWorkflow(new Request('https://synthetic.test/api/v1/requests' + path, {
   method: body ? 'POST' : 'GET', headers: { origin: 'https://synthetic.test', 'content-type': 'application/json', ...(cookie ? {cookie} : {}) },
   ...(body ? { body: JSON.stringify(body) } : {})
  }), {REQUESTS_DB: db}, () => { throw Error('AI is off'); });
  cookie ||= response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok) throw Error(JSON.stringify(await response.json()));
  return response.json();
 };
 await call('');
 await call('/synthetic-request', {brief:{goal:'SYNTHETIC PRIVATE CONTENT: never expose'}});
 const first = await call('/synthetic-request/confirm', {});
 await call('/synthetic-request/confirm', {});
 const e = first.events.find(e => e.to_value === 'SUBMITTED');
 console.log(JSON.stringify({event: {schemaVersion:'greenhouse.event.v1',source:'shop',eventId:e.event_id,eventType:'request.submitted',occurredAt:e.timestamp,correlationId:'synthetic-request',payloadRef:'ygg_request_events:'+e.event_id,classification:'INTERNAL'}, count:sqlite.prepare('SELECT COUNT(*) AS n FROM ygg_request_events').get().n}));
 sqlite.close();
} else {
 const adapter = createRequestEventReadback({db, source:'shop', evidenceScope:'LOCAL_TEST', authorize: async session => session.actorId === 'synthetic-office'});
 const server = createGreenhouseServer({
  sourceRegistry:{shop:{secret:'synthetic-only-secret-at-least-32-bytes',eventTypes:['request.submitted']}},
  ownerSessionResolver: async req => req.headers.authorization === 'Bearer synthetic-office' ? {actorId:'synthetic-office'} : null,
  hubEventSink: adapter.hubEventSink, inboxReader:adapter.inboxReader, allowLocalEventEvidence:true,
 });
 server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
 process.on('SIGTERM',()=>server.close(()=>{sqlite.close();process.exit(0);}));
}
