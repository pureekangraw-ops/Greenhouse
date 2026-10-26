# Greenhouse × Hub V2 — Zone 2 build

รวมหน้าดูงานและตามงานไว้ที่ `/greenhouse/` เดิม: ค้นหา/กรอง → รายการที่มีสิทธิ์อ่าน → รายละเอียด/สถานะ/อ้างอิงผล → กลับรายการเดิม โดยคงคำค้น ตัวกรอง ตำแหน่งเลื่อน และการเลือกด้วย typed identity ไม่เริ่มแอปหรือ Work ledger ใหม่

Base: PR19 `5d3646e8bd40b44320854851d0e26aca4bb05ab0`, tree `dfec1e7e2fd936f083da438ee2dd3f2c2b42a901`. PR19 และ PR20 เดิมไม่ถูกแก้หรือรวม branch นี้เป็นงานซ้อนบน PR19 แยกเพื่อรีวิว ไม่ Merge/Deploy

## สิ่งที่สร้าง

- หน้าเดียว **งานของฉัน** ใช้ PR19 shell เดิม; LIVE เป็นค่าเริ่มต้น พร้อมบอกว่าเป็นช่วงรายการที่อ่านได้ ไม่ใช่งานทั้งหมด DEMO ต้องเลือกเอง ไม่มี fallback ไปข้อมูลตัวอย่างเมื่ออ่านจริงไม่ได้
- Operations/Inbox/การเชื่อมต่อและ Local AI ย้ายไปส่วนการตั้งค่า/เครื่องมือเสริม คง request reader, AI consent/cancel และ shell-only PWA cache เดิม ไม่มีข้อมูลส่วนตัวถูกเก็บใน browser storage
- สถานะแยก Work lifecycle / การส่ง / execution / result; receipt หรือ HTTP200 ไม่เปลี่ยนเป็นงานสำเร็จ ไม่มีเปอร์เซ็นต์แต่งขึ้น ไม่สร้าง Work จากคำขอธุรกิจ
- รายการใช้ `(sourceSystem, resourceType, resourceId)`; รหัสเหมือนกันคนละ namespace ยังแยกกัน รายการซ้ำ exact identity ถูกปฏิเสธ เมื่อ exact read ว่างคืน404 และเมื่ออ่านถูกปฏิเสธ401/403/404 จะล้างข้อมูลเดิมของรายการนั้น รวมกรณีส่ง request lookup ฟอร์มเดิมซ้ำ
- Recovery ไม่เปลี่ยน ACCEPTED/OUTCOME_UNKNOWN กลับเข้าคิวเพราะเส้นอ่านผลหายหรือ reply.notSent ไม่มีสัญญายืนยัน original-no-effect จึงไม่เปิด replay หลัง dispatch อ่าน proof ที่ไม่ตรง attempt/Work/checkpoint/receipt ไม่ปลด hold

## HTTP read integration ports

`createGreenhouseServer({ownerSessionResolver, trackingReader})` รับ reader แบบ injected เหมือน boundary เดิม ไม่รับ function จาก env ที่ผู้เรียกใส่มาเอง ไม่ใส่ owner/grant สมมติเพื่อเปิดข้อมูล

- `GET /api/greenhouse/tracking?limit=30` จำกัด1..30
- `GET /api/greenhouse/tracking/item?sourceSystem=...&resourceType=...&resourceId=...`
- ทุก query ปฏิเสธ extra/duplicate params; ไม่มี mutation ผ่าน GET
- verified session ต้องมี `actorId` และ `trackingScope:{ownerId,sourceSystems}` จาก trusted session resolver
- `trackingReader.list({session,limit})` / `.get({session,ref})` ต้องกรองเจ้าของที่ producer ก่อน LIMIT และคืน `{ownerId,observedAt,items}` โดยแต่ละ row มี ownerId ตรง scope ด้วย
- response `greenhouse.tracking.v1` เป็น redacted projection: ref/title/statusFacts/nextAction/provenance/result/links; unknown timestamps คง null, coverage RECENT_WINDOW/complete:false/total:null, ไม่ส่ง payload/WorkPass/token
- result AVAILABLE ต้องมี exact source/ref verification; การมี ref ไม่พิสูจน์ว่า artifact bytes ถูกดาวน์โหลดหรือใช้งานแล้ว

Pages routes ยัง fail closed 503 จนมี production adapter contract ที่ยืนยันแล้ว Node default ก็ไม่ configure reader/session การสร้าง source นี้ไม่ใช่ live connection

## Greenhouse source-owned MCP module

`src/hub/greenhouse-mcp.mjs` ส่งออก `createGreenhouseMcp({reader,authorizeRead,resultResolver})` เป็น JSON-RPC handler: initialize2025-06-18, tools/list, tools/call, read-only hints และ text JSON ตาม Hub ใช้งาน

1. `greenhouse_delivery_list({limit?})`: default30, 1..30
2. `greenhouse_delivery_get({attemptId})`
3. `greenhouse_result_get({attemptId})`

Attempt ID ใช้ PIXIE regexเดิม `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` ไม่รับ arbitrary URL/tool dispatch ไม่มี submit/cancel/recover และไม่สร้าง queue หรือ Work owner

