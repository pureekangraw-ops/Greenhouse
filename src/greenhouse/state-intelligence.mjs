// Greenhouse owns operational projections only; HALL owns Work lifecycle.
export const EVENT_SCHEMA = 'GREENHOUSE_OPERATION_EVENT_V1';
const WORK = /^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const lanes = Object.freeze({
  HALL: new Set(['RECEIVED','HANDED_OFF','RETURN_REVIEW','COMPLETED','CANCELLED']),
  PIXIE: new Set(['QUEUED','DISPATCHING','DISPATCHED','ACCEPTED','WAITING_ROUTE','WAITING_CAPACITY','RETRY_WAIT','OUTCOME_UNKNOWN','READBACK_VERIFIED','DELIVERY_FAILED']),
  TOOL: new Set(['ACCEPTED','RUNNING','BLOCKED','FAILED','COMPLETED']),
});
const validId = s => typeof s === 'string' && ID.test(s);
const validTime = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
export function validateOperationEvent(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || x.schema !== EVENT_SCHEMA ||
    !validId(x.eventId) || !WORK.test(x.workId || '') || !validId(x.attemptId) ||
    typeof x.checkpointId !== 'string' || !x.checkpointId.startsWith(x.workId + ':CP-') ||
    x.checkpointId.length > 160 || !validId(x.stationId) || !validId(x.operation) ||
    !Object.hasOwn(lanes, x.source) || !lanes[x.source].has(x.state) || !validTime(x.observedAt) ||
    (x.occurredAt != null && !validTime(x.occurredAt)) ||
    (x.reason != null && !validId(x.reason)) ||
    (x.receiptRef != null && (typeof x.receiptRef !== 'string' || x.receiptRef.length > 512)) ||
    (x.evidenceRef != null && (typeof x.evidenceRef !== 'string' || x.evidenceRef.length > 512)))
    throw new TypeError('OPERATION_EVENT_INVALID');
  return Object.freeze({schema:EVENT_SCHEMA,eventId:x.eventId,workId:x.workId,checkpointId:x.checkpointId,
    attemptId:x.attemptId,stationId:x.stationId,operation:x.operation,source:x.source,state:x.state,
    observedAt:x.observedAt,occurredAt:x.occurredAt||null,reason:x.reason||null,
    receiptRef:x.receiptRef||null,evidenceRef:x.evidenceRef||null});
}
export function projectOperations(events,{now=new Date().toISOString(),stalledAfterMs=900000}={}) {
  if (!Array.isArray(events) || !validTime(now) || !Number.isSafeInteger(stalledAfterMs) || stalledAfterMs<1)
    throw new TypeError('OPERATION_INPUT_INVALID');
  const seen=new Map(), scopes=new Map();
  const normalized=events.map(validateOperationEvent).filter(e=>{
    const prior=seen.get(e.eventId);
    if (prior && JSON.stringify(prior)!==JSON.stringify(e)) throw new Error('EVENT_ID_COLLISION');
    if (prior) return false;
    seen.set(e.eventId,e); return true;
  }).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.eventId.localeCompare(b.eventId));
  const views=new Map();
  for (const e of normalized) {
    const scope=[e.workId,e.checkpointId,e.stationId,e.operation].join('|');
    const priorScope=scopes.get(e.attemptId);
    if (priorScope && priorScope!==scope) throw new Error('ATTEMPT_SCOPE_COLLISION');
    scopes.set(e.attemptId,scope);
    let v=views.get(e.attemptId);
    if (!v) {
      v={workId:e.workId,checkpointId:e.checkpointId,attemptId:e.attemptId,stationId:e.stationId,
        operation:e.operation,firstSeenAt:e.observedAt,lastSeenAt:e.observedAt,hall:'UNKNOWN',
        delivery:'UNKNOWN',execution:'UNKNOWN',waitingOn:null,blocker:null,receiptRef:null,
        evidenceRef:null,eventCount:0};
      views.set(e.attemptId,v);
    }
    v.lastSeenAt=e.observedAt;v.eventCount++;
    if(e.source==='HALL')v.hall=e.state;
    if(e.source==='PIXIE')v.delivery=e.state;
    if(e.source==='TOOL')v.execution=e.state;
    if(e.reason)v.blocker=e.reason;
    if(e.receiptRef)v.receiptRef=e.receiptRef;
    if(e.evidenceRef)v.evidenceRef=e.evidenceRef;
    if(e.source!=='HALL' && (e.state==='READBACK_VERIFIED'||e.state==='COMPLETED'))v.blocker=null;
  }
  const counts={attempts:0,running:0,waiting:0,incidents:0,hallClosed:0};
  for(const v of views.values()){
    counts.attempts++;
    if(v.hall==='CANCELLED'||v.hall==='COMPLETED'){v.waitingOn=null;counts.hallClosed++;}
    else{
      if(v.delivery==='WAITING_ROUTE'){v.waitingOn='ROUTE';v.blocker||='STATION_NOT_READY';}
      else if(v.delivery==='WAITING_CAPACITY'){v.waitingOn='CAPACITY';v.blocker||='CAPACITY_FULL';}
      else if(v.delivery==='OUTCOME_UNKNOWN'){v.waitingOn='READBACK';v.blocker||='DISPATCH_OUTCOME_UNKNOWN';}
      else if(v.delivery==='RETRY_WAIT')v.waitingOn='RETRY';
      else if(v.execution==='BLOCKED'){v.waitingOn='TOOL';v.blocker||='TOOL_BLOCKED';}
      else if(v.execution==='FAILED'||v.delivery==='DELIVERY_FAILED')v.waitingOn='INCIDENT';
      else if(v.execution==='COMPLETED'||v.delivery==='READBACK_VERIFIED')v.waitingOn='HALL_RETURN';
      else if(v.delivery==='ACCEPTED'||v.execution==='RUNNING'||v.execution==='ACCEPTED')v.waitingOn='TOOL_RESULT';
      else if(v.delivery==='QUEUED'||v.delivery==='DISPATCHING')v.waitingOn='PIXIE';
      else if(v.delivery==='DISPATCHED')v.waitingOn='DESTINATION_RECEIPT';
      else v.waitingOn='STATUS_EVIDENCE';
      if(['INCIDENT','READBACK','ROUTE'].includes(v.waitingOn))counts.incidents++;
      else if(v.waitingOn==='TOOL_RESULT')counts.running++;
      else counts.waiting++;
    }
    v.stale=Date.parse(now)-Date.parse(v.lastSeenAt)>=stalledAfterMs;
    v.confidence=v.stale?'STALE':'CURRENT';
    if(v.stale && v.waitingOn==='TOOL_RESULT')v.waitingOn='TOOL_HEARTBEAT';
  }
  return Object.freeze({observedAt:now,counts,items:[...views.values()].sort((a,b)=>a.workId.localeCompare(b.workId))});
}
// An existing capability snapshot guides routing; this does NOT grant authority.
export function planAuthorizedRoute({stationId,operation,workId,checkpointId,registry}={}) {
  if(!validId(stationId)||!validId(operation)||!WORK.test(workId||'')||
    typeof checkpointId!=='string'||!checkpointId.startsWith(workId+':CP-')||
    !registry||typeof registry!=='object')throw new TypeError('ROUTE_INPUT_INVALID');
  const station=registry[stationId];
  if(!station)return {action:'WAIT',reason:'STATION_UNREGISTERED'};
  if(!Array.isArray(station.capabilities)||!station.capabilities.includes(operation))
    return {action:'DENY',reason:'CAPABILITY_NOT_SUPPORTED'};
  if(station.status!=='READY')return {action:'WAIT',reason:'STATION_NOT_READY'};
  if(!Number.isSafeInteger(station.capacity)||station.capacity<1||
    !Number.isSafeInteger(station.active)||station.active<0)
    return {action:'WAIT',reason:'CAPACITY_UNVERIFIED'};
  if(station.active>=station.capacity)return {action:'WAIT',reason:'CAPACITY_FULL'};
  return {action:'DISPATCH',stationId,operation,workId,checkpointId};
}
