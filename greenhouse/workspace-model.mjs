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
