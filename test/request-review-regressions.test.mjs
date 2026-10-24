import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {handleOwnerRequestRead} from '../src/greenhouse/request-owner-http.mjs';
import {verifyRequestChain} from '../scripts/verify-request-chain.mjs';
const authorization='Bearer synthetic-owner-token-at-least-32-bytes';
const target='https://greenhouse-owner.pages.dev';
const requestId='synthetic-greenhouse-review';
const request=()=>new Request(target+'/api/greenhouse/requests/'+requestId,{headers:{authorization}});

test('ambiguous source 404 cannot become verified absence or allow runner writes',async()=>{
 const cases=[
  ()=>new Response('<h1>Not Found</h1>',{status:404,headers:{'content-type':'text/html'}}),
  ()=>Response.json({code:'REQUEST_NOT_FOUND'},{status:404}),
  ()=>Response.json({ok:true,code:'REQUEST_NOT_FOUND'},{status:404}),
  ()=>Response.json({ok:false,code:'NOT_FOUND'},{status:404}),
  ()=>Response.json({ok:false,code:'REQUEST_NOT_FOUND',unexpected:true},{status:404}),
  ()=>new Response(JSON.stringify({ok:false,code:'REQUEST_NOT_FOUND'}),{status:404,headers:{'content-type':'text/html'}}),
 ];
 for(const upstream of cases){
  const response=await handleOwnerRequestRead(request(),requestId,{fetchImpl:async()=>upstream()});
  assert.equal(response.status,502);
  assert.notEqual((await response.json()).ownerResponseVerified,true);
  let sourceCalls=0;
  await assert.rejects(verifyRequestChain({target,requestId,token:authorization.slice(7),fetchImpl:async(url)=>{
   if(url.startsWith('https://yggmetro.com')){sourceCalls++;throw Error('unexpected source access');}
   return handleOwnerRequestRead(request(),requestId,{fetchImpl:async()=>upstream()});
  }}),/PREFLIGHT_EXPECTED_ABSENT_REQUEST/);
  assert.equal(sourceCalls,0,'no session creation, source read or write after ambiguous absence');
 }
});

test('typed GO absence is distinguished from unverified and legacy 404s',async()=>{
 const response=await handleOwnerRequestRead(request(),requestId,{fetchImpl:async()=>Response.json({ok:false,code:'REQUEST_NOT_FOUND'},{status:404})});
 assert.equal(response.status,404);
 assert.deepEqual(await response.json(),{code:'REQUEST_NOT_FOUND',ownerResponseVerified:true});
 for(const reply of [()=>Response.json({code:'REQUEST_NOT_FOUND'},{status:404}),()=>new Response('<h1>404</h1>',{status:404})]){
  let calls=0;
  await assert.rejects(verifyRequestChain({target,requestId,token:authorization.slice(7),fetchImpl:async()=>{calls++;return reply();}}),/PREFLIGHT_EXPECTED_ABSENT_REQUEST/);
  assert.equal(calls,1);
 }
});

function raw(port,method,path){return new Promise((resolve,reject)=>{
 const req=httpRequest({hostname:'127.0.0.1',port,method,path},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
 req.on('error',reject);req.end();
});}
test('TRACE and malformed targets cannot crash local request readback server',async()=>{
 const serverUrl=new URL('../server.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {createGreenhouseServer} from ${JSON.stringify(serverUrl)};const s=createGreenhouseServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`],{stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 try{
  const port=await new Promise((resolve,reject)=>{child.once('exit',code=>reject(Error('server exited '+code+': '+stderr)));child.stdout.once('data',data=>resolve(Number(data.toString().trim())));});
  for(const method of ['TRACE','POST','OPTIONS','DELETE']){
   assert.equal(await raw(port,method,'/api/greenhouse/requests/synthetic-greenhouse-review'),405);
   assert.equal(await raw(port,'GET','/api/greenhouse/status'),200);
  }
  assert.equal(await raw(port,'GET','http://['),400);
  assert.equal(await raw(port,'GET','/api/greenhouse/status'),200);
  assert.equal(child.exitCode,null);
 }finally{if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
});

test('Pages method guard and cross-origin denial remain unchanged',async()=>{
 const {onRequest}=await import('../functions/api/greenhouse/requests/[requestId].js');
 assert.equal((await onRequest({request:{method:'TRACE'},params:{requestId}})).status,405);
 const foreign=new Request(target+'/api/greenhouse/requests/'+requestId,{headers:{authorization,origin:'https://office.example'}});
 let calls=0;
 const response=await handleOwnerRequestRead(foreign,requestId,{fetchImpl:async()=>{calls++;throw Error('unexpected');}});
 assert.equal(response.status,403);assert.equal(calls,0);
});
