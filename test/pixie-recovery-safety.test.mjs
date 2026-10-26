import test from 'node:test';
import assert from 'node:assert/strict';
import {createPixieDeliveryRuntime} from '../src/pixie/delivery-runtime.mjs';
import {existingCityDispatch} from '../src/pixie/transport-worker.mjs';

// All stores, queues, dispatch effects and credentials below are synthetic.
// No fetch, live binding, service, D1, Cloudflare or external credentials are used.
for (const initialOutcome of ['ACCEPTED', 'OUTCOME_UNKNOWN']) {
 test(`${initialOutcome}: missing readback binding must not re-execute original cargo`, async () => {
  const rows=new Map(), messages=[], transitions=[];
  let executions=0;
  const store={
   async create(r){if(rows.has(r.attemptId))return false;rows.set(r.attemptId,{...r});return true;},
   async get(id){return rows.has(id)?{...rows.get(id)}:null;},
   async transition(id,from,to,patch){const r=rows.get(id);if(!r||!from.includes(r.state))return false;
    transitions.push({from:r.state,to,reason:patch?.reason??null});rows.set(id,{...r,...patch,state:to});return true;},
   async listByState(states,n){return [...rows.values()].filter(r=>states.includes(r.state)).slice(0,n).map(r=>({...r}));},
  };
  const queue={async send(msg){messages.push({...msg});}};
  const clock=()=> '2026-10-26T00:00:00.000Z';
  const job={workId:'WORK-SYNTHETIC',checkpointId:'WORK-SYNTHETIC:CP-01',attemptId:'ATT-SYNTHETIC-1',
   stationId:'FACTORY_STATION',operation:'SYNTHETIC',workPassRef:'fake-work-pass',actor:'GO',payload:{synthetic:true}};
  const dispatch=async r=>{executions++;if(initialOutcome==='OUTCOME_UNKNOWN'&&executions===1)throw new Error('fake response lost after fake effect');
   return {accepted:true,receiptRef:'fake-receipt',workId:r.workId,checkpointId:r.checkpointId};};
  const original=createPixieDeliveryRuntime({store,queue,dispatch,clock});
  await original.intake(job);
  await original.consume(messages.shift());
  assert.equal((await store.get(job.attemptId)).state,initialOutcome);
  assert.equal(executions,1);
  // This invokes the real production adapter with no service binding.
  // It returns local METROPOLIS_SERVICE_NOT_BOUND, with zero receiver calls.
  const missingRouteReadback=existingCityDispatch({},'/station/readback');
  assert.deepEqual(await missingRouteReadback(job),{notSent:true,reason:'METROPOLIS_SERVICE_NOT_BOUND'});
  const recovery=createPixieDeliveryRuntime({store,queue,dispatch,readback:missingRouteReadback,clock});
  await recovery.recover();
  const afterRecovery=(await store.get(job.attemptId)).state;
  const queuedAgain=messages.length;
  if(messages.length)await original.consume(messages.shift());
  console.log('SYNTHETIC_REPRO '+JSON.stringify({initialOutcome,afterRecovery,queuedAgain,executions,transitions}));
  assert.equal(executions,1,'missing local readback route is not authoritative proof that original dispatch never executed');
  assert.equal(afterRecovery,initialOutcome);
  assert.equal(queuedAgain,0);
  assert.equal(transitions.some(t=>['ACCEPTED','OUTCOME_UNKNOWN'].includes(t.from) && ['WAITING_ROUTE','QUEUED'].includes(t.to)),false);
 });
}

function fixture(initialOutcome) {
 const rows=new Map(), messages=[];
 let executions=0;
 const store={
  async create(row){if(rows.has(row.attemptId))return false;rows.set(row.attemptId,{...row});return true;},
  async get(id){return rows.has(id)?{...rows.get(id)}:null;},
  async transition(id,from,to,patch){const row=rows.get(id);if(!row||!from.includes(row.state))return false;
   rows.set(id,{...row,...patch,state:to});return true;},
  async listByState(states,n){return [...rows.values()].filter(row=>states.includes(row.state)).slice(0,n).map(row=>({...row}));},
 };
 const queue={async send(message){messages.push(message);}};
 const clock=()=> '2026-10-26T00:00:00.000Z';
 const job={workId:'WORK-SYNTHETIC',checkpointId:'WORK-SYNTHETIC:CP-01',attemptId:'ATT-SYNTHETIC-1',
  stationId:'FACTORY_STATION',operation:'SYNTHETIC',workPassRef:'fake-work-pass',actor:'GO',payload:{synthetic:true}};
 const dispatch=async row=>{executions++;if(initialOutcome==='OUTCOME_UNKNOWN')throw new Error('synthetic lost reply');
  return {accepted:true,receiptRef:'fake-receipt',workId:row.workId,checkpointId:row.checkpointId};};
 const runtime=createPixieDeliveryRuntime({store,queue,clock,dispatch});
 return {store,queue,clock,job,dispatch,runtime,messages,get executions(){return executions;},
  async start(){await runtime.intake(job);await runtime.consume(messages.shift());},
  recovery(readback){return createPixieDeliveryRuntime({store,queue,clock,dispatch,readback});},
  proof:{attemptId:job.attemptId,workId:job.workId,checkpointId:job.checkpointId,
   receiptRef:'fake-receipt',evidenceRef:'fake-evidence',verified:true,domainCompleted:false}};
}
for(const outcome of ['ACCEPTED','OUTCOME_UNKNOWN']) {
 test(`${outcome}: repeated unverified reconciliation and reads preserve dispatch hold`,async()=>{
  const s=fixture(outcome);await s.start();
  const before=await s.store.get(s.job.attemptId);
  for(const readback of [undefined,async()=>({notSent:true,reason:'LOCAL_READBACK_UNAVAILABLE'}),
   async()=>{throw new Error('readback unavailable');},async()=>({accepted:true})]) {
   const recovery=s.recovery(readback);
   for(let i=0;i<3;i++){
    await recovery.recover();
    assert.deepEqual(await s.store.get(s.job.attemptId),before);
    assert.equal((await recovery.consume({attemptId:s.job.attemptId})).duplicate,true);
    assert.equal((await recovery.intake(s.job)).duplicate,true);
   }
  }
  assert.equal(s.executions,1);assert.deepEqual(s.messages,[]);
 });
 test(`${outcome}: mismatched readback cannot clear hold; matching owner receipt can`,async()=>{
  const s=fixture(outcome);await s.start();
  const before=await s.store.get(s.job.attemptId);
  const mismatches=[{workId:'WORK-OTHER'},{checkpointId:'WORK-SYNTHETIC:CP-OTHER'},
   {attemptId:'ATT-OTHER'},{verified:false},{evidenceRef:''}];
  if(outcome==='ACCEPTED')mismatches.push({receiptRef:'other-receipt'});
  for(const mismatch of mismatches){
   await s.recovery(async()=>({...s.proof,...mismatch})).recover();
   assert.deepEqual(await s.store.get(s.job.attemptId),before);
   assert.deepEqual(s.messages,[]);assert.equal(s.executions,1);
  }
  const result=await s.runtime.recordReadback(s.proof);
  assert.equal(result.record.state,'READBACK_VERIFIED');
  assert.equal(result.record.domainCompleted,false);
  await s.recovery(async()=>({notSent:true})).recover();
  assert.equal((await s.runtime.consume({attemptId:s.job.attemptId})).duplicate,true);
  assert.equal(s.executions,1);assert.deepEqual(s.messages,[]);
 });
}
