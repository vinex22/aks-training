import { pbkdf2 } from 'node:crypto';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const deriveKey = promisify(pbkdf2);

export function createWebServer({
  pod = process.env.POD_NAME || hostname(),
  namespace = process.env.POD_NAMESPACE || 'local',
  node = process.env.NODE_NAME || 'local',
  iterations = 250000,
  log = console.log,
} = {}) {
  let draining = false;
  let inFlight = 0;
  let completed = 0;
  let totalMs = 0;
  const started = Date.now();
  const identity = { pod, namespace, node, version: '1.0.0' };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Pod-Name', pod);
    const send = (code, body) => {
      response.writeHead(code, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && pathname === '/healthz') return send(200, { healthy: true });
    if (request.method === 'GET' && pathname === '/readyz') return send(draining ? 503 : 200, { ready: !draining });
    if (request.method === 'GET' && (pathname === '/status' || pathname === '/')) {
      return send(200, {
        ...identity, draining, inFlight, completed,
        uptimeSeconds: Math.floor((Date.now() - started) / 1000),
        averageMs: completed ? Math.round(totalMs / completed) : 0,
      });
    }
    if (pathname !== '/work' || request.method !== 'POST') return send(404, { error: 'Not found' });
    if (draining) return send(503, { ...identity, error: 'Pod is draining' });
    if (inFlight >= 8) return send(429, { ...identity, error: 'Work queue full' });
    inFlight += 1;
    const requestStarted = performance.now();
    try {
      await deriveKey('synthetic-training-work', 'fixed-demo-salt', iterations, 32, 'sha256');
      const durationMs = Math.round(performance.now() - requestStarted);
      completed += 1;
      totalMs += durationMs;
      const result = { ...identity, event: 'work_completed', sequence: completed, durationMs };
      log(JSON.stringify(result));
      send(200, result);
    } catch {
      send(500, { ...identity, error: 'Work failed' });
    } finally {
      inFlight -= 1;
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  return {
    server,
    drain() {
      draining = true;
      log(JSON.stringify({ ...identity, event: 'draining', inFlight }));
      server.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createWebServer();
  const port = Number(process.env.PORT || 8080);
  app.server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port })));
  process.once('SIGTERM', app.drain);
  process.once('SIGINT', app.drain);
}