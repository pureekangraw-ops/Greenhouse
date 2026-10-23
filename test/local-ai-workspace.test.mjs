import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAITestConnector,handleLocalAITest} from '../src/greenhouse/local-ai-test.mjs';
import {demoEvents,filterEvents,eventHistory,acceptReadback} from '../greenhouse/workspace-model.mjs';
const origin='http://127.0.0.1:4173';
const session={actorId:'synthetic-owner',csrfToken:'synthetic-csrf'};
const request=(body,headers={})=>new Request(origin+'/api/greenhouse/local-ai',{method:'POST',headers:{origin,'content-type':'application/json','x-csrf-token':session.csrfToken,...headers},body:JSON.stringify(body)});
const input={model:'test-model',text:'อยากทำเว็บ token=synthetic-secret',syntheticOnly:true};
test('Local AI stays disconnected without any provider or destination',async()=>{
 const response=await handleLocalAITest(new Request(origin+'/api/greenhouse/local-ai'));
 assert.deepEqual(await response.json(),{configured:false,models:[],state:'DISCONNECTED'});
 assert.equal((await handleLocalAITest(request(input))).status,503);
});
test('existing runtime hook receives redacted synthetic text and fixed allowlisted model only',async()=>{
 let received;
 const connector=createLocalAITestConnector({models:['test-model'],provider:async call=>{received=call;return {reply:'ต้องการแนะนำร้านหรือขายสินค้าครับ?'};}});
 const response=await handleLocalAITest(request(input),{connector,session});assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.modelStatus,'RESPONDED');assert.equal(body.executed,false);assert.equal(body.syntheticOnly,true);assert.ok(body.elapsedMs>=0);
 assert.equal(received.model,'test-model');assert.ok(!received.text.includes('synthetic-secret'));
 for(const value of [{...input,syntheticOnly:false},{...input,model:'http://127.0.0.1:9999'},{...input,url:'http://private'},{...input,text:'x'.repeat(2001)}])assert.equal((await handleLocalAITest(request(value),{connector,session})).status,400);
});
test('provider use requires owner session, same origin and CSRF; configured is not connected',async()=>{
 let calls=0;const connector=createLocalAITestConnector({models:['test-model'],provider:async()=>{calls++;return {reply:'อยากทำอะไรครับ?'};}});
 assert.equal((await handleLocalAITest(request(input),{connector})).status,401);
 assert.equal((await handleLocalAITest(request(input,{'x-csrf-token':'wrong'}),{connector,session})).status,403);
 assert.equal((await handleLocalAITest(request(input,{origin:'https://other.invalid'}),{connector,session})).status,403);
 assert.equal(calls,0);
 const configured=await handleLocalAITest(new Request(origin+'/api/greenhouse/local-ai'),{connector,session});assert.equal((await configured.json()).state,'CONFIGURED_NOT_TESTED');assert.equal(calls,0);
});
test('provider errors, timeout and unsafe output return existing policy fallback without secret details',async()=>{
 for(const provider of [async()=>{throw Error('private provider credentials');},()=>new Promise(()=>{}),async()=>({reply:'completed successfully'})]){
  const connector=createLocalAITestConnector({models:['test-model'],provider,timeoutMs:10});
  const response=await handleLocalAITest(request(input),{connector,session});const body=await response.json();
  assert.ok(['UNAVAILABLE','INVALID_OUTPUT'].includes(body.modelStatus));assert.equal(body.executed,false);assert.ok(!JSON.stringify(body).includes('private provider credentials'));
 }
});
test('event filters and available history do not synthesize live metrics or mix demo data',()=>{
 assert.equal(filterEvents(demoEvents,{query:'demo-request-001'}).length,2);
 assert.equal(filterEvents(demoEvents,{category:'REVIEW_NOTE',source:'demo-shop'}).length,0);
 assert.equal(eventHistory(demoEvents,demoEvents[0]).length,2);
 assert.equal(filterEvents([]).length,0);
 assert.throws(()=>acceptReadback({items:demoEvents},'demo-request-001'));
 assert.throws(()=>acceptReadback({items:[{...demoEvents[0],evidenceScope:'OWNER_HTTP_READBACK'}]},'other-id'));
});
test('existing Node injection serves configured test panel without contacting a runtime URL',async()=>{
 const {createGreenhouseServer}=await import('../server.mjs');let calls=0;
 const localAIConnector=createLocalAITestConnector({models:['test-model'],provider:async()=>{calls++;return {reply:'อยากให้เว็บช่วยเรื่องอะไรครับ?'};}});
 const server=createGreenhouseServer({localAIConnector,ownerSessionResolver:async()=>session});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const status=await fetch(base+'/api/greenhouse/local-ai');assert.equal((await status.json()).state,'CONFIGURED_NOT_TESTED');assert.equal(calls,0);
  const response=await fetch(base+'/api/greenhouse/local-ai',{method:'POST',headers:{origin:base,'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify(input)});
  assert.equal(response.status,200);assert.equal((await response.json()).modelStatus,'RESPONDED');assert.equal(calls,1);
  assert.equal((await fetch(base+'/api/greenhouse/local-ai',{method:'POST',headers:{origin:base,'content-type':'application/json','x-csrf-token':session.csrfToken},body:'x'.repeat(8193)})).status,413);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
