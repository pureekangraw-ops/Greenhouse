import test from 'node:test';
import assert from 'node:assert/strict';
import {createGreenhouseMcp} from '../src/hub/greenhouse-mcp.mjs';
const scope={ownerId:'owner',sourceSystems:['greenhouse']};
const record=()=>({ownerId:'owner',sourceSystem:'greenhouse',attemptId:'a1',workId:'WORK-1',checkpointId:'WORK-1:CP-1',stationId:'FACTORY',operation:'build',state:'READBACK_VERIFIED',receivedAt:null,readbackAt:null,receiptRef:'r1',evidenceRef:'e1',payload:{secret:'hidden'},workPassRef:'private'});
const authorizeRead=async()=>({authorized:true,scope});
const reader={list:async({scope:seen,limit})=>{assert.equal(seen.ownerId,'owner');assert.ok([1,30].includes(limit));return [record()]},get:async({scope:seen,attemptId})=>{assert.equal(seen.ownerId,'owner');assert.equal(attemptId,'a1');return record()}};
const req=(name,args)=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
const parsed=r=>JSON.parse(r.result.content[0].text);
test('MCP denies default, missing scoped authority and unauthorized reads before source calls',async()=>{
 let reads=0;const r={get:async()=>{reads++;return record()}};
 for(const auth of [undefined,async()=>true,async()=>({authorized:true})]){
  const result=await createGreenhouseMcp({reader:r,authorizeRead:auth})(req('greenhouse_delivery_get',{attemptId:'a1'}));assert.equal(result.result.isError,true);
 }assert.equal(reads,0);
});
test('MCP standard discovery exposes only read tools and rejects extra arguments, overlimit and unsafe ids',async()=>{
 const mcp=createGreenhouseMcp({reader,authorizeRead});
 assert.deepEqual((await mcp({jsonrpc:'2.0',id:1,method:'tools/list'})).result.tools.map(t=>t.name),['greenhouse_delivery_list','greenhouse_delivery_get','greenhouse_result_get']);
 assert.deepEqual((await mcp({jsonrpc:'2.0',id:2,method:'initialize'})).result.capabilities,{tools:{}});
 for(const [name,args] of [['greenhouse_delivery_list',{limit:31}],['greenhouse_delivery_list',{limit:1,ownerId:'other'}],['greenhouse_delivery_get',{attemptId:'a'.repeat(129)}],['greenhouse_delivery_get',{attemptId:'https://evil'}],['greenhouse_submit',{}]]) assert.equal((await mcp(req(name,args))).result.isError,true);
});
test('MCP list is owner scoped, bounded and redacted; exact reads do not synthesize Work lifecycle',async()=>{
 const mcp=createGreenhouseMcp({reader,authorizeRead});
 const data=parsed(await mcp(req('greenhouse_delivery_list',{limit:1})));
 assert.deepEqual(data.coverage,{kind:'RECENT_WINDOW',complete:false,total:null});assert.equal(data.items[0].attemptId,'a1');assert.equal(data.items[0].state,'READBACK_VERIFIED');assert.equal(JSON.stringify(data).includes('private'),false);assert.equal(JSON.stringify(data).includes('hidden'),false);
 assert.equal(parsed(await mcp(req('greenhouse_delivery_get',{attemptId:'a1'}))).attemptId,'a1');
});
test('MCP rejects cross-owner, cross-id, malformed state and oversized source lists',async()=>{
 for(const alter of [r=>{r.ownerId='other'},r=>{r.attemptId='a2'},r=>{r.state='SUCCESS'}]){
  const value=record();alter(value);const mcp=createGreenhouseMcp({authorizeRead,reader:{get:async()=>value}});assert.equal((await mcp(req('greenhouse_delivery_get',{attemptId:'a1'}))).result.isError,true);
 }
 const mcp=createGreenhouseMcp({authorizeRead,reader:{list:async()=>[record(),record()]}});assert.equal((await mcp(req('greenhouse_delivery_list',{limit:1}))).result.isError,true);
});
test('MCP result unavailable by default; exact correlated proof required and no arbitrary fetch',async()=>{
 const mcp=createGreenhouseMcp({reader,authorizeRead});assert.equal(parsed(await mcp(req('greenhouse_result_get',{attemptId:'a1'}))).availability,'UNAVAILABLE');
 const proof={verified:true,sourceSystem:'greenhouse',attemptId:'a1',workId:'WORK-1',checkpointId:'WORK-1:CP-1',stationId:'FACTORY',operation:'build',receiptRef:'r1',evidenceRef:'e1',domainCompleted:false,observedAt:null};
 const good=createGreenhouseMcp({reader,authorizeRead,resultResolver:async()=>proof});assert.equal(parsed(await good(req('greenhouse_result_get',{attemptId:'a1'}))).domainCompleted,false);
 for(const field of ['attemptId','workId','checkpointId','receiptRef','evidenceRef','sourceSystem','stationId','operation']){
  const bad=createGreenhouseMcp({reader,authorizeRead,resultResolver:async()=>({...proof,[field]:'different'})});assert.equal((await bad(req('greenhouse_result_get',{attemptId:'a1'}))).result.isError,true);
 }
});

test('MCP negotiates Hub-compatible protocol and optional bounded list defaults with read-only annotations',async()=>{
 const mcp=createGreenhouseMcp({reader,authorizeRead});
 assert.equal((await mcp({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}})).result.protocolVersion,'2025-06-18');
 const listed=(await mcp({jsonrpc:'2.0',id:1,method:'tools/list'})).result.tools;
 assert.ok(listed.every(tool=>tool.annotations.readOnlyHint===true));
 assert.equal(parsed(await mcp(req('greenhouse_delivery_list',{}))).items.length,1);
});

test('MCP rejects multi-source scope before list, exact or result access despite same attempt ID',async()=>{
 let reads=0,proofReads=0;
 const mcp=createGreenhouseMcp({authorizeRead:async()=>({authorized:true,scope:{ownerId:'owner',sourceSystems:['greenhouse','other']}}),reader:{list:async()=>{reads++;return [record(),{...record(),sourceSystem:'other'}]},get:async()=>{reads++;return {...record(),sourceSystem:'other'}}},resultResolver:async()=>{proofReads++;return null}});
 for(const [name,args] of [['greenhouse_delivery_list',{}],['greenhouse_delivery_get',{attemptId:'a1'}],['greenhouse_result_get',{attemptId:'a1'}]]){
  const result=await mcp(req(name,args));assert.equal(result.result.isError,true);assert.deepEqual(parsed(result),{code:'READ_NOT_AUTHORIZED'});
 }
 assert.equal(reads,0);assert.equal(proofReads,0);
});
test('MCP rejects duplicate attempt identities in a list without returning partial rows',async()=>{
 const mcp=createGreenhouseMcp({authorizeRead,reader:{list:async()=>[record(),{...record(),state:'OUTCOME_UNKNOWN'}]}});
 const result=await mcp(req('greenhouse_delivery_list',{limit:2}));
 assert.equal(result.result.isError,true);assert.deepEqual(parsed(result),{code:'SOURCE_READBACK_REJECTED'});
});
