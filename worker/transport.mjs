// PIXIE runtime: bounded, idempotent downstream execution. Metropolis owns authority and Work truth.
const reply = (value, status=200) => Response.json(value,{status});
const valid = x => typeof x === 'string' && x.trim().length>0;
const receiptId = id => 'GH:'+id;
const configured = env => !!(env.PIXIE_DB && env.PIXIE_DELIVERY_QUEUE && valid(env.METROPOLIS_GREENHOUSE_TRANSPORT_SECRET));
// A configured URL is not proof of a working downstream adapter. Keep the station closed until verified dispatch/readback exists.
const operational = () => false;
const messageBody = x => ({receiptId:x.receiptId,workId:x.workId,checkpointId:x.checkpointId,targetStation:x.targetStation,operation:x.operation,workPassRef:x.workPassRef,actingActor:x.actingActor,payload:x.payload||{}});
export default {
 async fetch(request,env) {
  if(!configured(env)) return reply({error:'TRANSPORT_BINDINGS_UNAVAILABLE'},503);
  if(request.headers.get('authorization')!=='Bearer '+env.METROPOLIS_GREENHOUSE_TRANSPORT_SECRET) return reply({error:'UNAUTHORIZED'},401);
  const url=new URL(request.url);
  if(request.method==='GET' && url.pathname==='/station/health') return reply({status:operational(env)?'READY':'NOT_READY',stationId:'GREENHOUSE_STATION',railId:'RAIL_GREENHOUSE',ownerSystem:'GREENHOUSE',observedAt:new Date().toISOString()},operational(env)?200:503);
  if(request.method==='POST' && url.pathname==='/station/receive'){
   if(!operational(env)) return reply({error:'DOWNSTREAM_NOT_CONFIGURED'},503);
   let x;try{x=await request.json()}catch{return reply({error:'INVALID_JSON'},400)}
   if(!['transportId','workId','checkpointId','targetStation','operation','workPassRef','actingActor'].every(k=>valid(x?.[k]))||x.targetStation!=='FACTORY_STATION')return reply({error:'INVALID_WORK_CONTEXT_OR_TARGET'},400);
   const id=receiptId(x.transportId);
   const existing=await env.PIXIE_DB.prepare('SELECT * FROM pixie_deliveries WHERE idempotency_key=?').bind(x.transportId).first();
   if(existing){
    if(existing.work_id!==x.workId||existing.checkpoint_id!==x.checkpointId||existing.destination_station!==x.targetStation||existing.operation!==x.operation)return reply({error:'IDEMPOTENCY_CONFLICT'},409);
    return reply({accepted:existing.status!=='PENDING'&&existing.status!=='FAILED'&&existing.status!=='UNKNOWN',receiptId:id,workId:x.workId,checkpointId:x.checkpointId,status:existing.status},existing.status==='PENDING'||existing.status==='FAILED'||existing.status==='UNKNOWN'?503:202);
   }
   try{
    await env.PIXIE_DB.prepare('INSERT INTO pixie_deliveries (delivery_id,work_id,checkpoint_id,source_station,destination_station,operation,status,idempotency_key) VALUES (?,?,?,?,?,?,?,?)').bind(id,x.workId,x.checkpointId,'METROPOLIS',x.targetStation,x.operation,'PENDING',x.transportId).run();
    await env.PIXIE_DELIVERY_QUEUE.send(messageBody({...x,receiptId:id}));
    await env.PIXIE_DB.prepare("UPDATE pixie_deliveries SET status='QUEUED',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?").bind(id).run();
    return reply({accepted:true,receiptId:id,workId:x.workId,checkpointId:x.checkpointId},202);
   }catch{return reply({error:'DELIVERY_NOT_CONFIRMED',receiptId:id},503)}
  }
  if(request.method==='GET'&&url.pathname.startsWith('/station/readback/')){
   const id=decodeURIComponent(url.pathname.slice('/station/readback/'.length));
   const row=await env.PIXIE_DB.prepare('SELECT * FROM pixie_deliveries WHERE delivery_id=?').bind(id).first();
   if(!row)return reply({error:'RECEIPT_NOT_FOUND'},404);
   return reply({receiptId:id,workId:row.work_id,checkpointId:row.checkpoint_id,targetStation:row.destination_station,status:row.status,verified:row.status==='DELIVERED'&&valid(row.receipt_ref),evidenceRef:row.status==='DELIVERED'?row.receipt_ref:null});
  }
  return reply({error:'NOT_FOUND'},404);
 },
 async queue(batch,env){
  for(const msg of batch.messages){
   const x=msg.body||{};
   if(!valid(x.receiptId)){msg.ack();continue}
   const row=await env.PIXIE_DB.prepare('SELECT * FROM pixie_deliveries WHERE delivery_id=?').bind(x.receiptId).first();
   if(!row){msg.ack();continue}
   if(row.status==='DELIVERED'){msg.ack();continue}
   if(!operational(env)||x.targetStation!=='FACTORY_STATION'){msg.retry();continue}
   // Downstream protocol must be verified before dispatch. Never guess Factory's command API.
   await env.PIXIE_DB.prepare("UPDATE pixie_deliveries SET status='UNKNOWN',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?").bind(x.receiptId).run();
   msg.ack();
  }
 }
};
