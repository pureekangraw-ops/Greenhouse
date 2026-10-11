import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createLocalModelAdapter} from '../src/pixie/local-model-adapter.mjs';
import {createPixieWorker} from '../src/pixie/transport-worker.mjs';

const secret='rail-test-secret';
const workId='WORK-LOCAL-MODEL-1';
const checkpointId=`${workId}:CP-01`;
const attemptId='ATT-local-model';
const modelOutput={summary:'The delivery has a receipt but no source readback.',
 findings:[{kind:'FACT',text:'A receipt is recorded.',evidenceRefs:[`pixie://delivery/${attemptId}`]}],
 recommendation:'Keep the Work open and request source readback.',confidence:'PROBABLE',suggestedAction:'HOLD_OPEN'};

async function startServer(handler){
 const server=createServer(handler);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();
 return {server,endpoint:`http://127.0.0.1:${address.port}`};
}
async function closeServer(server){await new Promise(resolve=>server.close(resolve));}
async function sign(url,body){
 const timestamp=String(Date.now());
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+body)));
 const hex=[...sig].map(x=>x.toString(16).padStart(2,'0')).join('');
 return new Request(url,{method:'POST',headers:{'content-type':'application/json',
  'x-metropolis-greenhouse-timestamp':timestamp,'x-metropolis-greenhouse-signature':hex},body});
}
function storeFixture(){
 const row={workId,checkpointId,attemptId,stationId:'FACTORY_STATION',operation:'CODE',
  workPassRef:'must-not-reach-model',actor:'GO',payload:{private:'must-not-reach-model'},state:'ACCEPTED',
  receivedAt:'2026-10-11T01:00:00.000Z',queuedAt:'2026-10-11T01:00:01.000Z',
  dispatchedAt:'2026-10-11T01:00:02.000Z',receiptRef:'receipt://factory/1',evidenceRef:null,
  domainCompleted:false,readbackAt:null,reason:null,retryCount:1};
 const rows=new Map([[attemptId,row]]),messages=[];
 const store={async get(id){return rows.has(id)?{...rows.get(id)}:null;},
  async create(){throw new Error('assessment must not create');},async transition(){throw new Error('assessment must not mutate');}};
 return {rows,messages,store};
}

test('local adapter speaks OpenAI-compatible JSON to a configurable loopback model endpoint',async()=>{
 let requestBody,authorization,path;
 const {server,endpoint}=await startServer(async(req,res)=>{
  path=req.url;authorization=req.headers.authorization;let raw='';for await(const chunk of req)raw+=chunk;
  requestBody=JSON.parse(raw);res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(modelOutput)}}]}));
 });
 try{
  const provider=createLocalModelAdapter({endpoint,model:'test-3b-q4',apiKey:'local-test-key'});
  const output=await provider({client:'PIXIE',stage:'EVALUATE',system:'system policy',task:'evaluate',
   work:{workId,checkpointId,attemptId,state:'ACCEPTED'},context:{receiptPresent:true},
   evidence:[{ref:`pixie://delivery/${attemptId}`,excerpt:'receipt only'}],signal:new AbortController().signal});
  assert.equal(path,'/v1/chat/completions');assert.equal(authorization,'Bearer local-test-key');
  assert.equal(requestBody.model,'test-3b-q4');assert.equal(requestBody.stream,false);
  assert.equal(output.summary,modelOutput.summary);
 }finally{await closeServer(server);}
});

test('signed Worker → runtime → local model stub roundtrip is read-only and scoped',async()=>{
 let requestBody='';let requestPath='';
 const {server,endpoint}=await startServer(async(req,res)=>{
  requestPath=req.url;let raw='';for await(const chunk of req)raw+=chunk;requestBody=raw;
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(modelOutput)}}]}));
 });
 try{
  const fixture=storeFixture();
  const worker=createPixieWorker({store:fixture.store});
  const before=structuredClone(fixture.rows.get(attemptId));
  const env={PIXIE_DELIVERY_QUEUE:{async send(msg){fixture.messages.push(msg);}},
   METROPOLIS_GREENHOUSE_RAIL_SECRET:secret,SHARED_LOCAL_MODEL_ENDPOINT:endpoint,
   SHARED_LOCAL_MODEL_NAME:'test-3b-q4',SHARED_LOCAL_MODEL_API_KEY:'local-test-key'};
  const body=JSON.stringify({stage:'EVALUATE'});
  const response=await worker.fetch(await sign(`https://greenhouse.test/station/attempt/${attemptId}/intelligence`,body),env);
  const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.status,'SHADOW_PROPOSED');
  assert.equal(result.providerSource,'LOCAL');assert.equal(result.fallbackReason,null);
  assert.equal(result.completionAssessment,'RECEIPT_ONLY');assert.equal(result.workLifecycle,'NOT_ASSERTED');
  assert.equal(result.executed,false);assert.equal(result.runtimeDecision,'RECEIPT_ONLY');
  assert.equal(requestPath,'/v1/chat/completions');assert.equal(fixture.messages.length,0);
  assert.deepEqual(fixture.rows.get(attemptId),before);
  assert.equal(requestBody.includes('must-not-reach-model'),false);
 }finally{await closeServer(server);}
});

