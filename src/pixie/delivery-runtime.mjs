// PIXIE drives delivery; it never owns Work identity or destination execution truth.
const WORK=/^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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
export function createPixieDeliveryRuntime({store,queue,dispatch,readback,clock=()=>new Date().toISOString()}={}){
  if(!store||typeof store.create!=='function'||typeof store.get!=='function'||
    typeof store.transition!=='function'||!queue||typeof queue.send!=='function')throw new TypeError('PIXIE_PORTS_REQUIRED');
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
  async function recover(limit=20){
    if(typeof store.listByState!=='function')throw new TypeError('PIXIE_RECOVERY_PORT_REQUIRED');
    const pending=await store.listByState(dispatch?['PENDING_QUEUE','WAITING_QUEUE','WAITING_ROUTE']:['PENDING_QUEUE','WAITING_QUEUE'],limit);
    const results=[];
    for(const item of pending)if((item.retryCount||0)<5)results.push(await queueAttempt(item.attemptId));
    const stale=await store.listByState(['DISPATCHING'],limit);
    for(const item of stale)if(Date.parse(clock())-Date.parse(item.dispatchedAt)>120000)
      await store.transition(item.attemptId,['DISPATCHING'],'OUTCOME_UNKNOWN',{reason:'DISPATCH_INTERRUPTED_READBACK_REQUIRED'});
    if(typeof readback==='function')for(const item of await store.listByState(['ACCEPTED','OUTCOME_UNKNOWN'],limit)){
      try{const reply=await readback(item);if(reply?.verified===true)await recordReadback({...reply,attemptId:item.attemptId});}catch{}
    }
    return results;
  }
  return Object.freeze({intake,consume,recordReadback,recover});
}
