import test from 'node:test';
import assert from 'node:assert/strict';
import {testDeviceAI,DEVICE_AI_BASE} from '../greenhouse/device-ai.mjs';
const input={model:'reported-model-id',text:'Synthetic question',protocol:'chat-completions-compatible',syntheticOnly:true,protocolConfirmed:true};
test('device test refuses unconfirmed contract/input without a fetch',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;};
 for(const invalid of [{protocol:''},{protocolConfirmed:false},{syntheticOnly:false},{model:''}])await assert.rejects(testDeviceAI({...input,...invalid,fetchImpl}),{code:'DEVICE_CONFIG_REQUIRED'});
 assert.equal(calls,0);
});
test('one explicit inference targets only owner-reported device loopback with no credentials/discovery',async()=>{
 let calls=0;
 const result=await testDeviceAI({...input,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,DEVICE_AI_BASE+'/chat/completions');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.mode,'cors');assert.equal(options.referrerPolicy,'no-referrer');
  assert.deepEqual(Object.keys(options.headers),['content-type']);const body=JSON.parse(options.body);assert.equal(body.stream,false);assert.equal(body.messages.length,1);
  return Response.json({choices:[{message:{content:'Synthetic reply'}}]});
 }});
 assert.equal(calls,1);assert.equal(result.reply,'Synthetic reply');assert.equal(result.reachable,true);assert.equal(result.executed,false);
});
test('reachable protocol failure differs from blocked/unreachable; errors never expose server body',async()=>{
 for(const [response,code] of [[new Response('private',{status:404}),'DEVICE_HTTP_404'],[Response.json({reply:'not verified'}),'DEVICE_PROTOCOL_UNVERIFIED'],[new Response('x'.repeat(65537)),'DEVICE_RESPONSE_TOO_LARGE']])await assert.rejects(testDeviceAI({...input,fetchImpl:async()=>response}),e=>e.code===code&&e.reachable===true&&!e.message.includes('private'));
 await assert.rejects(testDeviceAI({...input,fetchImpl:async()=>{throw Error('browser policy detail');}}),{code:'DEVICE_BLOCKED_OR_UNREACHABLE',reachable:false});
});
test('bounded device timeout and explicit cancellation abort the pending test',async()=>{
 const pending=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 await assert.rejects(testDeviceAI({...input,fetchImpl:pending,timeoutMs:5}),{code:'TIMEOUT'});
 const controller=new AbortController();const run=testDeviceAI({...input,fetchImpl:pending,signal:controller.signal});controller.abort();await assert.rejects(run,{code:'CANCELLED'});
});
