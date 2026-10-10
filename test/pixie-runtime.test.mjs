import test from 'node:test';
import assert from 'node:assert/strict';
import {createPixieDeliveryRuntime} from '../src/pixie/delivery-runtime.mjs';

function setup({dispatch,failQueue=false}={}){
 const rows=new Map(), messages=[], transitions=[];
 const store={
  async create(input){if(rows.has(input.attemptId))return false; rows.set(input.attemptId,{...input});return true;},
  async get(id){return rows.get(id)?{...rows.get(id)}:null;},
  async transition(id,from,to,patch){const x=rows.get(id);if(!x||!from.includes(x.state))return false;
   rows.set(id,{...x,...patch,state:to});transitions.push(to);return true;},
  async listByState(states,n){return [...rows.values()].filter(x=>states.includes(x.state)).slice(0,n).map(x=>({...x}));},
 };
 const queue={async send(msg){if(failQueue)throw new Error('queue unavailable');messages.push(msg);}};
 const clock=()=> '2026-10-10T04:30:00.000Z';
 return {rows,messages,transitions,store,queue,clock,
  runtime:createPixieDeliveryRuntime({store,queue,dispatch,clock})};
}
const job={workId:'WORK-123',checkpointId:'WORK-123:CP-01',attemptId:'ATT-1',
 stationId:'FACTORY_STATION',operation:'CODE',workPassRef:'work-pass://WORK-PASS:WORK-123:GO',actor:'GO'};
test('intake is durable and idempotent with original Work ID',async()=>{
 const s=setup();
 const first=await s.runtime.intake(job);
 assert.equal(first.record.state,'QUEUED');
 assert.equal(s.messages.length,1);
 const repeated=await s.runtime.intake({...job});
 assert.equal(repeated.duplicate,true);
 assert.equal(s.messages.length,1);
 await assert.rejects(()=>s.runtime.intake({...job,workId:'WORK-OTHER',checkpointId:'WORK-OTHER:CP-01'}),/PIXIE_ATTEMPT_COLLISION/);
});
test('queue at-least-once never executes accepted message twice',async()=>{
 let invocations=0;
 const s=setup({dispatch:async x=>{invocations++;return {accepted:true,receiptRef:'receipt://factory-1',workId:x.workId,checkpointId:x.checkpointId};}});
 await s.runtime.intake(job);
 const first=await s.runtime.consume({attemptId:job.attemptId});
 assert.equal(first.status,'ACCEPTED');
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).duplicate,true);
 assert.equal(invocations,1);
 const r=await s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://factory-1',evidenceRef:'evidence://factory-1',
  verified:true,domainCompleted:false});
 assert.equal(r.record.state,'READBACK_VERIFIED');
 assert.equal(r.record.domainCompleted,false);
});
test('missing authorized route waits instead of pretending to dispatch',async()=>{
 const s=setup();await s.runtime.intake(job);
 const result=await s.runtime.consume({attemptId:job.attemptId});
 assert.equal(result.status,'WAITING_ROUTE');
 assert.equal((await s.store.get(job.attemptId)).reason,'AUTHORIZED_ROUTE_NOT_CONNECTED');
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).duplicate,true);
});
test('ambiguous provider outcome holds until verified readback, not replay',async()=>{
 let count=0;
 const s=setup({dispatch:async()=>{count++;throw new Error('network died after send');}});
 await s.runtime.intake(job);
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).status,'OUTCOME_UNKNOWN');
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).duplicate,true);
 assert.equal(count,1);
 await assert.rejects(()=>s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://ok',evidenceRef:'evidence://ok',verified:false}),/PIXIE_READBACK_UNVERIFIED/);
 const verified=await s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://ok',evidenceRef:'evidence://ok',verified:true});
 assert.equal(verified.record.receiptRef,'receipt://ok');
 assert.equal(verified.record.state,'READBACK_VERIFIED');
});
test('queue send failure preserves outbox for recovery, no Work recreation',async()=>{
 const s=setup({failQueue:true});
 assert.equal((await s.runtime.intake(job)).record.state,'WAITING_QUEUE');
 const recovered=createPixieDeliveryRuntime({store:s.store,queue:{send:async msg=>s.messages.push(msg)},clock:s.clock});
 const results=await recovered.recover();
 assert.equal(results.length,1);
 assert.equal((await s.store.get(job.attemptId)).state,'QUEUED');
 assert.equal(s.messages.length,1);
});
test('rejects mismatched readback and context',async()=>{
 const s=setup({dispatch:async x=>({accepted:true,receiptRef:'receipt://a',workId:x.workId,checkpointId:x.checkpointId})});
 await s.runtime.intake(job);await s.runtime.consume({attemptId:job.attemptId});
 await assert.rejects(()=>s.runtime.recordReadback({attemptId:job.attemptId,workId:'WORK-other',
  checkpointId:job.checkpointId,receiptRef:'receipt://a',evidenceRef:'evidence://a',verified:true}),/PIXIE_READBACK_UNVERIFIED/);
});

