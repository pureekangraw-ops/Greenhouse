const connection = document.querySelector('#connection');
const statusHeading = document.querySelector('#status-heading');
const statusPill = document.querySelector('#status-pill');
const statusDetail = document.querySelector('#status-detail');
const inbox = document.querySelector('#inbox');
const refreshButton = document.querySelector('#refresh');

function text(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function offline(code = 'HUB_READER_UNAVAILABLE') {
  connection.innerHTML = '<i></i> Not connected';
  statusHeading.textContent = 'Not connected';
  statusPill.textContent = 'UNKNOWN';
  statusPill.className = 'pill pill--unknown';
  statusDetail.textContent = code === 'OWNER_SESSION_REQUIRED'
    ? 'Sign in through the existing owner-authenticated Hub route to view private Work.'
    : 'The offline app shell is ready. No private work data is cached or shown.';
  inbox.innerHTML = '<div class="empty"><span class="empty-icon">↻</span><h3>No verified readbacks yet</h3><p>Connect the authorized Hub reader to load existing Work. Greenhouse will not create Work or infer status.</p></div>';
}
async function loadInbox() {
  refreshButton.disabled = true;
  try {
    const statusRes = await fetch('/api/greenhouse/status', {cache:'no-store', credentials:'same-origin'});
    const status = await statusRes.json();
    if (!statusRes.ok) throw new Error(status.code || 'HUB_READER_UNAVAILABLE');
    if (!status.ownerSession || !status.inboxReader) { offline('HUB_READER_UNAVAILABLE'); return; }
    const response = await fetch('/api/greenhouse/inbox', {cache:'no-store', credentials:'same-origin'});
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.code || 'HUB_READER_UNAVAILABLE');
    connection.innerHTML = '<i></i> Authorized reader connected';
    statusHeading.textContent = 'Reader connected';
    statusPill.textContent = 'CONNECTED';
    statusPill.className = 'pill pill--online';
    statusDetail.textContent = 'Read-only data is returned by the authorized Hub. Observed at ' + text(payload.observedAt || 'UNKNOWN') + '.';
    if (!payload.items.length) { inbox.innerHTML = '<div class="empty"><span class="empty-icon">✓</span><h3>No current readbacks</h3><p>The authorized Hub reader returned an empty inbox at ' + text(payload.observedAt) + '.</p></div>'; return; }
    inbox.innerHTML = payload.items.map(item => `<article class="readback"><h3>${text(item.title || 'Owner readback')}</h3><p>Source: ${text(item.ownerSource || 'UNKNOWN')} · Confidence: ${text(item.confidence || 'UNKNOWN')}</p><p>Observed: ${text(item.observedAt || 'UNKNOWN')} · Freshness: ${text(item.freshness || 'UNKNOWN')}</p><code>${text(item.workId || 'No Work ID supplied')}</code></article>`).join('');
  } catch (error) { offline(String(error.message || 'HUB_READER_UNAVAILABLE')); }
  finally { refreshButton.disabled = false; }
}
document.querySelector('#refresh').addEventListener('click', loadInbox);
document.querySelector('#reload').addEventListener('click', loadInbox);
loadInbox();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/greenhouse/sw.js', {scope:'/greenhouse/'}).catch(() => {});
