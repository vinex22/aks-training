import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createQueue } from './azure.mjs';
import { createBatches } from './batches.mjs';
import { readCluster } from './cluster.mjs';

export function createConsole({ queue = createQueue(), cluster = readCluster, log = console.log } = {}) {
  const batches = createBatches({ send: (body, options) => queue.send(body, options), log });
  let telemetry;
  let telemetryAt = 0;
  let pendingTelemetry;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (code, body) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && path === '/healthz') return send(200, { healthy: true });
    const host = request.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return send(403, { error: 'Use localhost to access this instructor console.' });
    try {
      if (request.method === 'GET' && path === '/api/status') {
        if (!telemetry || Date.now() - telemetryAt >= 10000) {
          pendingTelemetry ||= Promise.all([queue.status(), cluster()]).then(([queueStatus, clusterStatus]) => {
            telemetry = { observedAt: new Date().toISOString(), queue: queueStatus, cluster: clusterStatus };
            telemetryAt = Date.now();
          }).finally(() => { pendingTelemetry = null; });
          await pendingTelemetry;
        }
        return send(200, { ...telemetry, batch: batches.snapshot() });
      }
      if (request.method === 'POST' && ['/api/enqueue', '/api/cancel'].includes(path)) {
        if (request.headers['x-keda-console'] !== '1' || (request.headers.origin && request.headers.origin !== `http://${host}`)) return send(403, { error: 'Same-origin request required.' });
        if (path === '/api/cancel') return send(202, batches.cancel());
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 1024) return send(413, { error: 'Request too large.' });
        }
        let options;
        try { options = JSON.parse(body); } catch { return send(400, { error: 'Invalid JSON.' }); }
        const result = batches.start(options || {});
        telemetryAt = 0;
        return send(202, result);
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icons.js': ['icons.js', 'text/javascript'] };
      if (request.method === 'GET' && assets[path]) {
        const [file, type] = assets[path];
        const content = await readFile(new URL(path === '/icons.js' ? './node_modules/lucide/dist/umd/lucide.min.js' : `./public/${file}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return response.end(content);
      }
      send(404, { error: 'Not found.' });
    } catch (error) {
      log(JSON.stringify({ event: 'request_failed', message: error.message }));
      send([400, 409].includes(error.status) ? error.status : 503, { error: error.message });
    }
  });
  server.requestTimeout = 12000;
  server.headersTimeout = 12000;
  const stop = () => { batches.cancel(); server.close(); server.closeIdleConnections(); };
  return { server, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createConsole();
  const port = Number(process.env.PORT || 18083);
  const host = process.env.KUBERNETES_SERVICE_HOST ? '0.0.0.0' : '127.0.0.1';
  app.server.listen(port, host, () => console.log(JSON.stringify({ event: 'keda_console_listening', host, port })));
  process.once('SIGTERM', app.stop);
  process.once('SIGINT', app.stop);
}