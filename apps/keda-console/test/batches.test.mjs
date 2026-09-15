import assert from 'node:assert/strict';
import test from 'node:test';
import { createBatches } from '../batches.mjs';

test('sends the exact chosen number of uniquely identified TTL-bounded synthetic messages', async () => {
  const messages = [];
  const batches = createBatches({ log() {}, send: async (body, options) => { messages.push({ message: JSON.parse(body), options }); } });
  batches.start({ count: 12, requestId: 'request-1234567890' });
  await batches.settled();
  assert.equal(messages.length, 12);
  assert.equal(new Set(messages.map(item => item.message.id)).size, 12);
  assert.equal(messages[0].options.messageTimeToLive, 3600);
  assert.equal(batches.snapshot().current.status, 'Completed');
  assert.equal(batches.snapshot().current.sent, 12);
});

test('rejects unsafe bounds, overlapping batches, and conflicting request retries', async () => {
  let release;
  const batches = createBatches({ log() {}, send: () => new Promise(resolve => { release = resolve; }) });
  for (const count of [0, 501, -1, 1.5, '20']) assert.throws(() => batches.start({ count, requestId: 'request-1234567890' }));
  const first = batches.start({ count: 1, requestId: 'request-1234567890' });
  assert.equal(batches.start({ count: 1, requestId: 'request-1234567890' }).id, first.id);
  assert.throws(() => batches.start({ count: 2, requestId: 'request-1234567890' }), /different count/);
  assert.throws(() => batches.start({ count: 1, requestId: 'another-1234567890' }), /already/);
  await Promise.resolve();
  release();
  await batches.settled();
});

test('cancellation stops future sends without deleting already queued messages', async () => {
  let release;
  let calls = 0;
  const batches = createBatches({ log() {}, send: () => { calls += 1; return new Promise(resolve => { release = resolve; }); } });
  batches.start({ count: 50, requestId: 'request-1234567890' });
  await Promise.resolve();
  batches.cancel();
  release();
  await batches.settled();
  assert.equal(calls, 1);
  assert.equal(batches.snapshot().current.sent, 1);
  assert.equal(batches.snapshot().current.status, 'Cancelled');
});

test('send errors preserve confirmed progress and are not retried', async () => {
  let calls = 0;
  const batches = createBatches({ log() {}, send: async () => { calls += 1; if (calls === 3) throw new Error('Network failure'); } });
  batches.start({ count: 50, requestId: 'request-1234567890' });
  await batches.settled();
  assert.equal(calls, 3);
  assert.equal(batches.snapshot().current.sent, 2);
  assert.equal(batches.snapshot().current.failed, 1);
  assert.match(batches.snapshot().current.error, /may have reached Azure/);
});