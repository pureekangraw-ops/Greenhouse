// Test only: durable implementation of the producer's existing D1 interface.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { requestWorkflow } from './producer.mjs';
import { createGreenhouseServer } from '../../../server.mjs';
import { createRequestEventReadback } from '../../../src/greenhouse/request-event-readback.mjs';
const [mode, file] = process.argv.slice(2);
const sqlite = new DatabaseSync(file, {readOnly: mode === 'serve'});
sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
let transaction = Promise.resolve();
const db = {
 prepare(query) { return { bind(...args) { return {
  async first() { return sqlite.prepare(query).get(...args) ?? null; },
  async all() { return { results: sqlite.prepare(query).all(...args) }; },
  async run() { return { meta: { changes: Number(sqlite.prepare(query).run(...args).changes) } }; }
 }; } }; },
 async batch(statements) {
  const previous=transaction;let release;transaction=new Promise(resolve=>release=resolve);await previous;
  try {
  sqlite.exec('BEGIN IMMEDIATE');
  try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } finally {release();}
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
} else if (mode === 'owner') {
 sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
 const token='synthetic-owner-token-at-least-32-bytes';
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
 const server=createServer(async (req,res)=>{
  try {
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const request=new Request('https://yggmetro.com'+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
   const response=await requestWorkflow(request,{REQUESTS_DB:db,YGG_ADMIN_CREDENTIALS:JSON.stringify({'synthetic-admin':digest})},()=>{throw Error('AI_OFF');});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  } catch {res.writeHead(500);res.end('harness failure');}
 });
 server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
 process.on('SIGTERM',()=>server.close(()=>{sqlite.close();process.exit(0);}));
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
