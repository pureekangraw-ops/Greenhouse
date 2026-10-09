import test from 'node:test';
import assert from 'node:assert/strict';
import { readMetropolisWork } from '../src/hub/metropolis-read.mjs';
import { createGreenhouseServer } from '../server.mjs';

const workId = 'WORK-123e4567-e89b-12d3-a456-426614174000';
const nowMs = Date.parse('2026-10-09T01:00:00Z');
const owner = {owner:'BIG',actingAgent:'GO',authority:'OWNER_DELEGATED'};
const record = {
  workId,checkpointId:workId+':CP-01',ownerSystem:'OBSERVATORY',state:'RECEIVED',
  updatedAt:new Date(nowMs-3000).toISOString(),
  journeys:[{baggageOut:{evidenceRefs:['evidence://example/snapshot'],receiptRefs:['receipt://example/readback']}}],
};
function success(data={}) {
  return Response.json({jsonrpc:'2.0',id:1,result:{
    structuredContent:{actor:'GO',readbackVerified:true,delegatedAccess:owner,record,...data}
  }});
}
function fakeFetch(response=success()){
  const captured=[];
  return {captured,fetchImpl:async(url,options)=>{
    captured.push({url,options}); return typeof response==='function'?response():response;
  }};
}
const context = {workId,token:'only-in-server-env',now:()=>nowMs};
test('Metropolis owner adapter uses signed delegate and only read action; labels source freshness correctly',async()=>{
  const fake=fakeFetch();
  const report=await readMetropolisWork({...context,fetchImpl:fake.fetchImpl});
  assert.equal(fake.captured.length,1);
  assert.equal(fake.captured[0].url,'https://metropolis.pureekangraw.workers.dev/mcp');
  assert.equal(fake.captured[0].options.headers.authorization,'Bearer only-in-server-env');
  const command=JSON.parse(fake.captured[0].options.body);
  assert.deepEqual(command.params,{name:'metropolis_work',arguments:{action:'read',workId}});
  assert.equal(report.workId,workId);
  assert.equal(report.checkpointId,record.checkpointId);
  assert.equal(report.ownerState,'RECEIVED');
  assert.equal(report.freshness,'CURRENT');
  assert.equal(report.confidence,'CONFIRMED');
  assert.equal(report.receiptId,'receipt://example/readback');
  assert.equal(JSON.stringify(report).includes('only-in-server-env'),false);
  assert.equal(report.ownerSource,'Metropolis City Hall / OBSERVATORY');
});
test('source update age is not equal to successful readback age',async()=>{
  const fake=fakeFetch(success({record:{...record,updatedAt:new Date(nowMs-86400000).toISOString()}}));
  const report=await readMetropolisWork({...context,fetchImpl:fake.fetchImpl});
  assert.equal(report.freshness,'STALE');
  assert.match(report.nextAction,/updated owner-source/);
});
test('unknown source timestamp and absent evidence do not become invented current truth',async()=>{
  const fake=fakeFetch(success({record:{...record,updatedAt:'not-a-date',journeys:[]}}));
  const report=await readMetropolisWork({...context,fetchImpl:fake.fetchImpl});
  assert.equal(report.freshness,'UNKNOWN');
  assert.equal(report.confidence,'UNKNOWN');
  assert.deepEqual(report.evidence,[]);
});
test('rejects incorrect owner, acting agent, scope relationship, mismatch and unverified readback',async()=>{
  for(const data of [
    {delegatedAccess:{...owner,owner:'ANOTHER'}},
    {delegatedAccess:{...owner,actingAgent:'LIGHT'}},
    {delegatedAccess:undefined},
    {record:{...record,workId:'WORK-FORGED'}},
    {record:{...record,checkpointId:''}},
    {readbackVerified:false},
  ]) {
    const fake=fakeFetch(success(data));
    await assert.rejects(readMetropolisWork({...context,fetchImpl:fake.fetchImpl}));
  }
});
test('rejects missing token, bad Work ID, unauthorized and malformed responses before reporting truth',async()=>{
  const fake=fakeFetch();
  await assert.rejects(readMetropolisWork({...context,workId:'../etc/passwd',fetchImpl:fake.fetchImpl}),{code:'WORK_ID_INVALID'});
  await assert.rejects(readMetropolisWork({...context,token:'',fetchImpl:fake.fetchImpl}),{code:'OWNER_CONNECTION_REQUIRED'});
  assert.equal(fake.captured.length,0);
  for(const response of [new Response('',{status:401}),new Response('',{status:403})]) {
    await assert.rejects(readMetropolisWork({...context,fetchImpl:fakeFetch(response).fetchImpl}),{code:'OWNER_AUTH_REQUIRED'});
  }
  await assert.rejects(readMetropolisWork({...context,fetchImpl:fakeFetch(new Response('bad',{status:200})).fetchImpl}),{code:'OWNER_RESPONSE_INVALID'});
});
test('Greenhouse local server serves static UI and denies unconfigured owner read and writes',async t=>{
  const server=createGreenhouseServer({token:'',now:()=>nowMs});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const html=await fetch(base+'/');
  assert.equal(html.status,200);
  assert.match(await html.text(),/Genome Hub/);
  const read=await fetch(base+'/api/office/work?workId='+encodeURIComponent(workId));
  assert.equal(read.status,503);
  assert.deepEqual(await read.json(),{code:'OWNER_CONNECTION_REQUIRED'});
  assert.equal((await fetch(base+'/api/office/work',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/office/work?workId=INVALID')).status,400);
  assert.equal((await fetch(base+'/api/office/work?workId='+workId,{headers:{origin:'https://evil.example'}})).status,403);
});
test('Greenhouse local server returns owner-source report only on validated readback',async t=>{
  const fake=fakeFetch();
  const server=createGreenhouseServer({token:context.token,now:context.now,fetchImpl:fake.fetchImpl});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/office/work?workId='+workId);
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.source,'METROPOLIS_OWNER_READBACK');
  assert.equal(body.report.workId,workId);
  assert.equal(JSON.stringify(body).includes(context.token),false);
  assert.equal(fake.captured.length,1);
});
