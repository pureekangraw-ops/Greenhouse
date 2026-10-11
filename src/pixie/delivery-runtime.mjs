import {planAuthorizedRoute} from '../greenhouse/state-intelligence.mjs';

// PIXIE drives delivery; it never owns Work identity or destination execution truth.
const WORK=/^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const INTELLIGENCE_STAGES=new Set(['ANALYZE','PLAN_ROUTE','RESOLVE','EVALUATE']);
const INTELLIGENCE_TASKS=Object.freeze({
  ANALYZE:'Analyze this existing PIXIE delivery record. Separate facts, hypotheses, and unknowns.',
  PLAN_ROUTE:'Assess the existing authorized route only. Do not select another station or operation.',
  RESOLVE:'Recommend a safe next step. Never create or resend an attempt; readback precedes retry.',
  EVALUATE:'Evaluate the recorded receipt and readback. Receipt alone is not domain or Work completion.',
});
function required(input) {
  if(!input || !WORK.test(input.workId||'') || typeof input.checkpointId!=='string' ||
    !input.checkpointId.startsWith(input.workId+':CP-') ||
    !ID.test(input.attemptId||'') || !ID.test(input.stationId||'') ||
    !ID.test(input.operation||'') || !(typeof input.workPassRef==='string' && input.workPassRef.length>0 && input.workPassRef.length<=512) ||
    !ID.test(input.actor||''))throw new TypeError('PIXIE_ENVELOPE_INVALID');
  return {workId:input.workId,checkpointId:input.checkpointId,attemptId:input.attemptId,
    stationId:input.stationId,operation:input.operation,workPassRef:input.workPassRef,actor:input.actor,payload:input.payload||{}};
}
const same=(a,b)=>JSON.stringify(a.payload||{})===JSON.stringify(b.payload||{}) && ['workId','checkpointId','attemptId','stationId','operation','workPassRef','actor'].every(k=>a[k]===b[k]);
function runtimeDecision(record,stage,routePlan){
  if(stage==='ANALYZE')return 'ADVISORY_ONLY';
  if(stage==='PLAN_ROUTE'){
    if(routePlan?.action==='DISPATCH')return 'PRESERVE_EXISTING_ROUTE';
    if(routePlan?.action==='DENY')return 'OWNER_REVIEW';
    return 'WAIT_FOR_EXISTING_ROUTE';
  }
  if(stage==='RESOLVE'){
    if(['ACCEPTED','OUTCOME_UNKNOWN','DISPATCHING'].includes(record.state))return 'REQUEST_READBACK';
    if(['PENDING_QUEUE','WAITING_QUEUE','QUEUED','WAITING_ROUTE'].includes(record.state))return 'WAIT';
    if(record.state==='READBACK_VERIFIED'&&record.domainCompleted!==true)return 'OWNER_REVIEW';
    return 'NO_AUTOMATIC_ACTION';
  }
  if(record.state!=='READBACK_VERIFIED')return record.receiptRef?'RECEIPT_ONLY':'NOT_VERIFIED';
  return record.domainCompleted===true?'DOMAIN_COMPLETION_REPORTED_BY_READBACK':'READBACK_ONLY_COMPLETION_NOT_PROVEN';
}
function completionAssessment(record){
  if(record.state!=='READBACK_VERIFIED')return record.receiptRef?'RECEIPT_ONLY':'NOT_VERIFIED';
  return record.domainCompleted===true?'DOMAIN_COMPLETION_REPORTED_BY_READBACK':'READBACK_ONLY_COMPLETION_NOT_PROVEN';
}
export function createPixieDeliveryRuntime({store,queue,dispatch,readback,intelligence=null,routeRegistry=null,clock=()=>new Date().toISOString()}={}){
  if(!store||typeof store.create!=='function'||typeof store.get!=='function'||
    typeof store.transition!=='function'||!queue||typeof queue.send!=='function')throw new TypeError('PIXIE_PORTS_REQUIRED');
  if(intelligence!==null&&typeof intelligence.run!=='function')throw new TypeError('PIXIE_INTELLIGENCE_PORT_INVALID');
  if(routeRegistry!==null&&(!routeRegistry||typeof routeRegistry!=='object'||Array.isArray(routeRegistry)))
    throw new TypeError('PIXIE_ROUTE_REGISTRY_INVALID');
  async function queueAttempt(attemptId){
    const record=await store.get(attemptId);
    if(!record || !['PENDING_QUEUE','WAITING_QUEUE','WAITING_ROUTE'].includes(record.state))return record;
    try {
      await queue.send({attemptId});
      await store.transition(attemptId,[record.state],'QUEUED',{reason:null,queuedAt:clock()});
    }catch{
      await store.transition(attemptId,[record.state],'WAITING_QUEUE',{reason:'QUEUE_UNAVAILABLE'});
    }
    return store.get(attemptId);
  }
  async function intake(input){
    // Only call after an existing City Hall authorizer has approved this exact Work/operation.
    const scope=required(input);
    const initial={...scope,state:'PENDING_QUEUE',receivedAt:clock(),queuedAt:null,
      retryCount:0,dispatchedAt:null,receiptRef:null,evidenceRef:null,reason:null};
    const inserted=await store.create(initial); // must be atomic and unique by attemptId.
    const existing=await store.get(scope.attemptId);
    if(!existing||!same(existing,scope))throw new Error('PIXIE_ATTEMPT_COLLISION');
    if(!inserted)return {duplicate:true,record:existing};
    return {duplicate:false,record:await queueAttempt(scope.attemptId)};
  }
  async function consume({attemptId}={}){
    if(!ID.test(attemptId||''))throw new TypeError('PIXIE_ATTEMPT_ID_INVALID');
    const current=await store.get(attemptId);
    if(!current)return {status:'UNKNOWN',reason:'ATTEMPT_NOT_FOUND'};
    if(!['QUEUED','PENDING_QUEUE','WAITING_QUEUE'].includes(current.state))
      return {status:current.state,duplicate:true}; // at-least-once queue deliveries are safe.
    // CAS claim is required: a simultaneous queue consumer must not dispatch twice.
    const claimed=await store.transition(attemptId,[current.state],'DISPATCHING',{reason:null,dispatchedAt:clock(),retryCount:(current.retryCount||0)+1});
    if(!claimed)return {status:'UNKNOWN',reason:'CLAIM_LOST'};
    if(typeof dispatch!=='function'){
      await store.transition(attemptId,['DISPATCHING'],'WAITING_ROUTE',{reason:'AUTHORIZED_ROUTE_NOT_CONNECTED'});
      return {status:'WAITING_ROUTE'};
    }
    try{
      const result=await dispatch(current);
      if(result?.notSent===true){
        await store.transition(attemptId,['DISPATCHING'],'WAITING_ROUTE',{reason:result.reason||'DESTINATION_NOT_READY'});
        return {status:'WAITING_ROUTE'};
      }
      if(result?.accepted===true && typeof result.receiptRef==='string' && result.receiptRef.trim() &&
        result.workId===current.workId && result.checkpointId===current.checkpointId){
        await store.transition(attemptId,['DISPATCHING'],'ACCEPTED',{receiptRef:result.receiptRef,dispatchedAt:clock()});
        if(result.verified===true && result.evidenceRef){
          await recordReadback({...result,attemptId,verified:true});
          return {status:'READBACK_VERIFIED',receiptRef:result.receiptRef};
        }
        return {status:'ACCEPTED',receiptRef:result.receiptRef};
      }
      // Even HTTP failure or an invalid response could mean a side effect happened.
      await store.transition(attemptId,['DISPATCHING'],'OUTCOME_UNKNOWN',{reason:'DISPATCH_READBACK_REQUIRED'});
      return {status:'OUTCOME_UNKNOWN'};
    }catch{
      await store.transition(attemptId,['DISPATCHING'],'OUTCOME_UNKNOWN',{reason:'DISPATCH_READBACK_REQUIRED'});
      return {status:'OUTCOME_UNKNOWN'};
    }
  }
  async function recordReadback({attemptId,workId,checkpointId,receiptRef,evidenceRef,verified,domainCompleted,cityBoundaryVerified=false}={}){
    const record=await store.get(attemptId);
    if(!record || record.workId!==workId || record.checkpointId!==checkpointId ||
      (record.receiptRef && record.receiptRef!==receiptRef) || typeof receiptRef!=='string' || !receiptRef.trim() || verified!==true || typeof evidenceRef!=='string' ||
      !evidenceRef.trim())throw new Error('PIXIE_READBACK_UNVERIFIED');
    if(record.state==='READBACK_VERIFIED')return {duplicate:true,record};
    if(!['ACCEPTED','OUTCOME_UNKNOWN'].includes(record.state) &&
      !(cityBoundaryVerified===true && ['QUEUED','WAITING_ROUTE'].includes(record.state)))
      throw new Error('PIXIE_READBACK_WRONG_STATE');
    const updated=await store.transition(attemptId,[record.state],'READBACK_VERIFIED',
      {receiptRef,evidenceRef,domainCompleted:domainCompleted===true,readbackAt:clock(),reason:null});
    if(!updated)throw new Error('PIXIE_READBACK_RACE');
    return {duplicate:false,record:await store.get(attemptId)};
  }
  async function assess({attemptId,stage}={}){
    if(!ID.test(attemptId||''))throw new TypeError('PIXIE_ATTEMPT_ID_INVALID');
    if(!INTELLIGENCE_STAGES.has(stage))throw new TypeError('PIXIE_INTELLIGENCE_STAGE_INVALID');
    const record=await store.get(attemptId);
    if(!record)return {schema:'PIXIE_INTELLIGENCE_RESULT_V1',stage,mode:'SHADOW',status:'ATTEMPT_NOT_FOUND',
      attemptId,executed:false,analysis:null,workLifecycle:'NOT_ASSERTED'};
    const observedAt=record.readbackAt||record.dispatchedAt||record.queuedAt||record.receivedAt;
    if(typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt)))
      return {schema:'PIXIE_INTELLIGENCE_RESULT_V1',stage,mode:'SHADOW',status:'EVIDENCE_TIME_UNKNOWN',
        workId:record.workId,checkpointId:record.checkpointId,attemptId:record.attemptId,
        executed:false,analysis:null,workLifecycle:'NOT_ASSERTED'};
    let routePlan={action:'WAIT',reason:'ROUTE_REGISTRY_UNKNOWN'};
    if(stage==='PLAN_ROUTE'&&routeRegistry){
      try{
        routePlan=planAuthorizedRoute({stationId:record.stationId,operation:record.operation,
          workId:record.workId,checkpointId:record.checkpointId,registry:routeRegistry});
      }catch{routePlan={action:'WAIT',reason:'ROUTE_CONTEXT_INVALID'};}
    }else if(record.state==='WAITING_ROUTE')routePlan={action:'WAIT',reason:record.reason||'STATION_NOT_READY'};
    const routeStatus=stage==='PLAN_ROUTE'
      ?routePlan.action==='DISPATCH'?'READY':routePlan.action==='DENY'||routePlan.action==='WAIT'?'NOT_READY':'UNKNOWN'
      :'UNKNOWN';
    const domainCompleted=record.state==='READBACK_VERIFIED'?record.domainCompleted===true:null;
    const safeSnapshot={
      source:'PIXIE_DELIVERY_RECORD',workId:record.workId,checkpointId:record.checkpointId,
      attemptId:record.attemptId,stationId:record.stationId,operation:record.operation,
      state:record.state,reason:record.reason||null,receivedAt:record.receivedAt||null,
      queuedAt:record.queuedAt||null,dispatchedAt:record.dispatchedAt||null,
      receiptRef:record.receiptRef||null,evidenceRef:record.evidenceRef||null,
      readbackAt:record.readbackAt||null,domainCompleted,
      routePlan:stage==='PLAN_ROUTE'?routePlan:null,
    };
    const evidence=[{ref:`pixie://delivery/${record.attemptId}`,excerpt:JSON.stringify(safeSnapshot)}];
    const context={routeStatus,stationId:record.stationId,operation:record.operation,
      receiptPresent:typeof record.receiptRef==='string'&&Boolean(record.receiptRef.trim()),
      readbackVerified:record.state==='READBACK_VERIFIED',domainCompleted};
    const base={schema:'PIXIE_INTELLIGENCE_RESULT_V1',stage,mode:'SHADOW',
      workId:record.workId,checkpointId:record.checkpointId,attemptId:record.attemptId,
      observedAt,evaluatedAt:clock(),executed:false,analysis:null,
      runtimeDecision:runtimeDecision(record,stage,routePlan),completionAssessment:completionAssessment(record),
      authorizedRoute:{stationId:record.stationId,operation:record.operation},
      routePlan:stage==='PLAN_ROUTE'?routePlan:null,
      workLifecycle:'NOT_ASSERTED'};
    if(!intelligence)return {...base,status:'NOT_CONFIGURED'};
    const result=await intelligence.run(stage,{workId:record.workId,checkpointId:record.checkpointId,
      attemptId:record.attemptId,state:record.state,observedAt,context,evidence});
    return {...base,...result,runtimeDecision:base.runtimeDecision,
      completionAssessment:base.completionAssessment,authorizedRoute:base.authorizedRoute,
      routePlan:base.routePlan,
      workLifecycle:'NOT_ASSERTED',executed:false};
  }
  async function recover(limit=20){
    if(typeof store.listByState!=='function')throw new TypeError('PIXIE_RECOVERY_PORT_REQUIRED');
    const pending=await store.listByState(dispatch?['PENDING_QUEUE','WAITING_QUEUE','WAITING_ROUTE']:['PENDING_QUEUE','WAITING_QUEUE'],limit);
    const results=[];
    for(const item of pending)if((item.retryCount||0)<5)results.push(await queueAttempt(item.attemptId));
    const stale=await store.listByState(['DISPATCHING'],limit);
    for(const item of stale)if(Date.parse(clock())-Date.parse(item.dispatchedAt)>120000)
      await store.transition(item.attemptId,['DISPATCHING'],'OUTCOME_UNKNOWN',{reason:'DISPATCH_INTERRUPTED_READBACK_REQUIRED'});
    if(typeof readback==='function')for(const item of await store.listByState(['ACCEPTED','OUTCOME_UNKNOWN'],limit)){
      try{
        const reply=await readback(item);
        if(reply?.verified===true)await recordReadback({...reply,attemptId:item.attemptId});
        else if(reply?.notSent===true){
          await store.transition(item.attemptId,[item.state],'WAITING_ROUTE',{reason:reply.reason||'DESTINATION_NOT_READY'});
          if((item.retryCount||0)<5)results.push(await queueAttempt(item.attemptId));
        }
      }catch{}
    }
    return results;
  }
  return Object.freeze({intake,consume,recordReadback,assess,recover});
}
