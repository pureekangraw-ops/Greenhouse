import test from 'node:test';
import assert from 'node:assert/strict';
import {EVENT_SCHEMA,validateOperationEvent,projectOperations,planAuthorizedRoute} from '../src/greenhouse/state-intelligence.mjs';
const t0='2026-10-10T04:00:00.000Z',workId='WORK-test',checkpointId='WORK-test:CP-01';
const e=(source,state,n,extra={})=>({
 schema:EVENT_SCHEMA,eventId:'ev-'+n,workId,checkpointId,attemptId:'ATT-1',
 stationId:'FACTORY_STATION',operation:'CODE',
 observedAt:new Date(Date.parse(t0)+n*1000).toISOString(),source,state,...extra
});
test('keeps Hall, PIXIE and TOOL state separate',()=>{
 const p=projectOperations([e('HALL','HANDED_OFF',1),e('PIXIE','DISPATCHED',2),
 e('PIXIE','ACCEPTED',3,{receiptRef:'receipt://1'}),e('TOOL','RUNNING',4)],
 {now:'2026-10-10T04:00:05.000Z'});
 assert.deepEqual(p.counts,{attempts:1,running:1,waiting:0,incidents:0,hallClosed:0});
 assert.equal(p.items[0].hall,'HANDED_OFF');
 assert.equal(p.items[0].delivery,'ACCEPTED');
 assert.equal(p.items[0].execution,'RUNNING');
 assert.equal(p.items[0].waitingOn,'TOOL_RESULT');
});
test('tool completion is not Hall completion',()=>{
 const p=projectOperations([e('PIXIE','ACCEPTED',1),e('TOOL','COMPLETED',2)],{now:t0});
 assert.equal(p.items[0].hall,'UNKNOWN');
 assert.equal(p.items[0].waitingOn,'HALL_RETURN');
 assert.equal(p.counts.hallClosed,0);
});
test('unknown delivery never implies failure or automatic retry',()=>{
 const p=projectOperations([e('PIXIE','OUTCOME_UNKNOWN',1)],{now:t0});
 assert.equal(p.items[0].waitingOn,'READBACK');
 assert.equal(p.items[0].blocker,'DISPATCH_OUTCOME_UNKNOWN');
});
test('stale accepted task calls for heartbeat not invented completion',()=>{
 const p=projectOperations([e('PIXIE','ACCEPTED',1)],{now:'2026-10-10T05:00:00.000Z'});
 assert.equal(p.items[0].confidence,'STALE');
 assert.equal(p.items[0].waitingOn,'TOOL_HEARTBEAT');
});
test('duplicate event is idempotent and conflicting event ID fails',()=>{
 assert.equal(projectOperations([e('PIXIE','QUEUED',1),e('PIXIE','QUEUED',1)],{now:t0}).items[0].eventCount,1);
 assert.throws(()=>projectOperations([e('PIXIE','QUEUED',1),e('PIXIE','DISPATCHED',1)],{now:t0}),/EVENT_ID_COLLISION/);
});
test('attempt cannot be redirected to another Work or checkpoint',()=>{
 assert.throws(()=>projectOperations([e('PIXIE','QUEUED',1),{...e('TOOL','RUNNING',2),checkpointId:'WORK-test:CP-02'}],{now:t0}),/ATTEMPT_SCOPE_COLLISION/);
});
test('invalid Work context and unsupported state fail closed',()=>{
 assert.throws(()=>validateOperationEvent({...e('PIXIE','QUEUED',1),checkpointId:'WORK-other:CP-01'}),/OPERATION_EVENT_INVALID/);
 assert.throws(()=>validateOperationEvent(e('PIXIE','MAGIC',1)),/OPERATION_EVENT_INVALID/);
});
test('routing uses exact station, capability and verified capacity',()=>{
 const base={stationId:'FACTORY_STATION',operation:'CODE',workId,checkpointId,
 registry:{FACTORY_STATION:{status:'READY',capabilities:['CODE'],capacity:2,active:1}}};
 assert.equal(planAuthorizedRoute(base).action,'DISPATCH');
 assert.equal(planAuthorizedRoute({...base,registry:{}}).reason,'STATION_UNREGISTERED');
 assert.equal(planAuthorizedRoute({...base,registry:{FACTORY_STATION:{status:'READY',capabilities:['VISUAL'],capacity:2,active:1}}}).action,'DENY');
 assert.equal(planAuthorizedRoute({...base,registry:{FACTORY_STATION:{status:'READY',capabilities:['CODE'],capacity:2,active:2}}}).reason,'CAPACITY_FULL');
 assert.equal(planAuthorizedRoute({...base,registry:{FACTORY_STATION:{status:'UNKNOWN',capabilities:['CODE'],capacity:2,active:0}}}).reason,'STATION_NOT_READY');
});
