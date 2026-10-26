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

// Separate application authority: no GO Brain OAuth, Office token or caller
// supplied owner hints can authenticate this Greenhouse browser session.
export function createLiveTrackingHttp({env={},fetchImpl=fetch,now=Date.now}={}) {
 const origin=env.GREENHOUSE_UI_ORIGIN,team=env.GREENHOUSE_ACCESS_TEAM_DOMAIN,aud=env.GREENHOUSE_ACCESS_AUD,owner=env.GREENHOUSE_OWNER_EMAIL;
 const configured=typeof origin==='string'&&(/^[Hh][Tt][Tt][Pp][Ss]:\/\/[^/]+$/.test(origin)||/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))&&typeof team==='string'&&/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)&&typeof aud==='string'&&aud.length>0&&typeof owner==='string'&&owner.includes('@');
 let keys=null,keysAt=0;
 const decode=v=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(v.length/4)*4,'=')),c=>c.charCodeAt(0));
 const bounded=async(response,max)=>{
  const reader=response.body?.getReader();if(!reader)throw Error('EMPTY_BODY');let size=0,raw='';const decoder=new TextDecoder();
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('BODY_LIMIT');}raw+=decoder.decode(value,{stream:true});}return raw+decoder.decode();}finally{reader.releaseLock();}
 };
 async function verify(request){
  const token=request.headers.get('cf-access-jwt-assertion');if(!token||token.length>16384)return false;
  try{
   const parts=token.split('.');if(parts.length!==3)return false;
   const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1]))),seconds=Math.floor(now()/1000);
   if(header.alg!=='RS256'||!opaque(header.kid)||claims.iss!=='https://'+team||![].concat(claims.aud||[]).includes(aud)||typeof claims.email!=='string'||claims.email.toLowerCase()!==owner.toLowerCase()||!opaque(claims.sub)||!Number.isFinite(claims.exp)||claims.exp<=seconds||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>seconds)))return false;
   if(!keys||now()-keysAt>300000||!keys.some(k=>k.kid===header.kid)){
    const response=await fetchImpl('https://'+team+'/cdn-cgi/access/certs',{redirect:'manual',signal:AbortSignal.timeout(5000),cache:'no-store'});
    if(!response.ok)return false;const data=JSON.parse(await bounded(response,65536));if(!Array.isArray(data.keys)||data.keys.length>32)return false;keys=data.keys;keysAt=now();
   }
   const matches=keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));if(matches.length!==1)return false;
   const key=await crypto.subtle.importKey('jwk',matches[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
   return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{return false;}
 }
 const scope={kind:'STATION',stationId:'GREENHOUSE_STATION'};
 const validScope=value=>value?.kind===scope.kind&&value.stationId===scope.stationId&&Object.keys(value).length===2;
 const stateValues=VALUES.DELIVERY;
 function project(row,observedAt,expectedId=null){
  if(!row||!validScope(row.scope)||row.sourceSystem!=='greenhouse'||!(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.attemptId))||(expectedId&&row.attemptId!==expectedId)||row.workRef?.resolution!=='UNRESOLVED'||!opaque(row.workRef.workId)||!opaque(row.checkpointId)||!opaque(row.stationId)||!opaque(row.operation)||!stateValues.has(row.state)||!timestamp(row.receivedAt)||!timestamp(row.readbackAt))throw Error('SOURCE_INVALID');
  for(const key of ['receiptRef','evidenceRef'])if(row[key]!=null&&!opaque(row[key]))throw Error('SOURCE_INVALID');
  return {scope:{...scope},ref:{sourceSystem:'greenhouse',resourceType:'DELIVERY_ATTEMPT',resourceId:row.attemptId},title:'Delivery '+row.attemptId,workRef:{workId:row.workRef.workId,resolution:'UNRESOLVED'},statusFacts:[{dimension:'DELIVERY',value:row.state,sourceUpdatedAt:row.readbackAt??row.receivedAt,observedAt}],nextAction:null,provenance:{sourceSystem:'greenhouse',sourceRef:row.attemptId,observedAt,availability:'AVAILABLE'},result:{availability:'UNAVAILABLE'},links:[]};
 }
 return async request=>{
  const url=new URL(request.url),item=url.pathname==='/api/greenhouse/tracking/item',status=url.pathname==='/api/greenhouse/status';
  if(!['/api/greenhouse/tracking','/api/greenhouse/tracking/item','/api/greenhouse/status'].includes(url.pathname))return reply(404,'NOT_FOUND');
  if(request.method!=='GET')return reply(405,'READ_ONLY');
  if(!configured)return reply(503,'OWNER_SESSION_UNAVAILABLE');
  if(url.origin!==origin||request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==origin))return reply(403,'ORIGIN_DENIED');
  const allowed=status?[]:item?['sourceSystem','resourceType','resourceId']:['limit'];
  if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))return reply(400,'TRACKING_QUERY_INVALID');
  const limit=Number(url.searchParams.get('limit')??30),ref=item?Object.fromEntries(url.searchParams):null;
  if(!status&&(item?(!validRef(ref)||ref.sourceSystem!=='greenhouse'||ref.resourceType!=='DELIVERY_ATTEMPT'||!(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(ref.resourceId))):!/^([1-9]|[12][0-9]|30)$/.test(url.searchParams.get('limit')??'30')))return reply(400,'TRACKING_QUERY_INVALID');
  if(!await verify(request))return reply(401,'OWNER_SESSION_REQUIRED');
  if(status)return Response.json({ownerSession:true,trackingReader:Boolean(env.GREENHOUSE_READ?.fetch),scope,inboxReader:false,eventIngress:false,remoteCommands:false,privateDataCached:false},{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  if(!env.GREENHOUSE_READ?.fetch)return reply(503,'TRACKING_READER_UNAVAILABLE');
  try{
   const id=crypto.randomUUID(),body={jsonrpc:'2.0',id,method:'tools/call',params:{name:item?'greenhouse_delivery_get':'greenhouse_delivery_list',arguments:item?{attemptId:ref.resourceId}:{limit}}};
   const response=await env.GREENHOUSE_READ.fetch(new Request('https://greenhouse.internal/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)}));
   if(!response.ok)throw Error('SOURCE_INVALID');const rpc=JSON.parse(await bounded(response,131072));
   if(rpc?.jsonrpc!=='2.0'||rpc.id!==id||rpc.error||!Array.isArray(rpc.result?.content)||rpc.result.content.length!==1||rpc.result.content[0].type!=='text')throw Error('SOURCE_INVALID');
   const data=JSON.parse(rpc.result.content[0].text);
   if(rpc.result.isError)return reply(data.code==='READ_NOT_AUTHORIZED'?403:data.code==='READER_UNAVAILABLE'?503:502,data.code==='READ_NOT_AUTHORIZED'?'TRACKING_SCOPE_REQUIRED':'TRACKING_READBACK_INVALID');
   if(!validScope(data.scope))throw Error('SOURCE_INVALID');if(item&&data.availability==='NOT_FOUND')return reply(404,'NOT_FOUND');
   const observedAt=new Date(now()).toISOString(),rows=item?[data]:data.items;
   if(!Array.isArray(rows)||rows.length>(item?1:limit)||(!item&&(data.coverage?.kind!=='RECENT_WINDOW'||data.coverage.complete!==false||data.coverage.total!==null)))throw Error('SOURCE_INVALID');
   const items=rows.map(row=>project(row,observedAt,item?ref.resourceId:null));if(new Set(items.map(i=>i.ref.resourceId)).size!==items.length)throw Error('SOURCE_INVALID');
   return Response.json({schema:'greenhouse.tracking.v1',scope,observedAt,coverage:{kind:'RECENT_WINDOW',complete:false,total:null},items},{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }catch{return reply(502,'TRACKING_READBACK_INVALID');}
 };
}
