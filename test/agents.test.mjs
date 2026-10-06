import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../src/agents/policy.mjs');
const now = 100000;
const work = {workId:'WORK-REAL',checkpointId:'CP-REAL'};
const browser = {deviceId:'D',tabId:'T',captureId:'C',revision:4,epoch:2,capturedAtEpochMs:now-100,foreground:true,interactive:true};
const base = {agent:'GENOME',mode:'SHOP',text:'อยากทำเว็บ',context:{}};

test('Genome requests one missing brief detail instead of inventing price',async()=>{
 const {evaluateAgent}=await load(); const r=evaluateAgent(base,now);
 assert.equal(r.action,'CLARIFY'); assert.equal(r.proposal,null); assert.equal(r.commercial.payment,'UNKNOWN');
});
test('Genome human request bypasses incomplete intake',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({...base,text:'ขอคุยกับคน'},now);
 assert.equal(r.action,'HANDOFF');assert.equal(r.status,'WAITING');assert.equal(r.workContext,null);
});
test('payment claim is escalated without declaring paid',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({...base,text:'โอนแล้วนะ'},now);
 assert.equal(r.action,'REVIEW_PAYMENT');assert.equal(r.commercial.payment,'UNKNOWN');
});
test('confirmed intake retains supplied identity',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({...base,context:{work,brief:{goal:'เว็บ',scope:'หนึ่งหน้า',confirmed:true}}},now);
 assert.equal(r.action,'PREPARE_HANDOFF');assert.deepEqual(r.workContext,work);
});
test('Office refuses WorkContext mismatch',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'GENOME',mode:'OFFICE',text:'ดูงาน',context:{work,ownerReadback:{...work,checkpointId:'OLD',observedAtEpochMs:now,status:'OPEN',evidenceRefs:['owner://work']}}},now);
 assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'WORK_CONTEXT_MISMATCH');
});
test('Office source-backed report preserves evidence and never closes work',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'GENOME',mode:'OFFICE',text:'ดูงาน',context:{work,ownerReadback:{...work,observedAtEpochMs:now,status:'OPEN',evidenceRefs:['owner://work']}}},now);
 assert.equal(r.action,'REPORT');assert.equal(r.status,'OBSERVED');assert.deepEqual(r.evidenceRefs,['owner://work']);
});
test('Office marks expired source UNKNOWN',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'GENOME',mode:'OFFICE',text:'ดูงาน',context:{work,ownerReadback:{...work,observedAtEpochMs:1,status:'OPEN',evidenceRefs:['owner://work']}}},now);
 assert.equal(r.status,'UNKNOWN');
});
test('Lyra refuses stale browser capture',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'LYRA',mode:'INSIDE',text:'กด',context:{work,browser:{...browser,capturedAtEpochMs:1},request:{action:'click',targetId:'btn'},authorities:['browser.click']}},now);
 assert.equal(r.status,'BLOCKED');assert.equal(r.proposal,null);
});
test('Lyra browser proposal binds exact capture and authority',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'LYRA',mode:'INSIDE',text:'กด',context:{work,browser:{...browser,targets:[{id:'btn',kind:'button'}]},request:{action:'click',targetId:'btn'},authorities:['browser.click']}},now);
 assert.equal(r.status,'PROPOSED');assert.equal(r.proposal.captureId,'C');assert.equal(r.proposal.checkpointId,'CP-REAL');assert.equal(r.proposal.expiresAtEpochMs-now,30000);
});
test('Lyra never proposes arbitrary JavaScript',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'LYRA',mode:'INSIDE',text:'run',context:{work,browser,request:{action:'javascript',code:'alert(1)'},authorities:['browser.javascript']}},now);
 assert.equal(r.reason,'ACTION_NOT_ALLOWED');assert.equal(r.proposal,null);
});
test('Lyra approximate coordinates are a region recommendation only',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'LYRA',mode:'OUTSIDE',text:'ปักตรงนี้',context:{coordinate:{longitude:100,latitude:13,status:'APPROXIMATE'}}},now);
 assert.equal(r.action,'RECOMMEND_AREA');assert.equal(r.proposal,null);
});
test('Lyra exact pin requires fresh evidence and existing grid',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'LYRA',mode:'OUTSIDE',text:'ปัก',context:{work,authorities:['map.upsert_pin'],coordinate:{longitude:100,latitude:13,status:'VERIFIED',source:'device://gps',observedAtEpochMs:now},grid:{id:'grid:owner',bounds:{west:99,south:12,east:101,north:14}},request:{pinId:'pin:owner',label:'บ้าน'}}},now);
 assert.equal(r.action,'PROPOSE_PIN');assert.equal(r.proposal.pin.gridId,'grid:owner');assert.equal(r.status,'PROPOSED');
});
test('Lyra dispatch receipt does not claim business success',async()=>{
 const {evaluateAgent}=await load();const r=evaluateAgent({agent:'LYRA',mode:'INSIDE',text:'สำเร็จไหม',context:{receipt:{commandId:'CMD',status:'ACCEPTED'}}},now);
 assert.equal(r.action,'WAIT_READBACK');assert.equal(r.businessOutcome,'UNKNOWN');
});
test('unknown role and illegal mode are rejected',async()=>{
 const {evaluateAgent}=await load();assert.throws(()=>evaluateAgent({...base,agent:'FAKE'},now),/AGENT_UNKNOWN/);assert.throws(()=>evaluateAgent({...base,mode:'INSIDE'},now),/MODE_INVALID/);
});

