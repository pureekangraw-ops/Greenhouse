import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readMetropolisWork, MetropolisReadError } from './src/hub/metropolis-read.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const commonHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
};
function send(response, code, data, contentType = 'application/json; charset=utf-8') {
  response.writeHead(code, { ...commonHeaders, 'content-type': contentType });
  response.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function validOrigin(request) {
  const host = request.headers.host;
  // Reject DNS-rebinding hosts, including requests with no Origin header.
  if (!/^127\\.0\\.0\\.1:\\d+$/.test(host || '')) return false;
  const origin = request.headers.origin;
  if (!origin) return true; // Same-origin GET navigations normally omit Origin.
  return origin === 'http://' + host;
}

/** Local-only preview. Do not expose it to the internet without owner login. */
export function createGreenhouseServer({ token = '', fetchImpl = fetch, now = Date.now } = {}) {
  return createServer(async (request, response) => {
    if (!validOrigin(request)) return send(response, 403, { code: 'ORIGIN_DENIED' });
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method !== 'GET') return send(response, 405, { code: 'READ_ONLY' });
    if (url.pathname === '/api/office/work') {
      if ([...url.searchParams.keys()].some(key => key !== 'workId') || url.searchParams.getAll('workId').length !== 1) {
        return send(response, 400, { code: 'WORK_ID_INVALID' });
      }
      try {
        const report = await readMetropolisWork({
          workId: url.searchParams.get('workId'),
          token, fetchImpl, now,
        });
        return send(response, 200, { source: 'METROPOLIS_OWNER_READBACK', report });
      } catch (error) {
        const known = error instanceof MetropolisReadError;
        return send(response, known ? error.status : 502, { code: known ? error.code : 'OWNER_READ_FAILED' });
      }
    }
    const item = staticFiles.get(url.pathname);
    if (!item) return send(response, 404, { code: 'NOT_FOUND' });
    try {
      const content = await readFile(join(root, item[0]), 'utf8');
      return send(response, 200, content, item[1]);
    } catch {
      return send(response, 503, { code: 'STATIC_ASSET_UNAVAILABLE' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const host = '127.0.0.1';
  const port = Number(process.env.PORT || '4173');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('PORT_INVALID');
  }
  const server = createGreenhouseServer({ token: process.env.METROPOLIS_ACCESS_TOKEN || '' });
  server.listen(port, host, () => {
    console.log('Greenhouse preview: http://' + host + ':' + port);
    console.log(process.env.METROPOLIS_ACCESS_TOKEN ? 'Metropolis adapter configured' : 'Metropolis adapter not configured; static/mock only');
  });
}
