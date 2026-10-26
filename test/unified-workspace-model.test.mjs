import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../greenhouse/workspace-model.mjs';
const item=(dimension='DELIVERY',value='ACCEPTED')=>({ref:{sourceSystem:'go',resourceType:'BUSINESS_REQUEST',resourceId:'same'},title:'Same title',statusFacts:[{dimension,value,sourceUpdatedAt:null,observedAt:null}],nextAction:null,provenance:{sourceSystem:'go',sourceRef:'same',observedAt:null,availability:'AVAILABLE'},result:{availability:'UNKNOWN'},links:[]});
test('typed identities never merge same IDs across namespaces or delimiter collisions',()=>{
 assert.equal(typeof model.trackingKey,'function');
 assert.notEqual(model.trackingKey(item().ref),model.trackingKey({...item().ref,sourceSystem:'hub'}));
 assert.notEqual(model.trackingKey({sourceSystem:'a:b',resourceType:'c',resourceId:'d'}),model.trackingKey({sourceSystem:'a',resourceType:'b:c',resourceId:'d'}));
});
test('receipt acceptance and execution completion never claim owner Work completed',()=>{
 assert.equal(typeof model.trackingStatus,'function');
 assert.equal(model.trackingStatus(item()).key,'unknown');
 assert.equal(model.trackingStatus(item('EXECUTION','SUCCEEDED')).key,'unknown');
 assert.match(model.trackingStatus(item('EXECUTION','SUCCEEDED')).label,/ประมวลผลเสร็จ/);
 assert.equal(model.trackingStatus(item('WORK_LIFECYCLE','COMPLETED')).key,'completed');
 assert.equal(model.trackingStatus({...item(),domainCompleted:false}).key,'unknown');
 assert.equal(model.trackingStatus(item('WORK_LIFECYCLE','BLOCKED')).key,'blocked');
 assert.equal(model.trackingStatus(item('EXECUTION','FAILED')).key,'failed');
});
test('filters distinguish unknown, running, action and failed without title dedupe',()=>{
 assert.equal(typeof model.filterTracking,'function');
 const rows=[item(),item('EXECUTION','RUNNING'),item('EXECUTION','FAILED'),{...item(),nextAction:'Review'}];
 assert.equal(model.filterTracking(rows,{status:'unknown'}).length,2);
 assert.equal(model.filterTracking(rows,{status:'needs-action',query:'same'}).length,1);
 assert.equal(model.filterTracking(rows,{status:'running'}).length,1);
 assert.equal(model.filterTracking(rows,{status:'all',query:'go'}).length,4);
});
test('readback requires schema and exact typed item, including namespace',()=>{
 assert.equal(typeof model.acceptTracking,'function');
 const body={schema:'greenhouse.tracking.v1',observedAt:null,coverage:{kind:'RECENT_WINDOW',complete:false,total:null},items:[item()]};
 assert.equal(model.acceptTracking(body,item().ref).items.length,1);
 assert.throws(()=>model.acceptTracking(body,{...item().ref,sourceSystem:'hub'}));
 assert.throws(()=>model.acceptTracking({...body,schema:'wrong'}));
 assert.throws(()=>model.acceptTracking({...body,items:[item(),item()]},item().ref));
});
test('tracking row preserves status source time and escaped title on mobile markup',()=>{
 assert.equal(typeof model.renderTrackingRow,'function');
 const html=model.renderTrackingRow({...item('EXECUTION','SUCCEEDED'),title:'<img onerror=x>'});
 assert.match(html,/ประมวลผลเสร็จ/);assert.match(html,/go/);assert.match(html,/<time/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
});
test('owner active and pending delivery states retain their distinct meanings',()=>{
 assert.equal(model.trackingStatus(item('WORK_LIFECYCLE','ACTIVE')).key,'running');
 assert.match(model.trackingStatus(item('DELIVERY','PENDING_QUEUE')).label,/คิวรอส่ง/);
});
test('request reader creates a typed business request without inventing Work identity',()=>{
 const row=model.requestTracking(model.demoEvents[0]);
 assert.deepEqual(row.ref,{sourceSystem:'demo-shop',resourceType:'BUSINESS_REQUEST',resourceId:'demo-request-001'});
 assert.equal(row.statusFacts[0].dimension,'BUSINESS_REQUEST');
 assert.equal(model.trackingStatus(row).key,'unknown');
 assert.equal(row.result.availability,'UNKNOWN');
});
test('denied or missing item read removes only exact typed prior item; timeout retains stale facts',()=>{
 assert.equal(typeof model.itemsAfterReadFailure,'function');
 const rows=[item(),{...item(),ref:{...item().ref,sourceSystem:'hub'}}];
 for(const status of [401,403,404])assert.deepEqual(model.itemsAfterReadFailure(rows,item().ref,status).map(i=>i.ref.sourceSystem),['hub']);
 assert.equal(model.itemsAfterReadFailure(rows,item().ref,0).length,2);
});

test('tracking UI defensively rejects an entire duplicate identity list while accepting distinct namespaces',()=>{
 const body={schema:'greenhouse.tracking.v1',observedAt:null,coverage:{kind:'RECENT_WINDOW',complete:false,total:null},items:[item(),{...item(),title:'Conflicting title'}]};
 assert.throws(()=>model.acceptTracking(body),/TRACKING_INVALID/);
 body.items[1].ref={...body.items[1].ref,sourceSystem:'hub'};
 assert.equal(model.acceptTracking(body).items.length,2);
});