`authorizeRead({context,tool,args})` ต้องคืน `{authorized:true,scope:{ownerId,sourceSystems:[oneNamespace]}}` จาก authority ที่ตรวจแล้ว **MCP adapter รุ่นนี้รับ exactly one source namespace** เพราะ exact attempt APIไม่มี source selector ถ้ารับหลาย source จะมีรหัสกำกวม จึงปฏิเสธก่อนอ่าน reader/result ส่วน HTTP tracking aggregate หลาย source ได้ด้วย typed tuple

reader.list/get ต้อง enforce owner filtering; resultResolver ต้องตรวจ source/attempt/Work/checkpoint/station/operation/receipt/evidence ให้ตรง recordเดิม ขาด resolverคืน UNAVAILABLE ไม่ยก source receipt เป็น Work lifecycle ผล false domainCompleted ไม่เท่ากับ execution failure โดยลำพัง

ยังไม่ได้ติดตั้ง Worker entrypoint/Service Binding/runtime configuration ห้อง Greenhouse ต้องห่อ handler ด้วย private HTTP entrypointที่ยืนยัน caller context แล้วตาม contract ไม่เปิด public unauthenticated wrapper ห้อง Hub/GO รับ patch แยกใน [handoff](handoffs/hub-v2-greenhouse/README.md) ห้ามใช้ patch เป็นสิทธิ์เปลี่ยน binding/key/permission

## ผลตรวจ

หลักฐาน: [verification.json](../artifacts/greenhouse-hub-v2-zone2/verification.json), [unit tests](../artifacts/greenhouse-hub-v2-zone2/tests.txt), [browser results](../artifacts/greenhouse-hub-v2-zone2/browser-results.json), [read chain](../artifacts/greenhouse-hub-v2-zone2/read-chain.txt), [independent review](../artifacts/greenhouse-hub-v2-zone2/product-review.md)

- Greenhouse163/163, zero skips; syntax/diff checks; offline agent drills16/16
- Chromium actual local Node HTTP+synthetic scoped source ports:360×800,800×360,768×1024,1440×900 ผ่าน list/detail/back, namespace collisions, empty exact404, request denial401/403/404 purge, DEMO isolation, no horizontal overflow, primary refresh touch≥44px, no uncaught errors และ API GET only
- Linux test imageไม่มีfontไทย จึง inject Noto Sans Thai ใน test page เท่านั้น ไม่แก้ product fonts หรือ browser security; keyboard focusทดสอบได้ แต่ soft keyboard/font scalingบนมือถือจริงยังไม่พิสูจน์
- GO+Hub+Greenhouse read-chain ใช้ actual source caller/Hub engine/SQLite/schema/discovery/MCPในเครื่องกับ synthetic source/authority records ไม่เรียก production หรือ Factory
- Hub/GO proposals94/94ทั้งคู่; Hub locked supplier patch verificationและ `wrangler deploy --dry-run` ผ่าน ไม่มีการ Deploy
- Demo buildและ routing/browser bootตรวจแยก:เลือก DEMO,3รายการสังเคราะห์, detailเปิดได้, live/APIถูกปิด ไม่มี source/device request

คำสั่งตรวจ:

```sh
npm run check
npm test
npm run evaluate:agents
# Optional local browser tooling (Playwright + Chromium installed in test env):
npm run check:ui
# Demo bundler requires existing optional esbuild tool, not a deployment:
npm run build:demo
npm run test:demo-routing
node scripts/check-demo-browser.mjs
```

`PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE_PATH`, `UI_TEST_FONT_PATH`, `UI_CHECK_OUTPUT`, `ESBUILD_MODULE`, `DEMO_PREVIEW_OUTPUT` รองรับ tooling/output paths ในเครื่องทดสอบ `BUILD_SOURCE_SHA` รับเฉพาะ40hexสำหรับ stamp build source ที่เผยแพร่แล้ว ไม่มี token/configในartifact

## ก่อนเปิดใช้จริง

ยังต้องยืนยัน current Work owner/grant verifier, producer-owned list/result resolver, private Greenhouse entrypoint และ Hub managed connector/binding ห้องเจ้าของต้องตรวจ runtime source ที่ใหม่กว่ามainก่อนใช้ patches ไม่อ้าง READY/CI แทน source execution/result proof การทดสอบนี้ไม่พิสูจน์ Factory effect, live queue durability หรือ physical Android

Cloudflare project metadataก่อนส่งbranch: greenhouse-owner production main; preview deployment setting custom รวมเฉพาะ `feat/unified-workplace-personal-planner-20261016` จึงไม่ใช้branchนี้สร้างpreview ไม่แก้projectsetting production/previewdeploymentเดิมต้องคงเดิม

Rollback:ปิดทางเข้าUI/read toolsใหม่หรือย้อนfeaturebranchก่อนรวม คง delivery/claim/receipt/tombstonesทั้งหมด การย้อน UI ไม่อนุญาตให้ replay UNKNOWN หรือเปิดคิว PR20 retirementยังเป็นงานแยก ห้ามคืน Metropolis binding/cronจากsourceเก่า
