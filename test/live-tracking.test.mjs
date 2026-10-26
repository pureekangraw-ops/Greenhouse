import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import * as live from '../src/greenhouse/tracking-read.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
const now=Date.now(),origin='https://greenhouse.example.test';
const env={GREENHOUSE_UI_ORIGIN:origin,GREENHOUSE_ACCESS_TEAM_DOMAIN:'fixture.cloudflareaccess.com',GREENHOUSE_ACCESS_AUD:'greenhouse-app-only',GREENHOUSE_OWNER_EMAIL:'owner@example.test'};
function jwt(change={}){const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url');const p=Buffer.from(JSON.stringify({iss:'https://fixture.cloudflareaccess.com',aud:['greenhouse-app-only'],email:'owner@example.test',sub:'owner-verified-sub',exp:Math.floor(now/1000)+300,...change})).toString('base64url');return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');}
const req=(path='/api/greenhouse/tracking',token=jwt(),headers={})=>new Request(origin+path,{headers:{...(token?{'cf-access-jwt-assertion':token}:{}),...headers}});
const sourceRow=()=>({scope:{kind:'STATION',stationId:'GREENHOUSE_STATION'},sourceSystem:'greenhouse',attemptId:'a1',workRef:{workId:'WORK-1',resolution:'UNRESOLVED'},checkpointId:'CP-1',stationId:'FACTORY_STATION',operation:'CODE',state:'ACCEPTED',receivedAt:'2026-10-26T00:00:00Z',readbackAt:null,receiptRef:null,evidenceRef:null});
const scope={kind:'STATION',stationId:'GREENHOUSE_STATION'};
const jwks=async (url,options)=>{assert.equal(options.redirect,'manual');assert.equal(url,'https://fixture.cloudflareaccess.com/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
test('LIVE HTTP verifies real signed owner Access JWT before invoking the private station capability',async()=>{
 assert.equal(typeof live.createLiveTrackingHttp,'function');let calls=0;
 const binding={fetch:async request=>{calls++;assert.equal(request.url,'https://greenhouse.internal/mcp');assert.equal(request.headers.has('cf-access-jwt-assertion'),false);const input=await request.json();const data=input.params.name.endsWith('_list')?{scope,coverage:{kind:'RECENT_WINDOW',complete:false,total:null},items:[sourceRow()]}:sourceRow();return Response.json({jsonrpc:'2.0',id:input.id,result:{content:[{type:'text',text:JSON.stringify(data)}]}});}};
 const handle=live.createLiveTrackingHttp({env:{...env,GREENHOUSE_READ:binding},fetchImpl:jwks,now:()=>now});
 const response=await handle(req());assert.equal(response.status,200);const data=await response.json();assert.equal(data.scope.kind,'STATION');assert.equal(data.items[0].ref.resourceId,'a1');assert.deepEqual(data.items[0].workRef,{workId:'WORK-1',resolution:'UNRESOLVED'});assert.equal(data.items[0].result.availability,'UNAVAILABLE');assert.deepEqual(data.items[0].statusFacts.map(x=>x.dimension),['DELIVERY']);
 assert.equal((await handle(req('/api/greenhouse/tracking/item?sourceSystem=greenhouse&resourceType=DELIVERY_ATTEMPT&resourceId=a1'))).status,200);assert.equal(calls,2);
 for(const request of [req(undefined,null),req(undefined,jwt({aud:['go-brain-only']})),req(undefined,jwt({email:'intruder@example.test'})),req(undefined,jwt({exp:1})),req(undefined,jwt(),{origin:'https://evil.test'}),req(undefined,jwt(),{'sec-fetch-site':'cross-site'})])assert.ok([401,403].includes((await handle(request)).status));assert.equal(calls,2);
 assert.equal((await live.createLiveTrackingHttp({env:{...env},fetchImpl:jwks})(req())).status,503);
 assert.equal((await live.createLiveTrackingHttp({env:{GREENHOUSE_READ:binding},fetchImpl:jwks})(req())).status,503);
});
test('station delivery rendering tells the reader its scope and unresolved Work authority',async()=>{
 const {renderTrackingRow}=await import('../greenhouse/workspace-model.mjs');
 const html=renderTrackingRow({scope,ref:{sourceSystem:'greenhouse',resourceType:'DELIVERY_ATTEMPT',resourceId:'a1'},title:'Delivery a1',workRef:{workId:'WORK-1',resolution:'UNRESOLVED'},statusFacts:[],nextAction:null,provenance:{availability:'AVAILABLE'}});
 assert.match(html,/STATION/);assert.match(html,/UNRESOLVED/);
});
test('global station session denial clears all station rows while exact404 preserves neighbors',async()=>{
 const {itemsAfterReadFailure}=await import('../greenhouse/workspace-model.mjs');
 const a={scope,ref:{sourceSystem:'greenhouse',resourceType:'DELIVERY_ATTEMPT',resourceId:'a'}},b={scope,ref:{...a.ref,resourceId:'b'}},other={ref:{sourceSystem:'other',resourceType:'EVENT',resourceId:'z'}};
 for(const status of [401,403])assert.deepEqual(itemsAfterReadFailure([a,b,other],a.ref,status),[other]);
 assert.deepEqual(itemsAfterReadFailure([a,b,other],a.ref,404),[b,other]);
});
test('Node runtime uses the same signed-owner/private-capability adapter without synthetic session ports',async(t)=>{
 const {createServer}=await import('node:net');const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const base='http://127.0.0.1:'+port;let calls=0;
 const binding={async fetch(request){calls++;const input=await request.json();return Response.json({jsonrpc:'2.0',id:input.id,result:{content:[{type:'text',text:JSON.stringify({scope,coverage:{kind:'RECENT_WINDOW',complete:false,total:null},items:[sourceRow()]})}]}});}};
 const {createGreenhouseServer}=await import('../server.mjs');
 const server=createGreenhouseServer({liveTrackingEnv:{...env,GREENHOUSE_UI_ORIGIN:base,GREENHOUSE_READ:binding},fetchImpl:jwks,now:()=>now});await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 assert.equal((await fetch(base+'/api/greenhouse/tracking')).status,401);
 const response=await fetch(base+'/api/greenhouse/tracking',{headers:{'cf-access-jwt-assertion':jwt()}});assert.equal(response.status,200);assert.equal((await response.json()).scope.kind,'STATION');assert.equal(calls,1);
 assert.equal((await fetch(base+'/api/greenhouse/tracking',{headers:{origin:'https://evil.test','cf-access-jwt-assertion':jwt()}})).status,403);assert.equal(calls,1);
 assert.equal((await fetch(base+'/api/greenhouse/tracking',{method:'POST'})).status,405);
});
