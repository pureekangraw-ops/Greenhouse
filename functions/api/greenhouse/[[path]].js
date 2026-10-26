import {createLiveTrackingHttp} from '../../../src/greenhouse/tracking-read.mjs';
// Explicit fail-closed boundary until the existing owner-authorized Hub adapter is connected.
export async function onRequest({request, params,env}) {
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path;
  if(['tracking','tracking/item','status'].includes(path))return createLiveTrackingHttp({env})(request);
  const code = path === 'operations' ? 'OPERATIONS_READER_UNAVAILABLE'
    : path === 'inbox' ? 'HUB_READER_UNAVAILABLE'
    : 'OWNER_API_UNAVAILABLE';
  return Response.json({code}, {status: request.method === 'GET' ? 503 : 405,
    headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
}
