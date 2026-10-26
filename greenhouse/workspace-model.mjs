export const demoEvents = [
 {title:'คำขอเว็บไซต์ตัวอย่าง',sourceEventId:'demo-event-001',correlationId:'demo-request-001',category:'REQUEST_SUBMITTED',ownerSource:'demo-shop',occurredAt:'2026-10-23T08:15:00.000Z',persistedAt:'2026-10-23T08:15:00.000Z',evidence:['demo://request-001/submitted'],receiptStatus:'MISSING',evidenceScope:'DEMO',freshness:'UNKNOWN'},
 {title:'บันทึกทบทวนตัวอย่าง',sourceEventId:'demo-event-002',correlationId:'demo-request-001',category:'REVIEW_NOTE',ownerSource:'demo-office',occurredAt:'2026-10-23T08:20:00.000Z',persistedAt:'2026-10-23T08:20:00.000Z',evidence:['demo://request-001/review'],receiptStatus:'MISSING',evidenceScope:'DEMO',freshness:'UNKNOWN'},
 {title:'คำขอสไลด์ตัวอย่าง',sourceEventId:'demo-event-003',correlationId:'demo-request-002',category:'REQUEST_SUBMITTED',ownerSource:'demo-shop',occurredAt:'2026-10-23T09:00:00.000Z',persistedAt:'2026-10-23T09:00:00.000Z',evidence:['demo://request-002/submitted'],receiptStatus:'MISSING',evidenceScope:'DEMO',freshness:'UNKNOWN'},
];
export function filterEvents(items,{query='',category='',source=''}={}) {
 const term=query.trim().toLocaleLowerCase();
 return items.filter(item=>(!category||item.category===category)&&(!source||item.ownerSource===source)&&
  (!term||[item.title,item.sourceEventId,item.correlationId,item.ownerSource].some(v=>String(v||'').toLocaleLowerCase().includes(term))));
}
export function eventHistory(items,item){return items.filter(e=>e.correlationId===item.correlationId).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));}
export function acceptReadback(body,requestId){
 if(!Array.isArray(body?.items)||body.items.length!==1)throw Error('READBACK_INVALID');
 const item=body.items[0];
 if(item.correlationId!==requestId||typeof item.sourceEventId!=='string'||item.category!=='REQUEST_SUBMITTED'||
    !Number.isFinite(Date.parse(item.occurredAt))||!Array.isArray(item.evidence)||
    item.receiptStatus!=='MISSING'||item.evidenceScope!=='OWNER_HTTP_READBACK')throw Error('READBACK_INVALID');
 return item;
}
export const escapeHTML=value=>String(value??'—').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

// Identity is a tuple, never a title or an unqualified source ID.
export function trackingKey(ref) {
 if(!ref||!['sourceSystem','resourceType','resourceId'].every(k=>typeof ref[k]==='string'&&ref[k].length))throw Error('TRACKING_INVALID');
 return JSON.stringify([ref.sourceSystem,ref.resourceType,ref.resourceId]);
}
export function trackingStatus(item){
 const facts=item.statusFacts||[];
 const has=(dimension,values)=>facts.some(f=>f.dimension===dimension&&values.includes(String(f.value).toUpperCase()));
 if(has('WORK_LIFECYCLE',['COMPLETED']))return {key:'completed',label:'Work เสร็จ · เจ้าของยืนยัน'};
 if(has('WORK_LIFECYCLE',['FAILED'])||has('EXECUTION',['FAILED','ERROR']))return {key:'failed',label:'แหล่งข้อมูลรายงานล้มเหลว'};
 if(facts.some(f=>['WORK_LIFECYCLE','EXECUTION'].includes(f.dimension)&&String(f.value).toUpperCase()==='BLOCKED'))return {key:'blocked',label:'ติดปัญหา'};
 if(has('WORK_LIFECYCLE',['ACTIVE','RUNNING','IN_PROGRESS'])||has('EXECUTION',['RUNNING','EXECUTING','IN_PROGRESS']))return {key:'running',label:'กำลังดำเนินการ'};
 if(has('EXECUTION',['COMPLETED','SUCCEEDED','SUCCESS']))return {key:'unknown',label:'ประมวลผลเสร็จ · ยังไม่ยืนยัน Work เสร็จ'};
 return {key:'unknown',label:has('DELIVERY',['PENDING_QUEUE','WAITING_QUEUE','QUEUED'])?'คิวรอส่ง · ยังไม่ทราบผล Work':has('DELIVERY',['ACCEPTED','DELIVERED','READBACK_VERIFIED'])?'ปลายทางรับแล้ว · ยังไม่ทราบผล Work':'ยังไม่ทราบผล Work'};
}
export function filterTracking(items,{query='',status='all',source=''}={}){
 const term=query.trim().toLocaleLowerCase();
 return items.filter(i=>(!status||status==='all'||(status==='needs-action'?Boolean(i.nextAction):trackingStatus(i).key===status))&&(!source||i.ref.sourceSystem===source)&&(!term||[i.title,...Object.values(i.ref),i.nextAction,trackingStatus(i).label].some(v=>String(v||'').toLocaleLowerCase().includes(term))));
}
export function acceptTracking(body,ref){
 if(body?.schema!=='greenhouse.tracking.v1'||!Array.isArray(body.items)||body.coverage?.kind!=='RECENT_WINDOW'||body.coverage?.complete!==false||body.coverage?.total!==null)throw Error('TRACKING_INVALID');
 const seen=new Set();
 for(const item of body.items){const key=trackingKey(item.ref);if(seen.has(key)||typeof item.title!=='string'||!Array.isArray(item.statusFacts)||!item.provenance||!item.result)throw Error('TRACKING_INVALID');seen.add(key);}
 if(ref&&(body.items.length!==1||trackingKey(body.items[0].ref)!==trackingKey(ref)))throw Error('TRACKING_INVALID');
 return body;
}
export function requestTracking(event){return {ref:{sourceSystem:event.ownerSource,resourceType:'BUSINESS_REQUEST',resourceId:event.correlationId},title:event.title,statusFacts:[{dimension:'BUSINESS_REQUEST',value:event.category,sourceUpdatedAt:event.persistedAt,observedAt:null}],nextAction:null,provenance:{sourceSystem:event.ownerSource,sourceRef:event.sourceEventId,observedAt:null,availability:'AVAILABLE'},result:{availability:'UNKNOWN'},links:[],requestEvent:event};}
export function trackingTime(value){return Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'ยังไม่ทราบเวลา';}
export function renderTrackingRow(item){
 const esc=escapeHTML,status=trackingStatus(item),updated=item.statusFacts.map(f=>f.sourceUpdatedAt).filter(Boolean).sort().at(-1);
 return `<button class="tracking-row" data-tracking="${esc(trackingKey(item.ref))}"><strong>${esc(item.title)}</strong><span class="tracking-status">${esc(status.label)}</span><small>${esc(item.ref.sourceSystem)} · ${esc(item.ref.resourceType)} · ${esc(item.ref.resourceId)}</small><span>${esc(item.nextAction||'ยังไม่มีสิ่งที่ต้นทางระบุให้ทำต่อ')}</span><time>ต้นทางอัปเดต: ${esc(trackingTime(updated))}</time><small>ตรวจอ่าน: ${esc(trackingTime(item.provenance.observedAt))} · ${esc(item.provenance.availability)}</small></button>`;
}
export function itemsAfterReadFailure(items,ref,status){return [401,403,404].includes(status)?items.filter(item=>trackingKey(item.ref)!==trackingKey(ref)):items;}
