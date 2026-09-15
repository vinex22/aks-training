import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createConsole } from '../server.mjs';

async function start(context, options = {}) {
  const sent = [];
  const app = createConsole({
    log() {},
    queue: { status: async () => ({ account: 'test', name: 'test', approximateMessagesCount: sent.length, error: null }), send: async body => { sent.push(body); } },
    cluster: async () => ({ available: false, reason: 'Processor / KEDA lab not deployed', pods: [], scaler: null, hpa: null }),
    ...options,
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  context.after(app.stop);
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { url, sent, post: (path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'X-KEDA-Console': '1', ...headers }, body: JSON.stringify(body) }) };
}

test('serves all UI assets locally and rejects untrusted Hosts and mutations', async context => {
  const app = await start(context);
  for (const path of ['/', '/app.js', '/style.css', '/icons.js']) {
    const response = await fetch(app.url + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 100);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.equal((await app.post('/api/enqueue', {}, { Origin: 'http://untrusted.example' })).status, 403);
  assert.equal((await fetch(`${app.url}/api/enqueue`, { method: 'POST' })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(app.url, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
    request.end();
  });
  assert.equal(status, 403);
});

test('enqueue is bounded and reports missing processor honestly', async context => {
  const app = await start(context);
  assert.equal((await app.post('/api/enqueue', { count: 501, requestId: 'request-1234567890' })).status, 400);
  assert.equal((await app.post('/api/enqueue', { count: 10, requestId: 'request-1234567890' })).status, 202);
  const status = await (await fetch(`${app.url}/api/status`)).json();
  assert.equal(status.batch.current.sent, 10);
  assert.equal(status.cluster.available, false);
  assert.match(status.cluster.reason, /not deployed/);
  assert.equal((await app.post('/api/cancel')).status, 202);
});

test('queue access errors do not become fake zero queue counts', async context => {
  const app = await start(context, { queue: { status: async () => ({ account: 'test', name: 'test', approximateMessagesCount: null, error: 'Access denied' }), send: async () => { throw new Error('Access denied'); } } });
  const status = await (await fetch(`${app.url}/api/status`)).json();
  assert.equal(status.queue.approximateMessagesCount, null);
  assert.equal(status.queue.error, 'Access denied');
});