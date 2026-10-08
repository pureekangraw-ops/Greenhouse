let liveOfficeReport = null;

const report = {
  reportId: "RPT-DEMO-001",
  requestedBy: "OFFICE",
  observedAt: "2026-10-06T10:58:00Z",
  workId: "WORK-GREENHOUSE-METROPOLIS-GENOME-HUB-V01-20261006-002",
  ownerSource: "Not connected · mock owner source",
  freshness: "UNKNOWN",
  workStatus: "WAITING",
  confidence: "PROBABLE",
  evidence: ["Genome Hub report contract is defined", "Live HERMES / GO / LIGHT connection is not verified"],
  nextAction: "Connect the Hub adapter and perform one read-only report round trip.",
  limitations: ["This is a local mock readback", "No external system was queried"]
};

const viewMeta = {
  home: { label: "Overview" },
  shop: { label: "Genome Shop" },
  office: { label: "Genome Office" },
  greenhouse: { label: "Genome Greenhouse" },
  reports: { label: "Reports" },
  activity: { label: "Readback log" }
};

const data = {
  requests: [
    { title: "ขอรายงานงานค้างของ GO และ LIGHT", meta: "Office · Work report", freshness: "UNKNOWN", state: "WAITING", confidence: "PROBABLE" },
    { title: "ตรวจสถานะสินค้าใน Launch Pipeline", meta: "Shop · Product report", freshness: "STALE", state: "WAITING", confidence: "CONFIRMED" },
    { title: "สรุป Greenhouse build candidates", meta: "Greenhouse · Build report", freshness: "CURRENT", state: null, confidence: "CONFIRMED" }
  ],
  genomes: [
    { view: "shop", icon: "▦", title: "Genome Shop", description: "สินค้า ช่องทางขาย สถานะการปล่อย และตัวเลขที่ต้องติดตาม", badge: "3 open requests", tone: "blue" },
    { view: "office", icon: "▤", title: "Genome Office", description: "งานสำนักงาน Work ที่กำลังทำ งานที่รอ และ readback ที่ต้องตรวจ", badge: "5 active works", tone: "green" },
    { view: "greenhouse", icon: "♧", title: "Genome Greenhouse", description: "พื้นที่สร้างระบบ build candidates และ technical artifacts", badge: "2 build tracks", tone: "orange" }
  ]
};

const app = document.querySelector("#app");
const currentViewLabel = document.querySelector("#current-view-label");
const toast = document.querySelector("#toast");
let toastTimer;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);
}
function badge(value) {
  if (!value) return "";
  const tone = value === "CURRENT" || value === "CONFIRMED" ? "green" : value === "STALE" || value === "WAITING" || value === "PROBABLE" ? "orange" : value === "BLOCKED" ? "red" : value === "UNKNOWN" ? "neutral" : "blue";
  return `<span class="badge badge--${tone}">${escapeHtml(value)}</span>`;
}

function formatDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "UNKNOWN" :
    new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(parsed);
}

function reportMarkup(item = report) {
  return `
    <div class="report-card report-card--featured">
      <div class="report-kicker"><h4>Latest readback</h4><span class="badge badge--neutral">${escapeHtml(item.reportId)}</span></div>
      <dl>
        <dt>Observed at</dt><dd>${formatDate(item.observedAt)}</dd>
        <dt>Work ID</dt><dd>${escapeHtml(item.workId || "—")}</dd>
        <dt>Owner Source</dt><dd class="muted">${escapeHtml(item.ownerSource)}</dd>
        <dt>State</dt><dd>${badge(item.freshness)} ${badge(item.workStatus)} ${badge(item.confidence)}</dd>
        <dt>Evidence</dt><dd><ul>${item.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></dd>
        <dt>Next Action</dt><dd>${escapeHtml(item.nextAction)}</dd>
        <dt>Limitations</dt><dd class="muted">${escapeHtml(item.limitations.join(" · "))}</dd>
      </dl>
    </div>`;
}

