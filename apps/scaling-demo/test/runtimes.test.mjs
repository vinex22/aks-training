import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { integer } from '../config.mjs';
import { runLoad } from '../load.mjs';
import { runWorker } from '../worker.mjs';
import { createWebServer } from '../web.mjs';

test('configuration rejects unbounded durations and concurrency', () => {
  assert.equal(integer(undefined, 2, 1, 8, 'concurrency'), 2);
  for (const value of ['abc', '1.5', '0', '9']) assert.throws(() => integer(value, 2, 1, 8, 'concurrency'));
});

test('load ends at its deadline and reports the serving pod', async context => {
  const app = createWebServer({ pod: 'web-test', iterations: 1000, log() {} });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  context.after(() => new Promise(resolve => app.server.close(resolve)));
  const result = await runLoad({
    url: `http://127.0.0.1:${app.server.address().port}/work`,
    durationSeconds: 1, concurrency: 2, log() {},
  });
  assert.ok(result.succeeded > 0);
  assert.equal(result.servedBy['web-test'], result.succeeded);
  assert.equal(result.failed, 0);
});

test('worker acknowledges in-flight work before honoring shutdown', async () => {
  const controller = new AbortController();
  const calls = [];
  const transaction = {
    lRem(...args) { calls.push(['lRem', ...args]); return this; },
    incr(...args) { calls.push(['incr', ...args]); return this; },
    async exec() { calls.push(['exec']); },
  };
  const client = {
    async blMove(...args) { calls.push(['blMove', ...args]); controller.abort(); return 'job-1'; },
    multi() { return transaction; },
  };
  const logs = [];
  await runWorker({ client, signal: controller.signal, workMs: 1, log: line => logs.push(JSON.parse(line)) });
  assert.deepEqual(calls, [
    ['blMove', 'jobs', 'processing', 'LEFT', 'RIGHT', 1],
    ['lRem', 'processing', 1, 'job-1'], ['incr', 'completed'], ['exec'],
  ]);
  assert.deepEqual(logs.map(entry => entry.event), ['worker_started', 'job_started', 'job_completed', 'worker_stopped']);
});