import assert from 'node:assert/strict';
import test from 'node:test';
import { runProcessor } from '../processor.mjs';
import { readInCluster } from '../kube-api.mjs';

test('processor finishes and deletes an in-flight message after a shutdown request', async () => {
  const controller = new AbortController();
  const actions = [];
  const queue = {
    receiveMessages: async options => { actions.push(['receive', options]); return { receivedMessageItems: [{ messageId: 'message-1', popReceipt: 'receipt-1', dequeueCount: 1 }] }; },
    deleteMessage: async (...args) => { actions.push(['delete', ...args]); },
  };
  await runProcessor({ queue, signal: controller.signal, log() {}, pause: async () => controller.abort() });
  assert.equal(actions[0][1].visibilityTimeout, 120);
  assert.equal(actions[1][0], 'delete');
  assert.equal(actions[1][1], 'message-1');
  assert.equal(actions[1][2], 'receipt-1');
});

test('processor does not delete a message when processing fails', async () => {
  const controller = new AbortController();
  let deleted = false;
  await runProcessor({
    signal: controller.signal, log() {}, pause: async () => { controller.abort(); throw new Error('interrupted'); },
    queue: { receiveMessages: async () => ({ receivedMessageItems: [{ messageId: 'one' }] }), deleteMessage: async () => { deleted = true; } },
  });
  assert.equal(deleted, false);
});

test('in-cluster telemetry uses only fixed namespaced read endpoints', async () => {
  const paths = [];
  const items = await readInCluster(async path => { paths.push(path); return path.includes('/pods?') ? { kind: 'PodList', items: [{ metadata: { name: 'consumer' } }] } : null; });
  assert.equal(paths.length, 4);
  assert.ok(paths.every(path => path.includes('/namespaces/keda-lab/')));
  assert.deepEqual(items, [{ kind: 'Pod', metadata: { name: 'consumer' } }]);
});