import test from 'node:test';
import assert from 'node:assert/strict';
import {createPixieWorker} from '../src/pixie/transport-worker.mjs';
const secret='rail-station-secret-for-tests-only';
const job={workId:'WORK-123',checkpointId:'WORK-123:CP-01',attemptId:'ATT-test',
 stationId:'FACTORY_STATION',operation:'CODE',workPassRef:'work-pass://WORK-PASS:WORK-123:GO',actor:'GO'};
async function signed(url,body='',method='GET'){
 const timestamp=String(Date.now());
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+body)));
 const hex=[...sig].map(x=>x.toString(16).padStart(2,'0')).join('');
 return new Request(url,{method,headers:{
  'x-metropolis-greenhouse-timestamp':timestamp,'x-metropolis-greenhouse-signature':hex,
 },...(method==='POST'?{body}:{})});
}
function fixture(){
 const rows=new Map(),messages=[];
 const store={
  async create(x){if(rows.has(x.attemptId))return false;rows.set(x.attemptId,{...x});return true;},
  async get(id){return rows.get(id)||null;},
  async transition(id,from,to,patch={}){const x=rows.get(id);if(!x||!from.includes(x.state))return false;
   rows.set(id,{...x,...patch,state:to});return true;},
  async listByState(states,n){return [...rows.values()].filter(x=>states.includes(x.state)).slice(0,n);},
  async journal(){return [];}
 };
 return {rows,messages,store,env:{PIXIE_DELIVERY_QUEUE:{async send(x){messages.push(x);}},
  METROPOLIS_GREENHOUSE_RAIL_SECRET:secret}};
}
test('health is explicitly not ready when signed rail or route is missing',async()=>{
 const x=fixture(),w=createPixieWorker({store:x.store});
 const res=await w.fetch(new Request('https://greenhouse.test/station/health'),x.env);
 assert.equal(res.status,503);
 assert.equal((await res.json()).dependencies.route,false);
});
test('signed City intake accepted, forged caller denied, at-least-once queue deduped',async()=>{
 const x=fixture();let sent=0;
 const w=createPixieWorker({store:x.store,dispatch:async v=>{sent++;return {
  accepted:true,workId:v.workId,checkpointId:v.checkpointId,receiptRef:'receipt://1'};}});
 const bad=await w.fetch(new Request('https://greenhouse.test/station/intake',{method:'POST',body:JSON.stringify(job)}),x.env);
 assert.equal(bad.status,401);
 const ok=await w.fetch(await signed('https://greenhouse.test/station/intake',JSON.stringify(job),'POST'),x.env);
 assert.equal(ok.status,202);
 assert.equal((await ok.json()).execution,'NOT_ASSERTED');
 assert.equal(x.messages.length,1);
 const again=await w.fetch(await signed('https://greenhouse.test/station/intake',JSON.stringify(job),'POST'),x.env);
 assert.equal((await again.json()).duplicate,true);
 const message={body:{attemptId:'ATT-test'},retry(){throw new Error('unexpected retry');}};
 await w.queue({messages:[message,message]},x.env);
 assert.equal(sent,1);
 const inspected=await w.fetch(await signed('https://greenhouse.test/station/attempt/ATT-test'),x.env);
 assert.equal(inspected.status,200);
 assert.equal((await inspected.json()).record.state,'ACCEPTED');
});
test('signed intake cannot be used to retarget same attempt to a different Work',async()=>{
 const x=fixture(),w=createPixieWorker({store:x.store});
 await w.fetch(await signed('https://greenhouse.test/station/intake',JSON.stringify(job),'POST'),x.env);
 const changed={...job,workId:'WORK-999',checkpointId:'WORK-999:CP-01'};
 const rejected=await w.fetch(await signed('https://greenhouse.test/station/intake',JSON.stringify(changed),'POST'),x.env);
 assert.equal(rejected.status,400);
 assert.equal((await rejected.json()).reason,'PIXIE_ATTEMPT_COLLISION');
});

test('unknown queue attempt is retried to preserve poison-message evidence',async()=>{
 const x=fixture(),w=createPixieWorker({store:x.store});
 let retries=0;
 await w.queue({messages:[{body:{attemptId:'ATT-missing'},retry(){retries++;}}]},x.env);
 assert.equal(retries,1);
});
