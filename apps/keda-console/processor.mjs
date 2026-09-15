import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createQueueClient } from './azure.mjs';

export async function runProcessor({ queue = createQueueClient(), signal, processingSeconds = 3, pause = delay, log = console.log } = {}) {
  if (!Number.isInteger(processingSeconds) || processingSeconds < 1 || processingSeconds > 10) throw new Error('Processing time must be 1-10 seconds.');
  log(JSON.stringify({ event: 'processor_started', pod: process.env.HOSTNAME, processingSeconds }));
  while (!signal.aborted) {
    try {
      const response = await queue.receiveMessages({ numberOfMessages: 1, visibilityTimeout: 120, abortSignal: signal });
      const message = response.receivedMessageItems[0];
      if (!message) {
        await pause(1000, undefined, { signal });
        continue;
      }
      log(JSON.stringify({ event: 'processing', id: message.messageId, dequeueCount: message.dequeueCount }));
      await pause(processingSeconds * 1000);
      await queue.deleteMessage(message.messageId, message.popReceipt, { abortSignal: AbortSignal.timeout(10000) });
      log(JSON.stringify({ event: 'processed', id: message.messageId }));
    } catch (error) {
      if (signal.aborted) break;
      log(JSON.stringify({ event: 'processor_error', code: error.code || error.name }));
      await pause(5000, undefined, { signal }).catch(() => {});
    }
  }
  log(JSON.stringify({ event: 'processor_stopped' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  await runProcessor({ signal: controller.signal, processingSeconds: Number(process.env.MESSAGE_PROCESSING_SECONDS || 3) });
}