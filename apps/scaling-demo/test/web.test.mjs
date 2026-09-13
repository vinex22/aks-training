import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createWebServer } from '../web.mjs';

async function startApp(context, options = {}) {
  const app = createWebServer({ pod: 'demo-pod-1', log() {}, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  context.after(() => new Promise(resolve => {
    app.server.close(resolve);
    app.server.closeIdleConnections();
  }));
  return { ...app, url: `http://127.0.0.1:${app.server.address().port}` };
}

test('work responses identify the pod and update its counters', async context => {
  const app = await startApp(context, { iterations: 1000 });
  const response = await fetch(`${app.url}/work`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-pod-name'), 'demo-pod-1');
  const result = await response.json();
  assert.equal(result.pod, 'demo-pod-1');
  assert.equal(result.sequence, 1);
  assert.equal(result.event, 'work_completed');
  const status = await (await fetch(`${app.url}/status`)).json();
  assert.equal(status.completed, 1);
  assert.equal(status.inFlight, 0);
});

test('CPU work does not block health or readiness endpoints', async context => {
  const app = await startApp(context, { iterations: 5000000 });
  const work = fetch(`${app.url}/work`, { method: 'POST' });
  const health = await fetch(`${app.url}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await fetch(`${app.url}/readyz`)).status, 200);
  const status = await (await fetch(`${app.url}/status`)).json();
  assert.equal(status.inFlight, 1);
  assert.equal(status.completed, 0);
  assert.equal((await work).status, 200);
});

test('read-only endpoints do not generate CPU work', async context => {
  const app = await startApp(context);
  assert.equal((await fetch(`${app.url}/work`)).status, 404);
  assert.equal((await (await fetch(`${app.url}/status`)).json()).completed, 0);
});