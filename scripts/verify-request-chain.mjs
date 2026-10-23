// Run only after the named synthetic write and target deployment are approved.
// Uses existing customer session + GO admin credential; never creates credentials.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const source='https://yggmetro.com';
export async function verifyRequestChain({target,requestId,token,fetchImpl=fetch}) {
if(!/^https:\/\/(?:[a-z0-9-]+\.)?greenhouse-owner\.pages\.dev$/.test(target||'') ||
   !/^synthetic-greenhouse-[a-z0-9-]{1,64}$/.test(requestId||'') ||
   !/^[A-Za-z0-9_-]{32,200}$/.test(token||'')) {
 throw Error('Require approved Greenhouse Pages origin, exact synthetic-greenhouse-* request ID and existing YGG_ADMIN_TOKEN in protected environment');
}
let cookie;
async function call(path,body) {
 const response=await fetchImpl(source+path,{method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
  headers:{...(cookie?{cookie}:{}),...(body?{origin:source,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw Error('SOURCE_HTTP_'+response.status);
 cookie ||= response.headers.get('set-cookie')?.split(';')[0];
 return response.json();
}
// First ensure the deployed reader and existing admin credential work, before
// any synthetic writes. A missing exact request must return 404, not an auth,
// configuration, network or generic catch-all error.
const path='/api/greenhouse/requests/'+requestId;
const office=()=>fetchImpl(target+path,{headers:{authorization:'Bearer '+token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
const preflight=await office();
let absence;
try {absence=await preflight.json();} catch {throw Error('PREFLIGHT_EXPECTED_ABSENT_REQUEST');}
if(preflight.status!==404 || absence?.code!=='REQUEST_NOT_FOUND' || absence.ownerResponseVerified!==true)throw Error('PREFLIGHT_EXPECTED_ABSENT_REQUEST');
// A new customer session sees only its own empty request list, never other customers.
const empty=await call('/api/v1/requests');
assert.equal(empty.requests.length,0);
await call('/api/v1/requests/'+requestId,{brief:{goal:'SYNTHETIC Greenhouse integration acceptance; no customer data'}});
const submitted=await call('/api/v1/requests/'+requestId+'/confirm',{});
const replay=await call('/api/v1/requests/'+requestId+'/confirm',{});
const events=submitted.events.filter(e=>e.kind==='STATUS'&&e.from_value==='DRAFT'&&e.to_value==='SUBMITTED');
assert.equal(events.length,1);
assert.deepEqual(replay.events,submitted.events);
const response=await office();assert.equal(response.status,200);
const result=await response.json();assert.equal(result.items.length,1);
assert.equal(result.items[0].sourceEventId,events[0].event_id);
assert.equal(result.items[0].occurredAt,events[0].timestamp);
assert.equal(result.items[0].category,'REQUEST_SUBMITTED');
assert.equal(result.items[0].receiptId,null);
assert.deepEqual(result.items[0].evidence,['ygg_request_events:'+events[0].event_id]);
return {requestId,sourceEventId:events[0].event_id,sourceTimestamp:events[0].timestamp,
 source,target,producerConfirmReplay:true,officeReadback:true,receiptStatus:'MISSING',
 evidenceScope:'DEPLOYED_OWNER_HTTP_READBACK',hubDeliveryVerified:false};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
 const result=await verifyRequestChain({target:process.env.GREENHOUSE_APPROVED_ORIGIN,requestId:process.env.GREENHOUSE_APPROVED_SYNTHETIC_REQUEST_ID,token:process.env.YGG_ADMIN_TOKEN});
 console.log(JSON.stringify(result));
}
