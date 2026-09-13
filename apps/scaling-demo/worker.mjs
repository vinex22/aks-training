import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from 'redis';
import { integer } from './config.mjs';

export async function runWorker({ client, signal, workMs = 2000, pod = hostname(), log = console.log }) {
  integer(workMs, 2000, 1, 5000, 'WORK_MS');
  const report = (event, fields = {}) => log(JSON.stringify({ event, pod, ...fields }));
  report('worker_started', { workMs });
  while (!signal.aborted) {
    try {
      const job = await client.blMove('jobs', 'processing', 'LEFT', 'RIGHT', 1);
      if (!job) continue;
      report('job_started', { job });
      await delay(workMs);
      await client.multi().lRem('processing', 1, job).incr('completed').exec();
      report('job_completed', { job });
    } catch (error) {
      report('queue_error', { type: error.name });
      await delay(1000);
    }
  }
  report('worker_stopped');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379',
    disableOfflineQueue: true,
    socket: { connectTimeout: 5000, reconnectStrategy: retries => Math.min(200 * (retries + 1), 3000) },
  });
  client.on('error', error => console.log(JSON.stringify({ event: 'redis_connection_error', type: error.name })));
  const connect = client.connect();
  const stopConnecting = () => { if (!client.isReady && client.isOpen) client.destroy(); };
  controller.signal.addEventListener('abort', stopConnecting);
  try {
    await connect;
    await runWorker({
      client, signal: controller.signal,
      pod: process.env.POD_NAME || hostname(),
      workMs: integer(process.env.WORK_MS, 2000, 1, 5000, 'WORK_MS'),
    });
  } finally {
    controller.signal.removeEventListener('abort', stopConnecting);
    if (client.isOpen) await client.close();
  }
}