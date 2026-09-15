import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createLab, loadJob } from '../cluster.mjs';
import { createConsole } from '../server.mjs';

test('load Job fixes its target and bounds resources, workers, duration and privileges', () => {
  const job = loadJob({ workers: 4, durationSeconds: 120 });
  assert.equal(job.spec.activeDeadlineSeconds, 150);
  assert.equal(job.metadata.namespace, 'hpa-flat');
  const pod = job.spec.template.spec;
  assert.equal(pod.automountServiceAccountToken, false);
  assert.match(pod.containers[0].args[0], /http:\/\/php-apache\//);
  assert.equal(pod.containers[0].securityContext.runAsNonRoot, true);
  for (const options of [{ workers: 9, durationSeconds: 60 }, { workers: 1, durationSeconds: 301 }, { workers: '2', durationSeconds: 60 }, { workers: 1, durationSeconds: 0 }]) assert.throws(() => loadJob(options));
});

test('start and stop affect only the named load Job and use UID deletion protection', async () => {
  let existing;
  const calls = [];
  const lab = createLab({ request: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') { if (existing) return existing; const error = new Error('Missing'); error.status = 404; throw error; }
    if (method === 'POST') existing = { ...body, metadata: { ...body.metadata, uid: 'job-123' } };
    return {};
  } });
  assert.deepEqual(await lab.start({ workers: 2, durationSeconds: 60 }), { started: true });
  await assert.rejects(() => lab.start({ workers: 1, durationSeconds: 60 }), /already exists/);
  await lab.stop();
  const deletion = calls.find(call => call.method === 'DELETE');
  assert.ok(deletion.path.endsWith('/jobs/hpa-load'));
  assert.equal(deletion.body.preconditions.uid, 'job-123');
  assert.equal(deletion.body.propagationPolicy, 'Foreground');
});

test('HTTP API rejects untrusted mutation and reports real backend errors', async context => {
  let starts = 0;
  const server = createConsole({ log() {}, lab: {
    status: async () => { throw new Error('Metrics unavailable'); },
    start: async options => { loadJob(options); starts += 1; return { started: true }; },
    stop: async () => ({ stopping: true }),
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/api/start`, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${url}/api/start`, { method: 'POST', headers: { 'X-HPA-Console': '1', Origin: 'http://bad.example' } })).status, 403);
  const response = await fetch(`${url}/api/start`, { method: 'POST', headers: { 'X-HPA-Console': '1' }, body: JSON.stringify({ workers: 2, durationSeconds: 60 }) });
  assert.equal(response.status, 202);
  assert.equal(starts, 1);
  const status = await fetch(`${url}/api/status`);
  assert.equal(status.status, 503);
  assert.equal((await status.json()).error, 'Metrics unavailable');
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
});

test('console serves local UI and Lucide icons without external browser dependencies', async context => {
  const server = createConsole({ log() {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/app.js', '/style.css', '/icons.js']) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.ok((await response.text()).length > 100);
  }
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  const untrustedStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers: { Host: 'untrusted.example' } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(untrustedStatus, 403);
});