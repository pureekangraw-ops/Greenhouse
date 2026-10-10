// Explicit fail-closed boundary until the existing owner-authorized Hub adapter is connected.
export async function onRequest({request, params}) {
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path;
  const code = path === 'operations' ? 'OPERATIONS_READER_UNAVAILABLE'
    : path === 'inbox' ? 'HUB_READER_UNAVAILABLE'
    : 'OWNER_API_UNAVAILABLE';
  return Response.json({code}, {status: request.method === 'GET' ? 503 : 405,
    headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
}
