import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createLab } from './cluster.mjs';

export function createConsole({ lab = createLab(), log = console.log } = {}) {
  let cached;
  let cachedAt = 0;
  let refresh;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (code, value) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && path === '/healthz') return send(200, { healthy: true });
    const host = request.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return send(403, { error: 'Use the localhost-only Service tunnel.' });
    try {
      if (request.method === 'GET' && path === '/api/status') {
        if (!cached || Date.now() - cachedAt > 2000) {
          refresh ||= lab.status().then(value => { cached = value; cachedAt = Date.now(); }).finally(() => { refresh = null; });
          await refresh;
        }
        return send(200, cached);
      }
      if (request.method === 'POST' && ['/api/start', '/api/stop'].includes(path)) {
        if (request.headers['x-hpa-console'] !== '1' || (request.headers.origin && request.headers.origin !== `http://${host}`)) return send(403, { error: 'Same-origin request required.' });
        let result;
        if (path === '/api/start') {
          let body = '';
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 1024) return send(413, { error: 'Request too large.' });
          }
          let options;
          try { options = JSON.parse(body); } catch { return send(400, { error: 'Invalid JSON.' }); }
          result = await lab.start(options || {});
        } else result = await lab.stop();
        cachedAt = 0;
        log(JSON.stringify({ event: path.slice(5), ...result }));
        return send(202, result);
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icons.js': ['icons.js', 'text/javascript'] };
      if (request.method === 'GET' && assets[path]) {
        const [file, type] = assets[path];
        const location = path === '/icons.js'
          ? process.env.ICONS_FILE || new URL('./node_modules/lucide/dist/umd/lucide.min.js', import.meta.url)
          : new URL(`./public/${file}`, import.meta.url);
        const content = await readFile(location);
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return response.end(content);
      }
      send(404, { error: 'Not found.' });
    } catch (error) {
      const status = [400, 409].includes(error.status) ? error.status : 503;
      log(JSON.stringify({ event: 'request_failed', status, message: error.message }));
      send(status, { error: error.message });
    }
  });
  server.requestTimeout = 12000;
  server.headersTimeout = 12000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createConsole();
  const port = Number(process.env.PORT || 8080);
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'console_listening', port })));
  const stop = () => { server.close(); server.closeIdleConnections(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}