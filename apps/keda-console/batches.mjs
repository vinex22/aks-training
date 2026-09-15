import { randomUUID } from 'node:crypto';

export function createBatches({ send, log = console.log, timeoutMs = 60000 } = {}) {
  let controller;
  let running;
  let current = null;
  const history = [];
  const requests = new Map();
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const snapshot = () => ({ current: current ? { ...current } : null, history: history.map(item => ({ ...item })) });
  return {
    snapshot,
    start({ count, requestId } = {}) {
      if (!Number.isInteger(count) || count < 1 || count > 500) throw fail('Choose a whole number of messages from 1 to 500.');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) throw fail('A valid request ID is required.');
      const duplicate = requests.get(requestId);
      if (duplicate) {
        if (duplicate.count !== count) throw fail('Request ID was already used with a different count.', 409);
        return { id: duplicate.id, duplicate: true };
      }
      if (running) throw fail('A batch is already being sent.', 409);
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
      current = { id: randomUUID(), requested: count, sent: 0, failed: 0, status: 'Sending', startedAt: new Date().toISOString(), finishedAt: null, error: null };
      const batch = current;
      requests.set(requestId, { id: batch.id, count });
      if (requests.size > 100) requests.delete(requests.keys().next().value);
      log(JSON.stringify({ event: 'batch_started', id: batch.id, count }));
      running = Promise.resolve().then(async () => {
        for (let sequence = 1; sequence <= count; sequence += 1) {
          if (signal.aborted) break;
          const message = { id: randomUUID(), batchId: batch.id, sequence, createdAt: new Date().toISOString(), source: 'keda-training-console' };
          try {
            await send(JSON.stringify(message), { abortSignal: signal, messageTimeToLive: 3600 });
            batch.sent += 1;
            if (sequence % 25 === 0) log(JSON.stringify({ event: 'batch_progress', id: batch.id, sent: batch.sent, requested: count }));
          } catch (error) {
            batch.failed += 1;
            batch.error = `${error.message}. The last request may have reached Azure even without an acknowledgement; it will not be retried automatically.`;
            break;
          }
        }
        batch.status = batch.sent === count ? 'Completed' : batch.failed ? 'Failed' : controller.signal.aborted ? 'Cancelled' : 'Timed out';
        batch.finishedAt = new Date().toISOString();
        history.unshift({ ...batch });
        history.splice(10);
        log(JSON.stringify({ event: 'batch_finished', ...batch }));
      }).finally(() => { running = null; });
      return { id: batch.id, duplicate: false };
    },
    cancel() { controller?.abort(); return { cancelling: Boolean(running) }; },
    async settled() { await running; },
  };
}