test('unsigned assessment request is rejected before model inference',async()=>{
 let calls=0;
 const {server,endpoint}=await startServer((req,res)=>{calls++;res.writeHead(200);res.end('{}');});
 try{
  const fixture=storeFixture();const worker=createPixieWorker({store:fixture.store});
  const env={PIXIE_DELIVERY_QUEUE:{async send(){}},METROPOLIS_GREENHOUSE_RAIL_SECRET:secret,
   PIXIE_LOCAL_MODEL_ENDPOINT:endpoint,PIXIE_LOCAL_MODEL_NAME:'test'};
  const response=await worker.fetch(new Request(`https://greenhouse.test/station/attempt/${attemptId}/intelligence`,
   {method:'POST',body:JSON.stringify({stage:'ANALYZE'})}),env);
  assert.equal(response.status,401);assert.equal(calls,0);
 }finally{await closeServer(server);}
});

test('model endpoint rejects non-loopback plain HTTP and no configuration stays disabled',async()=>{
 assert.equal(createLocalModelAdapter({}),null);
 assert.throws(()=>createLocalModelAdapter({endpoint:'http://model.example',model:'test'}),/SHARED_LOCAL_MODEL_CONFIG_INVALID/);
});

test('Worker preserves attempt identity when Local fails over to LIGHT',async()=>{
 const fixture=storeFixture();let localCall,lightCall;
 const worker=createPixieWorker({store:fixture.store,
  localProvider:async call=>{localCall=call;throw new Error('local unavailable');},
  lightProvider:async call=>{lightCall=call;return modelOutput;}});
 const before=structuredClone(fixture.rows.get(attemptId));
 const body=JSON.stringify({stage:'EVALUATE'});
 const response=await worker.fetch(await sign(
  `https://greenhouse.test/station/attempt/${attemptId}/intelligence`,body),{
   PIXIE_DELIVERY_QUEUE:{async send(msg){fixture.messages.push(msg);}},
   METROPOLIS_GREENHOUSE_RAIL_SECRET:secret,
  });
 const result=await response.json();
 assert.equal(response.status,200);assert.equal(result.status,'SHADOW_PROPOSED');
 assert.equal(result.providerSource,'LIGHT');assert.equal(result.fallbackReason,'LOCAL_UNAVAILABLE');
 assert.equal(localCall.client,'PIXIE');assert.equal(lightCall.client,'PIXIE');
 assert.deepEqual(lightCall.work,localCall.work);
 assert.deepEqual(lightCall.context,localCall.context);
 assert.deepEqual(lightCall.evidence,localCall.evidence);
 assert.deepEqual(lightCall.fallback,{from:'LOCAL',reason:'LOCAL_UNAVAILABLE'});
 assert.deepEqual(fixture.rows.get(attemptId),before);assert.equal(fixture.messages.length,0);
});

test('PIXIE and DWARF adapter calls share one serialized endpoint/model lane',async()=>{
 let active=0,peak=0;const seen=[];
 const {server,endpoint}=await startServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),message=JSON.parse(body.messages[1].content);
  active++;peak=Math.max(peak,active);seen.push({client:message.client,workId:message.work.workId});
  await new Promise(resolve=>setTimeout(resolve,25));active--;
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(modelOutput)}}]}));
 });
 try{
  const pixie=createLocalModelAdapter({endpoint,model:'shared-model'});
  const dwarf=createLocalModelAdapter({endpoint,model:'shared-model'});
  const makeCall=(client,workId)=>({client,stage:'ANALYZE',system:'system',task:'task',
   work:{workId,checkpointId:`${workId}:CP-01`,attemptId:`ATT-${client}`},context:{},
   evidence:[{ref:`evidence://${client}`,excerpt:`${client} evidence`}],signal:new AbortController().signal});
  await Promise.all([pixie(makeCall('PIXIE','WORK-PIXIE')),dwarf(makeCall('DWARF','WORK-DWARF'))]);
  assert.equal(peak,1);
  assert.deepEqual(seen.map(x=>x.client).sort(),['DWARF','PIXIE']);
  assert.equal(seen.find(x=>x.client==='PIXIE').workId,'WORK-PIXIE');
  assert.equal(seen.find(x=>x.client==='DWARF').workId,'WORK-DWARF');
 }finally{await closeServer(server);}
});
