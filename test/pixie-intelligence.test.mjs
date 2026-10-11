import test from 'node:test';
import assert from 'node:assert/strict';
import { createPixieIntelligence } from '../src/pixie/intelligence.mjs';

const observedAt='2026-10-11T02:00:00.000Z';
const evidenceRef='pixie://delivery/ATT-1';
const base={workId:'WORK-1',checkpointId:'WORK-1:CP-01',attemptId:'ATT-1',state:'QUEUED',observedAt,
  evidence:[{ref:evidenceRef,excerpt:'A queued attempt exists in the PIXIE delivery record.'}]};
const fixedClock=()=>'2026-10-11T02:00:01.000Z';
const output=(action='NONE',overrides={})=>({summary:'The existing delivery record is available for review.',
  findings:[{kind:'FACT',text:'The record is queued.',evidenceRefs:[evidenceRef]}],
  recommendation:'Keep the existing Work and wait for the next verified readback.',
  confidence:'PROBABLE',suggestedAction:action,...overrides});

test('unconfigured intelligence is non-blocking and never executes',async()=>{
 const result=await createPixieIntelligence({clock:fixedClock}).analyze(base);
 assert.equal(result.status,'NOT_CONFIGURED');assert.equal(result.stage,'ANALYZE');
 assert.equal(result.mode,'SHADOW');assert.equal(result.executed,false);assert.equal(result.analysis,null);
});

test('all four reasoning stages preserve the same Work/checkpoint/attempt scope',async()=>{
 const actions={ANALYZE:'NONE',PLAN_ROUTE:'KEEP_EXISTING_ROUTE',RESOLVE:'REQUEST_READBACK',EVALUATE:'HOLD_OPEN'};
 for(const stage of Object.keys(actions)){
  const context=stage==='PLAN_ROUTE'?{routeStatus:'READY',stationId:'FACTORY_STATION',operation:'CODE'}:
    stage==='RESOLVE'?{receiptPresent:true,readbackVerified:false}:
    stage==='EVALUATE'?{receiptPresent:true,readbackVerified:false}:{};
  const service=createPixieIntelligence({provider:async call=>output(actions[stage]),clock:fixedClock});
  const result=await service.run(stage,{...base,state:stage==='RESOLVE'?'OUTCOME_UNKNOWN':stage==='EVALUATE'?'ACCEPTED':'QUEUED',context});
  assert.equal(result.status,'SHADOW_PROPOSED');assert.equal(result.stage,stage);assert.equal(result.executed,false);
  assert.equal(result.workId,base.workId);assert.equal(result.checkpointId,base.checkpointId);assert.equal(result.attemptId,base.attemptId);
  assert.equal(result.analysis.suggestedAction,actions[stage]);
 }
});

test('stage helpers expose analyze, plan, resolve, and evaluate',async()=>{
 const service=createPixieIntelligence({provider:async call=>output(call.stage==='ANALYZE'?'NONE':
  call.stage==='PLAN_ROUTE'?'WAIT':call.stage==='RESOLVE'?'WAIT':'HOLD_OPEN'),clock:fixedClock});
 assert.equal((await service.analyze(base)).stage,'ANALYZE');
 assert.equal((await service.planRoute({...base,context:{routeStatus:'UNKNOWN'}})).stage,'PLAN_ROUTE');
 assert.equal((await service.resolve(base)).stage,'RESOLVE');
 assert.equal((await service.evaluate({...base,context:{receiptPresent:true}})).stage,'EVALUATE');
});

test('facts must cite exact supplied evidence references',async()=>{
 for(const refs of [[],['pixie://not-supplied']]){
  const result=await createPixieIntelligence({provider:async()=>output('NONE',{findings:[{kind:'FACT',text:'Unsupported claim.',evidenceRefs:refs}]}),clock:fixedClock}).analyze(base);
  assert.equal(result.status,'INVALID_OUTPUT');assert.equal(result.analysis,null);
 }
});

test('model cannot self-certify CONFIRMED or smuggle a command',async()=>{
 for(const invalid of [output('NONE',{confidence:'CONFIRMED'}),output('NONE',{dispatch:{operation:'CODE'}})]){
  const result=await createPixieIntelligence({provider:async()=>invalid,clock:fixedClock}).analyze(base);
  assert.equal(result.status,'INVALID_OUTPUT');
 }
});

test('routing cannot invent a station or proceed when current route readiness is unknown',async()=>{
 const result=await createPixieIntelligence({provider:async()=>output('KEEP_EXISTING_ROUTE'),clock:fixedClock})
  .planRoute({...base,context:{routeStatus:'UNKNOWN',stationId:'FACTORY_STATION',operation:'CODE'}});
 assert.equal(result.status,'INVALID_OUTPUT');
 assert.match((await createPixieIntelligence({provider:async call=>output('WAIT'),clock:fixedClock})
  .planRoute({...base,context:{routeStatus:'UNKNOWN',stationId:'FACTORY_STATION',operation:'CODE'}})).analysis.suggestedAction,/WAIT/);
});

test('resolution never requests automatic retry for ambiguous outcomes',async()=>{
 const denied=await createPixieIntelligence({provider:async()=>output('RETRY_EXISTING_ATTEMPT'),clock:fixedClock})
  .resolve({...base,state:'OUTCOME_UNKNOWN',context:{receiptPresent:true}});
 assert.equal(denied.status,'INVALID_OUTPUT');
 const safe=await createPixieIntelligence({provider:async()=>output('REQUEST_READBACK'),clock:fixedClock})
  .resolve({...base,state:'OUTCOME_UNKNOWN',context:{receiptPresent:true}});
 assert.equal(safe.status,'SHADOW_PROPOSED');
});

test('evaluation cannot treat receipt as completion',async()=>{
 const safe=await createPixieIntelligence({provider:async()=>output('HOLD_OPEN'),clock:fixedClock})
  .evaluate({...base,state:'ACCEPTED',context:{receiptPresent:true,readbackVerified:false}});
 assert.equal(safe.status,'SHADOW_PROPOSED');
 const unsafe=await createPixieIntelligence({provider:async()=>output('RETURN_FOR_REVIEW'),clock:fixedClock})
  .evaluate({...base,state:'ACCEPTED',context:{receiptPresent:true,readbackVerified:false}});
 assert.equal(unsafe.status,'INVALID_OUTPUT');
});

test('provider failure and timeout fall back without mutating the input',async()=>{
 const snapshot=structuredClone(base);
 const failed=await createPixieIntelligence({provider:async()=>{throw new Error('private provider details');},clock:fixedClock}).analyze(base);
 assert.equal(failed.status,'UNAVAILABLE');assert.equal(failed.executed,false);assert.deepEqual(base,snapshot);
 let signal;
 const timed=await createPixieIntelligence({provider:({signal:s})=>{signal=s;return new Promise(()=>{});},timeoutMs:20,clock:fixedClock}).analyze(base);
 assert.equal(timed.status,'TIMEOUT');assert.equal(signal.aborted,true);assert.equal(timed.executed,false);
});

test('invalid Work/checkpoint or missing evidence is rejected before inference',async()=>{
 let calls=0;const service=createPixieIntelligence({provider:async()=>{calls++;return output();},clock:fixedClock});
 await assert.rejects(service.analyze({...base,checkpointId:'WORK-OTHER:CP-01'}),/PIXIE_INTELLIGENCE_INPUT_INVALID/);
 await assert.rejects(service.analyze({...base,evidence:[]}),/PIXIE_INTELLIGENCE_INPUT_INVALID/);
 assert.equal(calls,0);
});
