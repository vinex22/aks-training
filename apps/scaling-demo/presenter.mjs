import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { actions, displayCommand, kubectl, publicActions } from './catalog.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const assets = new Map([
  ['/', ['public/index.html', 'text/html']],
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/style.css', ['public/style.css', 'text/css']],
  ['/xterm.js', ['node_modules/@xterm/xterm/lib/xterm.js', 'text/javascript']],
  ['/xterm.css', ['node_modules/@xterm/xterm/css/xterm.css', 'text/css']],
  ['/fit.js', ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'text/javascript']],
  ['/icons.js', ['node_modules/lucide/dist/umd/lucide.js', 'text/javascript']],
]);

export function execute(step, { signal, output }) {
  return new Promise((resolve, reject) => {
    output(`$ ${displayCommand(step)}\n`);
    if (step.input) output(`${step.input}\n`);
    const child = spawn(step.file, step.args, { cwd: root, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let captured = '';
    let bytes = 0;
    let timeout = false;
    let killTimer;
    const stop = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
    };
    const timer = setTimeout(() => { timeout = true; output('\nTime limit reached; stopping this command.\n'); stop(); }, step.watch ? 45000 : 75000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const consume = (chunk, capture) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 2 * 1024 * 1024) { stop(); return; }
      const text = stripVTControlCharacters(chunk).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
      if (capture) captured += text;
      output(text);
    };
    child.stdout.setEncoding('utf8').on('data', chunk => consume(chunk, true));
    child.stderr.setEncoding('utf8').on('data', chunk => consume(chunk, false));
    child.stdin.on('error', () => {});
    child.stdin.end(step.input || '');
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', stop);
      if (signal.aborted) return reject(new Error('Stopped by presenter; completed changes are not rolled back.'));
      if (bytes > 2 * 1024 * 1024) return reject(new Error('Output limit exceeded.'));
      if (timeout && step.watch) return resolve(captured);
      if (code !== 0 || timeout) return reject(new Error(`Command exited with code ${code}. Inspect the output above.`));
      resolve(captured);
    });
  });
}

export function createPresenter({ run = execute } = {}) {
  let active = null;
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    const send = (code, body) => {
      response.writeHead(code, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/healthz' && request.method === 'GET') return send(200, { healthy: true });
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(request.headers.host || '')) return send(403, { error: 'Use a localhost port-forward.' });
      if (request.method === 'GET' && pathname === '/api/actions') return send(200, { actions: publicActions(), active: active?.id || null });
      if (request.method === 'POST') {
        if (request.headers['x-demo-intent'] !== 'run') return send(403, { error: 'Missing presenter intent header.' });
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) return send(403, { error: 'Cross-origin execution denied.' });
        if (request.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Cross-site execution denied.' });
        if (pathname === '/api/stop') {
          active?.controller.abort();
          return send(200, { stopped: Boolean(active) });
        }
        if (pathname !== '/api/run') return send(404, { error: 'Not found' });
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 1024) return send(413, { error: 'Request too large' });
        }
        let payload;
        try { payload = JSON.parse(body); } catch { return send(400, { error: 'Invalid JSON' }); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(400, { error: 'Select a supported action.' });
        const action = actions.find(candidate => candidate.id === payload.id);
        if (!action || Object.keys(payload).some(key => !['id', 'confirmed'].includes(key))) return send(400, { error: 'Select a supported action.' });
        if (action.mutation && payload.confirmed !== true) return send(400, { error: 'Confirm this lab change before running.' });
        if (active) return send(409, { error: `Action already running: ${active.id}` });
        const controller = new AbortController();
        active = { id: action.id, controller };
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'X-Accel-Buffering': 'no' });
        const emit = message => { if (!response.destroyed) response.write(`${JSON.stringify(message)}\n`); };
        const options = { signal: controller.signal, output: text => emit({ type: 'output', text }) };
        response.on('close', () => controller.abort());
        console.log(JSON.stringify({ event: 'action_started', action: action.id }));
        try {
          let previous = '';
          for (const step of action.steps) {
            if (controller.signal.aborted) throw new Error('Action stopped.');
            previous = await run(step, options);
          }
          if (action.eviction) {
            const pod = JSON.parse(previous).items.find(item => !item.metadata.deletionTimestamp && item.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'));
            if (!pod || !/^[a-z0-9-]+$/.test(pod.metadata.name)) throw new Error('No Ready cpu-web pod. Establish the baseline first.');
            const input = JSON.stringify({ apiVersion: 'policy/v1', kind: 'Eviction', metadata: { name: pod.metadata.name, namespace: 'scaling-lab' }, deleteOptions: { preconditions: { uid: pod.metadata.uid } } });
            await run({ ...kubectl('create', `--raw=/api/v1/namespaces/scaling-lab/pods/${pod.metadata.name}/eviction`, '-f', '-'), input }, options);
          }
          emit({ type: 'done', ok: true });
          console.log(JSON.stringify({ event: 'action_finished', action: action.id, ok: true }));
        } catch (error) {
          emit({ type: 'output', text: `\n${error.message}\n` });
          emit({ type: 'done', ok: false });
          console.log(JSON.stringify({ event: 'action_finished', action: action.id, ok: false }));
        } finally {
          active = null;
          response.end();
        }
        return;
      }
      const asset = assets.get(pathname);
      if (request.method !== 'GET' || !asset) return send(404, { error: 'Not found' });
      const content = await readFile(`${root}${asset[0]}`);
      response.writeHead(200, { 'Content-Type': asset[1] });
      response.end(content);
    } catch {
      if (!response.headersSent) send(500, { error: 'Presenter request failed' });
      else response.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return { server, stop: () => active?.controller.abort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createPresenter();
  const port = Number(process.env.PORT || 8080);
  app.server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'presenter_listening', port })));
  const stop = () => { app.stop(); app.server.close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}