function renderHome() {
  app.innerHTML = `
    <section class="page-intro">
      <div><h2>One Hub. Three Genomes.</h2><p>Genome Hub รับคำขอ ประสานงาน และคืนผลที่ตรวจย้อนกลับได้ให้ Shop, Office และ Greenhouse</p></div>
      <div class="intro-actions"><button class="button" data-action="request-report">ขอรีพอร์ต</button><button class="button button--primary" data-view-action="office">เปิด Office</button></div>
    </section>
    <section class="metric-grid" aria-label="Hub summary">
      <article class="metric-card"><p class="metric-label">Open requests</p><p class="metric-value">—</p><p class="metric-foot">Demo · no owner-source count</p></article>
      <article class="metric-card"><p class="metric-label">Waiting</p><p class="metric-value">—</p><p class="metric-foot">Demo · not queried</p></article>
      <article class="metric-card"><p class="metric-label">Readbacks</p><p class="metric-value">—</p><p class="metric-foot">Demo · no verified aggregate</p></article>
      <article class="metric-card"><p class="metric-label">Connections</p><p class="metric-value">00</p><p class="metric-foot">Runtime <strong>not connected</strong></p></article>
    </section>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><div><h3>Requests in the Hub</h3><p>รายการตัวอย่าง (Mock) จากสาม Genome</p></div><button class="link-button" data-view-action="reports">ดูทั้งหมด →</button></div>
        ${data.requests.map((item) => `<div class="request-row"><div><p class="request-title">${item.title}</p><div class="request-meta"><span>${item.meta}</span><span class="meta-separator">·</span>${badge(item.freshness)}${badge(item.state)}${badge(item.confidence)}</div></div><button class="button" data-action="open-report">เปิดรายงาน</button></div>`).join("")}
      </section>
      <section class="panel"><div class="panel-header"><div><h3>Hub readback</h3><p>ตัวอย่างรายงาน · ยังไม่ใช่ live readback</p></div><span class="badge badge--orange">mock</span></div>${reportMarkup()}</section>
    </div>
    <div class="section-heading"><div><h3>Three Genomes</h3><p>แต่ละ Genome ถือ domain ของตัวเอง Hub เป็นผู้ประสาน</p></div></div>
    <section class="card-grid">${data.genomes.map(genomeCard).join("")}</section>`;
}

function genomeCard(item) {
  return `<article class="genome-card"><div class="card-top"><div class="genome-icon">${item.icon}</div><span class="badge badge--${item.tone}">${item.badge}</span></div><h4>${item.title}</h4><p>${item.description}</p><button class="card-link" data-view-action="${item.view}">เข้า Genome →</button></article>`;
}

function officeReaderMarkup() {
  return `<section class="panel owner-reader">
    <div class="panel-header"><div><h3>อ่าน Work จริงจาก Metropolis</h3>
      <p>BIG เป็นเจ้าของสิทธิ์ · GO อ่านแทน · ไม่สร้างหรือแก้ไข Work</p></div>
      <span class="badge badge--${liveOfficeReport ? 'green' : 'orange'}">${liveOfficeReport ? 'Source readback' : 'ยังไม่มีผลจริง'}</span>
    </div>
    <form data-office-work-form class="owner-reader-form">
      <label for="office-work-id">Work ID</label>
      <input id="office-work-id" name="workId" type="text" placeholder="WORK-..." maxlength="133" autocomplete="off" spellcheck="false" required />
      <button class="button button--primary" type="submit">อ่านสถานะ</button>
    </form>
    <p class="muted owner-reader-note">อ่านผ่าน backend เฉพาะเครื่อง · ไม่ส่ง Token ให้เบราว์เซอร์ · หากไม่ได้ต่อ OAuth จะไม่สร้างผลจำลอง</p>
  </section>`;
}

