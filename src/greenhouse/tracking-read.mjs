// Source ports must enforce owner filtering in the producer BEFORE returning rows.
// Session/scope originate exclusively from the verified server session resolver.
export const opaque = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !/^(?:sk-|workpass|bearer|token|secret)/i.test(value);
export const timestamp = value => value === null || (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)));
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value) && !/(?:bearer\s|workpass|sk-[A-Za-z0-9]|(?:token|password|secret)\s*[:=])/i.test(value);
const TYPES = new Set(['BUSINESS_REQUEST','EVENT','WORK','DELIVERY_ATTEMPT','HUB_DELIVERY','EXECUTION_RECEIPT','ARTIFACT']);
const AVAILABILITY = new Set(['AVAILABLE','STALE','NOT_CONNECTED','UNRESOLVED','FORBIDDEN','UNAVAILABLE','NOT_FOUND']);
const VALUES = {
 DELIVERY:new Set(['PENDING_QUEUE','WAITING_QUEUE','QUEUED','DISPATCHING','WAITING_ROUTE','OUTCOME_UNKNOWN','ACCEPTED','READBACK_VERIFIED']),
 HUB_TRANSPORT:new Set(['RECEIVED','DISPATCHING','RESPONDED','UNKNOWN']),
 WORK_LIFECYCLE:new Set(['UNKNOWN','OPEN','PENDING','ACTIVE','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED','FAILED']),
 EXECUTION:new Set(['UNKNOWN','ACCEPTED','RUNNING','SUCCEEDED','FAILED','NOT_ASSERTED']),
 RESULT_AVAILABILITY:AVAILABILITY,
 BUSINESS_REQUEST:new Set(['UNKNOWN','RECEIVED','PENDING','OPEN','ACCEPTED','REJECTED','CLOSED']),
 EVENT:new Set(['OBSERVED','RECEIVED','UNKNOWN']),
};
export function validRef(ref){return ref && opaque(ref.sourceSystem) && TYPES.has(ref.resourceType) && opaque(ref.resourceId) && Object.keys(ref).length===3;}
export function verifiedTrackingScope(session){
 const scope=session?.trackingScope;
 return opaque(session?.actorId) && opaque(scope?.ownerId) && Array.isArray(scope?.sourceSystems) && scope.sourceSystems.length>0 && scope.sourceSystems.length<=16 && scope.sourceSystems.every(opaque) ? scope : null;
}
const sameRef=(a,b)=>a.sourceSystem===b.sourceSystem&&a.resourceType===b.resourceType&&a.resourceId===b.resourceId;
export function projectTrackingItem(row,scope,expectedRef=null){
 if(!row || row.ownerId!==scope.ownerId || !validRef(row.ref) || !scope.sourceSystems.includes(row.ref.sourceSystem) || (expectedRef&&!sameRef(row.ref,expectedRef)) || !text(row.title)) throw Error('TRACKING_READBACK_INVALID');
 if(!Array.isArray(row.statusFacts)||row.statusFacts.length>16) throw Error('TRACKING_READBACK_INVALID');
 const statusFacts=row.statusFacts.map(f=>{
  if(!f||!VALUES[f.dimension]?.has(f.value)||!timestamp(f.sourceUpdatedAt)||!timestamp(f.observedAt)) throw Error('TRACKING_READBACK_INVALID');
  return {dimension:f.dimension,value:f.value,sourceUpdatedAt:f.sourceUpdatedAt,observedAt:f.observedAt};
 });
 const p=row.provenance;
 if(!p || p.sourceSystem!==row.ref.sourceSystem || !opaque(p.sourceRef) || !timestamp(p.observedAt)||!AVAILABILITY.has(p.availability)||!(row.nextAction===null||text(row.nextAction))||!Array.isArray(row.links)||row.links.length) throw Error('TRACKING_READBACK_INVALID');
 const result=row.result ?? {availability:'UNAVAILABLE'};
 if(!AVAILABILITY.has(result.availability)) throw Error('TRACKING_READBACK_INVALID');
 const projectedResult={availability:result.availability};
 // Availability is only asserted with a source-owned exact identity proof, never a URL.
 if(result.availability==='AVAILABLE') {
  const proof=result.verification;
  if(!opaque(result.receiptRef)||!opaque(result.evidenceRef)||proof?.verified!==true||proof.sourceRef!==p.sourceRef||!validRef(proof.ref)||!sameRef(proof.ref,row.ref)) throw Error('TRACKING_RESULT_UNVERIFIED');
  projectedResult.receiptRef=result.receiptRef;projectedResult.evidenceRef=result.evidenceRef;
 }
 return {ref:{...row.ref},title:row.title,statusFacts,nextAction:row.nextAction,provenance:{sourceSystem:p.sourceSystem,sourceRef:p.sourceRef,observedAt:p.observedAt,availability:p.availability},result:projectedResult,links:[]};
}
const reply=(status,code)=>Response.json({code},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function handleTrackingRead(request,{reader=null,session=null,item=false}={}) {
 if(request.method!=='GET') return reply(405,'READ_ONLY');
 const url=new URL(request.url),params=url.searchParams,allowed=item?['sourceSystem','resourceType','resourceId']:['limit'];
 if([...params.keys()].some(key=>!allowed.includes(key)||params.getAll(key).length!==1)) return reply(400,'TRACKING_QUERY_INVALID');
 const limit=params.has('limit')?Number(params.get('limit')):30;
 const ref=item?Object.fromEntries(params):null;
 if(item?!validRef(ref):(!/^(?:[1-9]|[12][0-9]|30)$/.test(params.get('limit')??'30'))) return reply(400,'TRACKING_QUERY_INVALID');
 if(!reader||typeof reader[item?'get':'list']!=='function')return reply(503,'TRACKING_READER_UNAVAILABLE');
 if(!opaque(session?.actorId))return reply(401,'OWNER_SESSION_REQUIRED');
 const scope=verifiedTrackingScope(session);
 if(!scope||(ref&&!scope.sourceSystems.includes(ref.sourceSystem))) return reply(403,'TRACKING_SCOPE_REQUIRED');
 try {
  const raw=await reader[item?'get':'list']({session,...(item?{ref}:{limit})});
  if(raw?.ownerId!==scope.ownerId||!timestamp(raw.observedAt)||!Array.isArray(raw.items)||raw.items.length>(item?1:limit))throw Error('TRACKING_READBACK_INVALID');
  const items=raw.items.map(row=>projectTrackingItem(row,scope,ref));
  const keys=items.map(row=>JSON.stringify([row.ref.sourceSystem,row.ref.resourceType,row.ref.resourceId]));
  if(new Set(keys).size!==keys.length)throw Error('TRACKING_READBACK_INVALID');
  // A validated, authorized exact miss must revoke any previously displayed item.
  if(item&&items.length===0)return reply(404,'NOT_FOUND');
  return Response.json({schema:'greenhouse.tracking.v1',observedAt:raw.observedAt,coverage:{kind:'RECENT_WINDOW',complete:false,total:null},items},{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
 }catch{return reply(502,'TRACKING_READBACK_INVALID');}
}
