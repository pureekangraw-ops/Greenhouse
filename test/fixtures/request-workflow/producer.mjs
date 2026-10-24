// Customer capabilities never call OwnerBridge or Factory. All sender identities originate here.
export const SENDER_LABELS={AI:'AI - GO',ADMIN:'Admin',SYSTEM:'System',CUSTOMER:'คุณ'};
export const STATUS_LABELS={DRAFT:'บันทึกร่าง',SUBMITTED:'ศูนย์รับงาน',REVIEWING:'กำลังตรวจสอบ',IN_PROGRESS:'กำลังดำเนินงาน',DELIVERED:'ส่งมอบงาน',FOLLOW_UP:'ติดตามผล'};
const respond=(v,status=200,headers={})=>Response.json(v,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status})};
const hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const random=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9:_-]{1,120}$/.test(v)?v:fail('INVALID_ID');
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const sql=(db,q,...args)=>db.prepare(q).bind(...args);
const all=async s=>(await s.all()).results;
const now=()=>new Date().toISOString();
const fields=['goal','serviceLine','entryService','sourcePage','jobType','audience','materials','pageCount','package','desiredDate','deadlineText','shopContext'];
function brief(v){
 if(!keys(v,fields))fail('INVALID_BRIEF');
 const result={};for(const k of fields){const x=v[k];if(x!==undefined){if(k==='pageCount'){if(x!==null&&(!Number.isInteger(x)||x<1||x>500))fail('INVALID_BRIEF');result[k]=x}else{if(typeof x!=='string'&&x!==null)fail('INVALID_BRIEF');result[k]=String(x||'').slice(0,k==='shopContext'?8000:2000)}}}
 if(result.sourcePage)result.sourcePage=result.sourcePage.split(/[?#]/)[0];return result;
}
async function body(request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))fail('JSON_REQUIRED',415);
 const reader=request.body?.getReader();let raw='',size=0;
 if(reader){const decoder=new TextDecoder();try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();fail('PAYLOAD_TOO_LARGE',413)}raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}}
 try{return JSON.parse(raw)}catch{fail('INVALID_JSON')}
}
export async function authenticateAdmin(request,env){
 const authorization=request.headers.get('authorization')||'';if(!/^Bearer [A-Za-z0-9_-]{32,200}$/.test(authorization))fail('ADMIN_AUTH_REQUIRED',401);
 let credentials;try{credentials=JSON.parse(env.YGG_ADMIN_CREDENTIALS||'{}')}catch{fail('ADMIN_AUTH_NOT_CONFIGURED',503)}
 const digest=await hash(authorization.slice(7));
 for(const [actorId,stored] of Object.entries(credentials)){if(/^[A-Za-z0-9_-]{1,80}$/.test(actorId)&&typeof stored==='string'&&/^[a-f0-9]{64}$/.test(stored)){
  let diff=0;for(let i=0;i<64;i++)diff|=digest.charCodeAt(i)^stored.charCodeAt(i);if(diff===0)return {type:'ADMIN',id:actorId};
 }}fail('ADMIN_AUTH_REQUIRED',401);
}
async function session(request,db,create){
 const cookie=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith('__Host-ygg-request='));
 if(cookie.length>1)fail('SESSION_INVALID',401);
 if(cookie.length){const token=cookie[0].slice('__Host-ygg-request='.length);if(!/^[a-f0-9]{64}$/.test(token))fail('SESSION_INVALID',401);
  const principal=await hash(token),row=await sql(db,'SELECT expires_at FROM ygg_sessions WHERE token_hash=?',principal).first();
  if(!row||row.expires_at<=Date.now())fail('SESSION_EXPIRED',401);return {type:'CUSTOMER',id:principal};
 }
 if(!create)fail('SESSION_REQUIRED',401);const token=random(),principal=await hash(token);
 await sql(db,'INSERT INTO ygg_sessions(token_hash,expires_at) VALUES(?,?)',principal,Date.now()+90*86400000).run();
 return {type:'CUSTOMER',id:principal,cookie:`__Host-ygg-request=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7776000`};
}
const message=(requestId,messageId,type,senderId,text)=>({message_id:messageId,request_id:requestId,sender_type:type,sender_id:senderId,text,timestamp:now()});
function messageStatement(db,m,guard=[]){
 const [requestId,mutation]=guard;
 return sql(db,`INSERT INTO ygg_messages(message_id,request_id,sender_type,sender_id,text,timestamp)
 SELECT ?,?,?,?,?,? ${guard.length?'WHERE EXISTS (SELECT 1 FROM ygg_requests WHERE request_id=? AND last_mutation=?)':''} ON CONFLICT(message_id) DO NOTHING`,m.message_id,m.request_id,m.sender_type,m.sender_id,m.text,m.timestamp,...(guard.length?[requestId,mutation]:[]));
}
async function read(db,row,actor){
 const messages=await all(sql(db,'SELECT * FROM ygg_messages WHERE request_id=? ORDER BY timestamp,rowid',row.request_id));
 const events=await all(sql(db,'SELECT event_id,kind,actor_type,actor_id,from_value,to_value,timestamp FROM ygg_request_events WHERE request_id=? ORDER BY timestamp,rowid',row.request_id));
 const {owner_hash,last_mutation,brief_json,...publicRow}=row;
 return {ok:true,request:{...publicRow,brief:JSON.parse(brief_json),status_label:STATUS_LABELS[row.status],responder_label:SENDER_LABELS[row.responder_type]},messages:messages.map(m=>({...m,sender_label:SENDER_LABELS[m.sender_type]})),events};
}
async function owned(db,requestId,actor){const row=await sql(db,'SELECT * FROM ygg_requests WHERE request_id=?',id(requestId)).first();if(!row||(actor.type!=='ADMIN'&&row.owner_hash!==actor.id))fail('REQUEST_NOT_FOUND',404);return row}
// CAS and guarded statements are in one D1 transaction; losing concurrent mutations cannot emit events/messages.
async function mutate(db,row,changes,actor,kind,from,to,text,extra=[]){
 const mutation=crypto.randomUUID(),time=now(),entries=Object.entries(changes),guard=[row.request_id,mutation];
 const m=message(row.request_id,'msg_'+mutation,'SYSTEM','request-workflow',text);
 const result=await db.batch([
  sql(db,`UPDATE ygg_requests SET ${entries.length?entries.map(([k])=>k+'=?').join(',')+',':''}version=version+1,last_mutation=?,updated_at=? WHERE request_id=? AND version=?`,...entries.map(([,v])=>v),mutation,time,row.request_id,row.version),
  sql(db,`INSERT INTO ygg_request_events(event_id,request_id,kind,actor_type,actor_id,from_value,to_value,timestamp) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ygg_requests WHERE request_id=? AND last_mutation=?)`,mutation,row.request_id,kind,actor.type,actor.id,from,to,time,...guard),
  ...(text?[messageStatement(db,m,guard)]:[]),...extra.map(fn=>fn(guard))
 ]);
 if(!result[0]?.meta?.changes)fail('REQUEST_CHANGED_RELOAD',409);
 return owned(db,row.request_id,actor);
}
export async function requestWorkflow(request,env,interpret){
 const u=new URL(request.url),path=u.pathname;
 const isAdmin=path.startsWith('/api/v1/admin/requests');
 const legacy=/^\/(?:client\/)?api\/v1\/brief\/(upsert|confirm)$/.exec(path);
 if(!isAdmin&&!legacy&&!/^\/api\/v1\/requests(?:\/|$)/.test(path))return null;
 if(!env.REQUESTS_DB?.prepare)return respond({ok:false,code:'REQUEST_STORE_NOT_CONFIGURED'},503);
 try{
  if(!['GET','POST'].includes(request.method))return respond({ok:false,code:'METHOD_NOT_ALLOWED'},405,{allow:'GET, POST'});
  if(request.method==='POST'&&(request.headers.get('origin')!==u.origin||request.headers.get('sec-fetch-site')==='cross-site'))fail('ORIGIN_DENIED',403);
  if(request.method==='GET'&&request.headers.get('sec-fetch-site')==='cross-site')fail('ORIGIN_DENIED',403);
  const db=env.REQUESTS_DB,actor=isAdmin?await authenticateAdmin(request,env):await session(request,db,request.method==='GET');
  const base=isAdmin?'/api/v1/admin/requests':'/api/v1/requests';const rest=path.slice(base.length).split('/').filter(Boolean);
  let input=request.method==='POST'?await body(request):null;
  if(input&&['sender_type','sender_id','sender','role','actor_id','timestamp'].some(k=>Object.hasOwn(input,k)))fail('SENDER_FORBIDDEN',400);
  let requestId=legacy?id(input?.briefId):rest[0],action=legacy?legacy[1]:rest[1];
  if(!requestId){
   if(request.method==='GET'){
    const cursor=u.searchParams.get('cursor')||'0';if(!/^\d{1,7}$/.test(cursor))fail('INVALID_CURSOR');
    const rows=await all(sql(db,`SELECT request_id,status,responder_type,updated_at FROM ygg_requests ${isAdmin?'':'WHERE owner_hash=?'} ORDER BY updated_at DESC,request_id DESC LIMIT 101 OFFSET ?`,...(isAdmin?[]:[actor.id]),Number(cursor)));
    return respond({ok:true,next_cursor:rows.length>100?String(Number(cursor)+100):null,requests:rows.slice(0,100).map(r=>({...r,status_label:STATUS_LABELS[r.status],responder_label:SENDER_LABELS[r.responder_type]}))},200,actor.cookie?{'set-cookie':actor.cookie}:{});
   }
   fail('REQUEST_ID_REQUIRED');
  }
  let row=await sql(db,'SELECT * FROM ygg_requests WHERE request_id=?',id(requestId)).first();
  if(!isAdmin&&request.method==='POST'&&(action==='upsert'||!action)){
   if(!legacy&&!keys(input,['brief']))fail('INVALID_REQUEST');
   if(row&&row.owner_hash!==actor.id)fail('REQUEST_NOT_FOUND',404);
   const data=brief(input?.brief||{}),time=now();
   // Retrying creation returns the owned record, never overwrites a draft edited since creation.
   if(row&&!action)return respond({...await read(db,row,actor),briefId:requestId,status:row.status});
   if(!row){await sql(db,`INSERT INTO ygg_requests(request_id,owner_hash,brief_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING`,requestId,actor.id,JSON.stringify(data),time,time).run();row=await owned(db,requestId,actor)}
   else {if(row.status!=='DRAFT')fail('REQUEST_ALREADY_SUBMITTED',409);row=await mutate(db,row,{brief_json:JSON.stringify(data)},actor,'DRAFT_UPDATED','DRAFT','DRAFT',null)}
   return respond({...await read(db,row,actor),briefId:requestId,status:'DRAFT'});
  }
  row=await owned(db,requestId,actor);
  if(request.method==='GET')return respond(await read(db,row,actor));
  if(action==='confirm'&&!isAdmin){
   if(!legacy&&!keys(input,[]))fail('INVALID_REQUEST');
   if(row.status!=='DRAFT')return respond({...await read(db,row,actor),workId:row.work_id,workCreated:false});
   // The saved draft is authoritative; legacy callers may confirm matching current content only.
   if(legacy&&input.brief&&JSON.stringify(brief(input.brief))!==row.brief_json)fail('DRAFT_CHANGED_SAVE_FIRST',409);
   if(!JSON.parse(row.brief_json).goal?.trim())fail('GOAL_REQUIRED');
   try{row=await mutate(db,row,{status:'SUBMITTED',work_id:'WORK-SPECTRUM-'+requestId},actor,'STATUS','DRAFT','SUBMITTED','รับคำขอแล้ว ศูนย์รับงานรอตรวจสอบ')}
   catch(error){if(error.message!=='REQUEST_CHANGED_RELOAD')throw error;row=await owned(db,requestId,actor);if(row.status==='DRAFT')throw error;return respond({...await read(db,row,actor),workId:row.work_id,workCreated:false})}
   return respond({...await read(db,row,actor),workId:row.work_id,workCreated:true});
  }
  if(action==='handoff'&&isAdmin){
   if(!keys(input,['responder','version'])||!['AI','ADMIN'].includes(input.responder)||input.version!==row.version)fail('INVALID_HANDOFF',409);
   if(row.responder_type===input.responder&&(input.responder==='AI'||row.responder_id===actor.id))return respond(await read(db,row,actor));
   row=await mutate(db,row,{responder_type:input.responder,responder_id:input.responder==='AI'?'go':actor.id},actor,'HANDOFF',row.responder_type+':'+row.responder_id,input.responder+':'+(input.responder==='AI'?'go':actor.id),input.responder==='ADMIN'?'Admin เข้ามารับช่วงการสนทนาแล้ว':'AI - GO กลับมาดูแลการสนทนาแล้ว');
   return respond(await read(db,row,actor));
  }
  if(action==='status'&&isAdmin){
   if(!keys(input,['status','version','delivery_url','delivery_text'])||input.version!==row.version)fail('REQUEST_CHANGED_RELOAD',409);
   const next={SUBMITTED:['REVIEWING'],REVIEWING:['IN_PROGRESS'],IN_PROGRESS:['DELIVERED'],DELIVERED:['FOLLOW_UP'],FOLLOW_UP:[]};
   if(!next[row.status]?.includes(input.status))fail('STATUS_TRANSITION_DENIED',409);
   let delivery=row.delivery_url,deliveryText=row.delivery_text,deliveryHash=row.delivery_sha256;
   if(input.status==='DELIVERED'){
    if(typeof input.delivery_text!=='string'||!input.delivery_text.trim()||input.delivery_text.length>20000)fail('DELIVERY_CONTENT_REQUIRED');
    deliveryText=input.delivery_text.trim();deliveryHash=await hash(deliveryText);
    if(input.delivery_url){try{const url=new URL(input.delivery_url);if(url.protocol!=='https:'||url.username||url.password||url.href.length>2000)throw Error();delivery=url.href}catch{fail('DELIVERY_REFERENCE_INVALID')}}
   }
   row=await mutate(db,row,{status:input.status,delivery_url:delivery,delivery_text:deliveryText,delivery_sha256:deliveryHash},actor,'STATUS',row.status,input.status,STATUS_LABELS[input.status]);
   return respond(await read(db,row,actor));
  }
  if(action==='messages'){
   if(!keys(input,['text','messageId'])||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)fail('INVALID_MESSAGE');
   const messageId=requestId+':'+id(input.messageId),existing=await sql(db,'SELECT * FROM ygg_messages WHERE message_id=?',messageId).first();
   if(existing){if(existing.sender_id!==actor.id||existing.text!==input.text.trim())fail('MESSAGE_CONFLICT',409);return respond(await read(db,row,actor))}
   if(isAdmin&&(row.responder_type!=='ADMIN'||row.responder_id!==actor.id))fail('ADMIN_MUST_TAKE_OVER',409);
   const m=message(requestId,messageId,actor.type,actor.id,input.text.trim());
   row=await mutate(db,row,{},actor,'MESSAGE',null,messageId,null,[guard=>messageStatement(db,m,guard)]);
   if(!isAdmin&&row.responder_type==='AI'){
    // Run the existing server AI interpreter, never a browser-supplied AI reply/role.
    const generationVersion=row.version;let text,type='AI',senderId='go';
    try{
     const history=await all(sql(db,'SELECT sender_type,text FROM ygg_messages WHERE request_id=? ORDER BY timestamp DESC,rowid DESC LIMIT 6',requestId));
     const response=await interpret(new Request(u.origin+'/api/v1/interpret',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':request.headers.get('cf-connecting-ip')||actor.id},body:JSON.stringify({text:m.text,context:{surface:'SPECTRUMSALE',stage:'discover'}})}),{...env,REQUEST_CHAT_CONTEXT:{brief:JSON.parse(row.brief_json),history:history.reverse()}});
     const result=await response.json();if(!response.ok||typeof result.reply!=='string'||!result.reply.trim())throw Error();text=result.reply.slice(0,2000);type=result.sender_type==='AI'?'AI':'SYSTEM';senderId=type==='AI'?'go':'conversation-policy';
    }catch{type='SYSTEM';senderId='request-workflow';text='AI - GO ไม่พร้อมตอบชั่วคราว คุณยังบันทึกและส่งคำขอได้';}
    const reply=message(requestId,messageId+':reply',type,senderId,text);
    // A handoff/version change during inference suppresses stale AI output.
    await sql(db,`INSERT INTO ygg_messages(message_id,request_id,sender_type,sender_id,text,timestamp) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ygg_requests WHERE request_id=? AND version=? AND responder_type='AI') ON CONFLICT(message_id) DO NOTHING`,reply.message_id,requestId,type,senderId,text,reply.timestamp,requestId,generationVersion).run();
   }
   row=await owned(db,requestId,actor);return respond(await read(db,row,actor));
  }
  fail('OPERATION_NOT_ALLOWED',403);
 }catch(error){return respond({ok:false,code:error.status?error.message:'REQUEST_STORE_UNAVAILABLE'},error.status||503)}
}