function renderGenome(view) {
  const config = {
    shop: { icon: "▦", title: "Genome Shop", desc: "หน้าเว็บสินค้าและการขาย — Hub ช่วยรับคำขอและคืนรายงานที่มี source ชัดเจน.", items: [["Product launch pipeline", "4 products · 1 waiting for review", "WAITING"], ["Marketplace performance", "Last owner readback not connected", "UNKNOWN"], ["Sales / revenue snapshot", "Prepared for source adapter", "PROBABLE"]], connections: [["Product registry", "Owner source · not connected"], ["Sales worksheet", "External source · pending"], ["Marketplace", "Connection contract · unknown"]] },
    office: { icon: "▤", title: "Genome Office", desc: "หน้าเว็บงานสำนักงาน — จุดดู Work เดิม งานค้าง และคำขอที่ต้องประสานกับ Agent.", items: [["GO / LIGHT pending work report", "Work ID linked · waiting for source", "WAITING"], ["Office intake queue", "5 active works · 2 waiting", "CURRENT"], ["Return verification", "2 readbacks need review", "PROBABLE"]], connections: [["Work source", "Work identity · not connected"], ["HERMES", "Intake / route contract · mock"], ["MIMIR", "Return / organization contract · mock"]] },
    greenhouse: { icon: "♧", title: "Genome Greenhouse", desc: "หน้าเว็บสำหรับการสร้างและดูแลระบบ — build candidates, technical artifacts และ verification.", items: [["Metropolis v0.1 scaffold", "Local draft · visual QA pending", "CURRENT"], ["Hub adapter", "No live contract verified", "UNKNOWN"], ["Report contract", "Defined in this work", "CONFIRMED"]], connections: [["Repository", "Greenhouse · direct GitHub pending"], ["Build runner", "Not configured"], ["Verification", "Local only"]] }
  }[view];
  app.innerHTML = `<section class="page-intro"><div class="detail-hero"><div class="genome-icon">${config.icon}</div><div><h2>${config.title}</h2><p>${config.desc}</p></div></div><div class="intro-actions"><button class="button" data-action="request-report">ขอรีพอร์ต</button><button class="button button--primary" data-action="new-request">สร้างคำขอ</button></div></section>${view === "office" ? officeReaderMarkup() : ""}<div class="detail-grid"><section class="panel"><div class="panel-header"><div><h3>รายการตัวอย่าง (Mock)</h3><p>ข้อมูลต่อไปนี้เป็นโครงทดลอง ไม่ใช่สถานะจริงจากเจ้าของ Work</p></div><span class="badge badge--neutral">${config.items.length} items</span></div><div class="list-block">${config.items.map(([title, desc, state]) => `<div class="list-item"><div><h4>${title}</h4><p>${desc}</p></div>${badge(state)}</div>`).join("")}</div></section><div class="side-stack"><section class="panel"><div class="panel-header"><div><h3>Connections</h3><p>ปลายทางของ Genome</p></div></div><div class="connection-list">${config.connections.map(([title, state], index) => `<div class="connection"><div class="connection-symbol">${index + 1}</div><div><strong>${title}</strong><span>${state}</span></div></div>`).join("")}</div></section><section class="panel"><div class="panel-header"><div><h3>Latest readback</h3><p>${view === "office" && liveOfficeReport ? "Metropolis source readback" : "ตัวอย่างโครงรายงาน (Mock)"}</p></div></div>${reportMarkup(view === "office" && liveOfficeReport ? liveOfficeReport : report)}</section></div></div>`;
}

