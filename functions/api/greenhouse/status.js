// Pages adapter: report actual owner integration state, never infer a session from a static page.
export async function onRequestGet() {
  return Response.json({
    ownerSession: false,
    inboxReader: false,
    eventIngress: false,
    remoteCommands: false,
    privateDataCached: false,
    code: 'OWNER_SESSION_UNAVAILABLE'
  }, {headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
}
