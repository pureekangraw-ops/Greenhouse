import test from 'node:test';
import assert from 'node:assert/strict';
import { readMetropolisWork } from '../src/hub/metropolis-read.mjs';
import { createGreenhouseServer } from '../server.mjs';

const workId = 'WORK-GREENHOUSE-READBACK-TEST-001';
const checkpointId = workId + ':CP-01';
const nowMs = Date.parse('2026-10-09T11:40:32.539Z');
const record = {
  kind:'WORK_RECORD', workId, checkpointId, ownerSystem:'GO', state:'RECEIVED',
  updatedAt:new Date(nowMs-86400000).toISOString(), journeys:[], reports:[],
  workPass:{kind:'WORK_PASS',status:'ACTIVE',actor:'GO',workId,checkpointId,permissions:{actions:['read']}},
};
function arrival(data={}) {
  return {
    actor:'LIGHT', observedAt:new Date(nowMs).toISOString(),
    current:{works:[{workId,present:true,checkpointId,ownerSystem:'GO',authorizedActions:['read']}]},
    ...data,
  };
}
function workReply(data={}) {
  return {
    actor:'LIGHT', record, receipt:{operation:'READ_WORK',workId,checkpointId,
      readbackVerified:true,observedAt:new Date(nowMs).toISOString(),persisted:false},
    readbackVerified:true,ownerExecutionVerified:false,workTruthChanged:false,
    ...data,
  };
}
const rpc = structuredContent => Response.json({jsonrpc:'2.0',id:1,result:{structuredContent}});
function fakeFetch(responses=[rpc(arrival()),rpc(workReply())]) {
  const captured=[];
  return {captured,fetchImpl:async(url,options)=>{
    captured.push({url,options});
    const call=JSON.parse(options.body);
    const index=captured.length-1;
    assert.equal(call.params.name,index===0?'metropolis_arrive':'metropolis_work');
    return typeof responses[index]==='function'?responses[index]():responses[index];
  }};
}
const context = {workId,token:'only-in-server-env',now:()=>nowMs};

test('adapter refreshes arrival, checks the exact read grant, then calls read only',async()=>{
  const fake=fakeFetch();
  const report=await readMetropolisWork({...context,fetchImpl:fake.fetchImpl});
  assert.equal(fake.captured.length,2);
  assert.equal(fake.captured[0].url,'https://metropolis.pureekangraw.workers.dev/mcp');
  assert.equal(fake.captured[0].options.headers.authorization,'Bearer only-in-server-env');
  assert.deepEqual(JSON.parse(fake.captured[0].options.body).params,{name:'metropolis_arrive',arguments:{}});
  assert.deepEqual(JSON.parse(fake.captured[1].options.body).params,{name:'metropolis_work',arguments:{action:'read',workId}});
  assert.equal(report.workId,workId);
  assert.equal(report.checkpointId,checkpointId);
  assert.equal(report.ownerState,'RECEIVED');
  assert.equal(report.actor,'LIGHT');
  assert.equal(report.freshness,'CURRENT');
  assert.equal(report.confidence,'CONFIRMED');
  assert.equal(report.ownerExecutionVerified,false);
  assert.equal(report.receiptId,null);
  assert.deepEqual(report.evidence,[]);
  assert.equal(JSON.stringify(report).includes('only-in-server-env'),false);
  assert.equal(report.ownerSource,'Metropolis City Hall / GO');
});
test('fresh readback remains current when lifecycle updatedAt is old or absent',async()=>{
  const old=fakeFetch([rpc(arrival()),rpc(workReply({record:{...record,updatedAt:new Date(nowMs-7*86400000).toISOString()}}))]);
  const report=await readMetropolisWork({...context,fetchImpl:old.fetchImpl});
  assert.equal(report.freshness,'CURRENT');
  assert.equal(report.sourceUpdatedAt,new Date(nowMs-7*86400000).toISOString());
  const missing=fakeFetch([rpc(arrival()),rpc(workReply({record:{...record,updatedAt:'not-a-date'}}))]);
  const unknown=await readMetropolisWork({...context,fetchImpl:missing.fetchImpl});
  assert.equal(unknown.freshness,'CURRENT');
  assert.equal(unknown.sourceUpdatedAt,null);
  assert.equal(unknown.confidence,'CONFIRMED');
});
test('stale arrival or absent exact read permission denies before reading Work',async()=>{
  const stale=fakeFetch([rpc(arrival({observedAt:new Date(nowMs-120000).toISOString()})),rpc(workReply())]);
  await assert.rejects(readMetropolisWork({...context,fetchImpl:stale.fetchImpl}),{code:'ARRIVAL_UNVERIFIED'});
  assert.equal(stale.captured.length,1);
  const denied=fakeFetch([rpc(arrival({current:{works:[{workId,present:true,checkpointId,ownerSystem:'GO',authorizedActions:[]}]}})),rpc(workReply())]);
  await assert.rejects(readMetropolisWork({...context,fetchImpl:denied.fetchImpl}),{code:'WORK_NOT_GRANTED'});
  assert.equal(denied.captured.length,1);
});
test('mismatched actor, Work, checkpoint, Work Pass or receipt fails closed',async()=>{
  for(const data of [
    {actor:'GO'},
    {readbackVerified:false},
    {workTruthChanged:true},
    {record:{...record,workId:'WORK-FORGED'}},
    {record:{...record,checkpointId:'WORK-other:CP-01'}},
    {record:{...record,workPass:{...record.workPass,status:'REVOKED'}}},
    {receipt:{operation:'HANDOFF',workId,checkpointId,readbackVerified:true,observedAt:new Date(nowMs).toISOString(),persisted:false}},
  ]) {
    const fake=fakeFetch([rpc(arrival()),rpc(workReply(data))]);
    await assert.rejects(readMetropolisWork({...context,fetchImpl:fake.fetchImpl}),{code:'OWNER_READBACK_MISMATCH'});
  }
});
test('rejects missing token, bad Work ID, unauthorized and malformed responses',async()=>{
  const fake=fakeFetch();
  await assert.rejects(readMetropolisWork({...context,workId:'../etc/passwd',fetchImpl:fake.fetchImpl}),{code:'WORK_ID_INVALID'});
  await assert.rejects(readMetropolisWork({...context,token:'',fetchImpl:fake.fetchImpl}),{code:'OWNER_CONNECTION_REQUIRED'});
  assert.equal(fake.captured.length,0);
  await assert.rejects(readMetropolisWork({...context,fetchImpl:async()=>new Response('',{status:401})}),{code:'OWNER_AUTH_REQUIRED'});
  await assert.rejects(readMetropolisWork({...context,fetchImpl:async()=>new Response('bad',{status:200})}),{code:'OWNER_RESPONSE_INVALID'});
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
  assert.equal(read.status,401);
  assert.deepEqual(await read.json(),{code:'OWNER_SESSION_REQUIRED'});
  assert.equal((await fetch(base+'/api/office/work',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/office/work?workId=INVALID')).status,401);
  assert.equal((await fetch(base+'/api/office/work?workId='+workId,{headers:{origin:'https://evil.example'}})).status,403);
});
test('Greenhouse local server returns report only after actual-shaped authorized readback',async t=>{
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
  assert.equal(body.report.ownerExecutionVerified,false);
  assert.equal(JSON.stringify(body).includes(context.token),false);
  assert.equal(fake.captured.length,2);
});