function renderReports() {
  app.innerHTML = `<section class="page-intro"><div><h2>Reports that can be checked.</h2><p>ทุกรีพอร์ตต้องบอกว่าอ่านเมื่อไร อ่านจากไหน มีหลักฐานอะไร และยังมีข้อจำกัดตรงไหน</p></div><div class="intro-actions"><button class="button button--primary" data-action="request-report">ขอรีพอร์ตใหม่</button></div></section><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h3>Report queue</h3><p>Requests waiting for Hub coordination</p></div><span class="badge badge--orange">3 waiting</span></div>${data.requests.map((item) => `<div class="request-row"><div><p class="request-title">${item.title}</p><div class="request-meta"><span>${item.meta}</span>${badge(item.freshness)}${badge(item.state)}${badge(item.confidence)}</div></div><button class="button" data-action="open-report">View</button></div>`).join("")}</section><section class="panel"><div class="panel-header"><div><h3>Report contract</h3><p>สามมิติไม่ทับกัน</p></div></div><div class="report-card"><dl><dt>Freshness</dt><dd>${badge("CURRENT")} ${badge("STALE")} ${badge("UNKNOWN")}</dd><dt>Work status</dt><dd>${badge("BLOCKED")} ${badge("WAITING")}</dd><dt>Confidence</dt><dd>${badge("CONFIRMED")} ${badge("PROBABLE")} ${badge("UNKNOWN")}</dd><dt>Required</dt><dd>Observed time · Owner Source · Evidence · Next Action · Limitations · Work ID</dd></dl></div>${reportMarkup()}</section></div>`;
}

function renderActivity() {
  app.innerHTML = `<section class="page-intro"><div><h2>Readback log</h2><p>ประวัติการรับคำขอ ส่งต่อ และคืนผลของ Genome Hub</p></div><div class="intro-actions"><button class="button" data-action="request-report">จำลอง readback</button></div></section><section class="panel"><div class="panel-header"><div><h3>Recent activity</h3><p>Local mock events · live connection not verified</p></div><span class="badge badge--orange">mock</span></div><div class="timeline"><div class="timeline-item"><span class="timeline-marker"></span><div><strong>Report contract loaded</strong><span>Genome Greenhouse → Genome Hub · required fields validated</span></div><span class="timeline-time">10:58</span></div><div class="timeline-item"><span class="timeline-marker"></span><div><strong>Pending work request registered</strong><span>Genome Office → Hub · awaiting HERMES runtime route</span></div><span class="timeline-time">10:54</span></div><div class="timeline-item"><span class="timeline-marker"></span><div><strong>Hub surface opened</strong><span>Metropolis → three Genomes · local scaffold</span></div><span class="timeline-time">10:52</span></div></div></section>`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function render(view = "home") {
  currentViewLabel.textContent = viewMeta[view].label;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.view === view));
  if (view === "home") renderHome();
  else if (["shop", "office", "greenhouse"].includes(view)) renderGenome(view);
  else if (view === "reports") renderReports();
  else renderActivity();
}

document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-office-work-form]');
  if (!form) return;
  event.preventDefault();
  const workId = String(new FormData(form).get('workId') || '').trim();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'กำลังอ่าน...';
  try {
    const response = await fetch('/api/office/work?workId=' + encodeURIComponent(workId), {
      method: 'GET', cache: 'no-store', credentials: 'same-origin'
    });
    const payload = await response.json();
    if (!response.ok || payload.source !== 'METROPOLIS_OWNER_READBACK' || !payload.report) {
      throw new Error(String(payload.code || 'OWNER_READ_FAILED'));
    }
    liveOfficeReport = payload.report;
    render('office');
    showToast('อ่านจาก Metropolis แล้ว · ' + liveOfficeReport.freshness);
  } catch (error) {
    showToast('ยังอ่าน Work จริงไม่ได้: ' + String(error.message || 'UNKNOWN'));
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      submit.textContent = 'อ่านสถานะ';
    }
  }
});

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  const viewAction = event.target.closest("[data-view-action]");
  const action = event.target.closest("[data-action]");
  if (nav) render(nav.dataset.view);
  if (viewAction) render(viewAction.dataset.viewAction);
  if (!action) return;
  if (action.dataset.action === "request-report") showToast("สร้างคำขอรีพอร์ตแบบ mock แล้ว — ยังไม่ส่งไป runtime ภายนอก");
  if (action.dataset.action === "open-report") { render("reports"); showToast("เปิด report contract และ readback ล่าสุด"); }
  if (action.dataset.action === "new-request") showToast("พร้อมรับคำขอใหม่ — Hub adapter ยังอยู่ในโหมด mock");
});

render();