import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1PixieStore} from '../src/pixie/d1-store.mjs';
test('real SQLite legacy status CHECK accepts full conveyor lifecycle and journals precise states',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE pixie_deliveries(delivery_id TEXT PRIMARY KEY,work_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,
 source_station TEXT NOT NULL,destination_station TEXT NOT NULL,operation TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','QUEUED','IN_TRANSIT','DELIVERED','RETURNED','FAILED','UNKNOWN')),
 cargo_ref TEXT,receipt_ref TEXT,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE pixie_delivery_events(event_id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,event_type TEXT NOT NULL,evidence_ref TEXT,created_at TEXT NOT NULL);`);
 for(const file of ['001_pixie_operations.sql','002_pixie_payload.sql','003_pixie_delivery_state.sql'])
  sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const db={prepare(sql){const statement=sqlite.prepare(sql);let values=[];return {bind(...args){values=args;return this;},
  async run(){const result=statement.run(...values);return {meta:{changes:Number(result.changes)}};},
  async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};}};}};
 const store=createD1PixieStore(db);
 const job={attemptId:'ATT-sqlite',workId:'WORK-test',checkpointId:'WORK-test:CP-01',stationId:'FACTORY_STATION',operation:'CODE',
  actor:'GO',workPassRef:'work-pass://test',state:'PENDING_QUEUE',receivedAt:new Date().toISOString(),payload:{requestedResult:'Keep original cargo'}};
 assert.equal(await store.create(job),true);assert.equal(await store.create(job),false);
 let before='PENDING_QUEUE';
 for(const after of ['QUEUED','DISPATCHING','ACCEPTED','READBACK_VERIFIED']){
  assert.equal(await store.transition(job.attemptId,[before],after,{receiptRef:'receipt-1'}),true);before=after;
 }
 const read=await store.get(job.attemptId);
 assert.equal(read.state,'READBACK_VERIFIED');assert.deepEqual(read.payload,job.payload);
 assert.equal((await store.overview()).counts.readbackVerified,1);
 assert.deepEqual((await store.journal(job.attemptId)).map(x=>x.new_state),['PENDING_QUEUE','QUEUED','DISPATCHING','ACCEPTED','READBACK_VERIFIED']);
 assert.equal(await store.transition(job.attemptId,['QUEUED'],'DISPATCHING'),false);
 sqlite.close();
});