test('signed City factory boundary readback may confirm already queued attempt',async()=>{
 const s=setup();await s.runtime.intake(job);
 const result=await s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://factory-boundary',
  evidenceRef:'evidence://factory-boundary',verified:true,cityBoundaryVerified:true,domainCompleted:false});
 assert.equal(result.record.state,'READBACK_VERIFIED');
 assert.equal(result.record.domainCompleted,false);
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).duplicate,true);
});
test('untrusted claim cannot skip accepted boundary',async()=>{
 const s=setup();await s.runtime.intake(job);
 await assert.rejects(()=>s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://invalid',evidenceRef:'evidence://invalid',verified:true}),/PIXIE_READBACK_WRONG_STATE/);
});
test('conveyor keeps original cargo and records verified owner receipt in queue consumer',async()=>{
 const cargo={requestedResult:'Original requested result',inputRefs:['owner://input']};
 const s=setup({dispatch:async x=>{assert.deepEqual(x.payload,cargo);return {accepted:true,verified:true,
   receiptRef:'receipt://conveyor',evidenceRef:'evidence://conveyor',workId:x.workId,checkpointId:x.checkpointId,domainCompleted:false};}});
 await s.runtime.intake({...job,payload:cargo});
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).status,'READBACK_VERIFIED');
 assert.equal((await s.store.get(job.attemptId)).domainCompleted,false);
 await assert.rejects(()=>s.runtime.intake({...job,payload:{requestedResult:'Changed'}}),/PIXIE_ATTEMPT_COLLISION/);
});
test('route retries stop after five proven not-sent attempts',async()=>{
 const s=setup({dispatch:async()=>({notSent:true,reason:'DEVICE_NOT_PAIRED'})});
 await s.runtime.intake(job);
 for(let i=0;i<5;i++){await s.runtime.consume({attemptId:job.attemptId});await s.runtime.recover();}
 const row=await s.store.get(job.attemptId);
 assert.equal(row.state,'WAITING_ROUTE');assert.equal(row.retryCount,5);
 assert.equal(s.messages.length,5);
});
test('ambiguous transport reconciles stored receipt without executing again',async()=>{
 const s=setup({dispatch:async()=>{throw new Error('reply lost');}});
 await s.runtime.intake(job);await s.runtime.consume({attemptId:job.attemptId});
 const recovery=createPixieDeliveryRuntime({store:s.store,queue:s.queue,clock:s.clock,
  readback:async x=>({accepted:true,verified:true,workId:x.workId,checkpointId:x.checkpointId,
   receiptRef:'receipt://persisted',evidenceRef:'evidence://persisted'})});
 await recovery.recover();
 assert.equal((await s.store.get(job.attemptId)).state,'READBACK_VERIFIED');assert.equal(s.messages.length,1);
});