const inside = context => ({agent:'LYRA',mode:'INSIDE',text:'กรอก',context:{work,authorities:['browser.fill'],browser,request:{action:'fill',value:'x'},...context}});
const outside = context => ({agent:'LYRA',mode:'OUTSIDE',text:'ปัก',context:{work,authorities:['map.upsert_pin'],coordinate:{longitude:100,latitude:13,status:'VERIFIED',source:'device://gps',observedAtEpochMs:now},grid:{id:'grid:owner',bounds:{west:99,south:12,east:101,north:14}},request:{pinId:'p',label:'บ้าน'},...context}});
test('missing and malformed browser targets fail closed',async()=>{
 const {evaluateAgent}=await load();
 for(const targets of [[{kind:'input'}],[null],{},[{id:''}]]) {
  const r=evaluateAgent(inside({browser:{...browser,targets}}),now);
  assert.equal(r.status,'BLOCKED');assert.equal(r.proposal,null);
 }
});
test('sensitive metadata and Thai fields cannot receive fill proposals',async()=>{
 const {evaluateAgent}=await load();
 for(const field of [{type:'password'},{label:'รหัสผ่าน'},{label:'รหัสยืนยัน'},{label:'เลขบัตรเครดิต'},{sensitive:true}]) {
  const r=evaluateAgent(inside({browser:{...browser,targets:[{id:'t',kind:'input',...field}]},request:{action:'fill',targetId:'t',value:'x'}}),now);
  assert.equal(r.status,'BLOCKED');assert.equal(r.proposal,null);
 }
});
test('browser interactive flags must be actual true booleans',async()=>{
 const {evaluateAgent}=await load();
 for(const flags of [{foreground:'false'},{interactive:'true'}]) assert.equal(evaluateAgent(inside({browser:{...browser,...flags}}),now).status,'BLOCKED');
});
test('map rejects every supplied unsupported action',async()=>{
 const {evaluateAgent}=await load();
 for(const action of ['DELETE_PIN','route','unknown','']) assert.equal(evaluateAgent(outside({request:{action,pinId:'p',label:'บ้าน'}}),now).status,'BLOCKED');
 assert.equal(evaluateAgent(outside({request:{action:'UPSERT_PIN',pinId:'p',label:'บ้าน'}}),now).action,'PROPOSE_PIN');
 assert.equal(evaluateAgent(outside({authorities:'map.upsert_pin'}),now).status,'BLOCKED');
});
test('pin evidence expiry is capped by original observation lifetime',async()=>{
 const {evaluateAgent}=await load();
 for(const availableUntil of [undefined,now+90000]) {
  const r=evaluateAgent(outside({coordinate:{longitude:100,latitude:13,status:'VERIFIED',source:'gps',observedAtEpochMs:now-29999,availableUntil}}),now);
  assert.equal(r.proposal.pin.evidence.availableUntil,now+1);
 }
});
