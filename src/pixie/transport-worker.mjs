import { createD1PixieStore } from './d1-store.mjs';
import { createPixieDeliveryRuntime } from './delivery-runtime.mjs';

const text = value => typeof value==='string'?value.trim():'';
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});}
async function trustedRail(request,secret,body='',now=Date.now()){
  if(!text(secret))return {ok:false,status:503,reason:'RAIL_NOT_CONFIGURED'};
  const stamp=request.headers.get('x-metropolis-greenhouse-timestamp');
  const sig=request.headers.get('x-metropolis-greenhouse-signature');
  if(!stamp||!/^\d{13}$/.test(stamp)||Math.abs(now-Number(stamp))>300000||!sig||!/^[0-9a-f]{64}$/i.test(sig))
    return {ok:false,status:401,reason:'RAIL_SIGNATURE_INVALID'};
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signature=new Uint8Array(sig.match(/.{2}/g).map(pair=>parseInt(pair,16)));
  const good=await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(stamp+'.'+body));
  return good?{ok:true}:{ok:false,status:401,reason:'RAIL_SIGNATURE_INVALID'};
}
export function createPixieWorker({store,dispatch,clock=()=>new Date().toISOString()}={}){
  function runtime(env){
    const storage=store|| (env.PIXIE_DB?.prepare?createD1PixieStore(env.PIXIE_DB,{clock}):null);
    return storage&&env.PIXIE_DELIVERY_QUEUE?.send?
      createPixieDeliveryRuntime({store:storage,queue:env.PIXIE_DELIVERY_QUEUE,dispatch,clock}):null;
  }
  return {
    async fetch(request,env={}){
      const url=new URL(request.url);
      if(url.pathname==='/station/health'&&request.method==='GET'){
        const dependencies={db:Boolean(store||env.PIXIE_DB?.prepare),
          queue:Boolean(env.PIXIE_DELIVERY_QUEUE?.send),
          rail:Boolean(text(env.METROPOLIS_GREENHOUSE_RAIL_SECRET)),route:Boolean(dispatch)};
        return json({stationId:'GREENHOUSE_STATION',ownerSystem:'GREENHOUSE',
          status:Object.values(dependencies).every(Boolean)?'READY':'NOT_READY',
          dependencies,observedAt:clock()},Object.values(dependencies).every(Boolean)?200:503);
      }
      if(!['POST','GET'].includes(request.method))return json({reason:'METHOD_NOT_ALLOWED'},405);
      const process=runtime(env);
      if(!process)return json({reason:'PIXIE_RUNTIME_NOT_READY'},503);
      const body=request.method==='POST'?await request.text():'';
      if(body.length>16384)return json({reason:'BODY_TOO_LARGE'},413);
      const auth=await trustedRail(request,env.METROPOLIS_GREENHOUSE_RAIL_SECRET,body);
      if(!auth.ok)return json({reason:auth.reason},auth.status);
      if(url.pathname==='/station/intake'&&request.method==='POST'){
        let payload;
        try{payload=JSON.parse(body);}catch{return json({reason:'INPUT_JSON_INVALID'},400);}
        try{
          const result=await process.intake(payload);
          return json({status:result.record?.state||'UNKNOWN',workId:result.record?.workId,
            checkpointId:result.record?.checkpointId,attemptId:result.record?.attemptId,
            duplicate:result.duplicate,execution:'NOT_ASSERTED'},202);
        }catch(error){return json({reason:error.message==='PIXIE_ATTEMPT_COLLISION'?'PIXIE_ATTEMPT_COLLISION':'INTAKE_INVALID'},400);}
      }
      if(url.pathname==='/station/factory-readback'&&request.method==='POST'){
        let payload;
        try{payload=JSON.parse(body);}catch{return json({reason:'READBACK_JSON_INVALID'},400);}
        // The signed City sender must have verified the source-side Factory receipt.
        if(payload?.verified!==true || !payload?.receiptRef || !payload?.evidenceRef ||
          !payload?.workId || !payload?.checkpointId || !payload?.attemptId)
          return json({reason:'FACTORY_READBACK_REQUIRED'},400);
        try{
          const result=await process.recordReadback({...payload,cityBoundaryVerified:true});
          return json({status:result.record.state,workId:result.record.workId,
            checkpointId:result.record.checkpointId,attemptId:result.record.attemptId,
            receiptRef:result.record.receiptRef,evidenceRef:result.record.evidenceRef,
            duplicate:result.duplicate,workCompletion:'NOT_ASSERTED'},200);
        }catch(error){
          return json({reason:error.message==='PIXIE_READBACK_RACE'?'READBACK_RACE':'READBACK_SCOPE_UNVERIFIED'},409);
        }
      }
      if(url.pathname==='/station/overview'&&request.method==='GET'){
        const storage=store||createD1PixieStore(env.PIXIE_DB,{clock});
        if(typeof storage.overview!=='function')return json({reason:'OVERVIEW_UNAVAILABLE'},503);
        try{return json(await storage.overview(30));}
        catch{return json({reason:'OVERVIEW_QUERY_FAILED'},503);}
      }
      if(url.pathname.startsWith('/station/attempt/')&&request.method==='GET'){
        const attemptId=url.pathname.slice('/station/attempt/'.length);
        if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(attemptId))return json({reason:'ATTEMPT_ID_INVALID'},400);
        const storage=store||createD1PixieStore(env.PIXIE_DB,{clock});
        const record=await storage.get(attemptId);
        if(!record)return json({reason:'ATTEMPT_NOT_FOUND'},404);
        const journal=typeof storage.journal==='function'?await storage.journal(attemptId):[];
        return json({record,journal,workCompletion:'NOT_ASSERTED'});
      }
      return json({reason:'ROUTE_NOT_FOUND'},404);
    },
    async queue(batch,env={}){
      const process=runtime(env);
      for(const message of batch.messages){
        if(!process){message.retry();continue;}
        try{const result=await process.consume(message.body);
          if(result?.status==='UNKNOWN'&&result.reason==='ATTEMPT_NOT_FOUND')message.retry();
        }catch{message.retry();}
      }
    },
    async scheduled(_event,env={}){
      const process=runtime(env);
      if(!process)return {status:'NOT_READY'};
      const recovered=await process.recover(20);
      return {status:'OK',recovered:recovered.length};
    },
  };
}
// No implicit Metropolis adapter: production remains NOT_READY until the
// existing authorized City dispatch contract is explicitly wired and verified.
// Use the existing Metropolis station contract as the transport destination.
// The station must supply its own authorized dispatch URL and credential.
function existingCityDispatch(env) {
  return async record => {
    if (!env.METROPOLIS_STATION_DISPATCH_URL || !env.METROPOLIS_STATION_DISPATCH_TOKEN)
      return { notSent: true, reason: 'DESTINATION_NOT_CONFIGURED' };
    const destination = new URL(env.METROPOLIS_STATION_DISPATCH_URL);
    if (destination.protocol !== 'https:') return { notSent: true, reason: 'DESTINATION_NOT_HTTPS' };
    const reply = await fetch(destination, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + env.METROPOLIS_STATION_DISPATCH_TOKEN,
      },
      body: JSON.stringify({
        workId: record.workId, checkpointId: record.checkpointId,
        attemptId: record.attemptId, stationId: record.stationId,
        operation: record.operation, workPassRef: record.workPassRef,
        actor: record.actor,
      }),
      redirect: 'error',
    });
    if (!reply.ok) return { accepted: false };
    const result = await reply.json();
    return result;
  };
}
const worker = {
  async fetch(request, env, context) {
    return createPixieWorker({ dispatch: existingCityDispatch(env) }).fetch(request, env, context);
  },
  async queue(batch, env, context) {
    return createPixieWorker({ dispatch: existingCityDispatch(env) }).queue(batch, env, context);
  },
  async scheduled(event, env, context) {
    return createPixieWorker({ dispatch: existingCityDispatch(env) }).scheduled(event, env, context);
  },
};
export default worker;
