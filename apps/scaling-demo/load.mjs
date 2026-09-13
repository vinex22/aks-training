import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { integer } from './config.mjs';

export async function runLoad({ url, durationSeconds = 120, concurrency = 2, log = console.log, signal }) {
  integer(durationSeconds, 120, 1, 600, 'DURATION_SECONDS');
  integer(concurrency, 2, 1, 8, 'CONCURRENCY');
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('TARGET_URL must use HTTP or HTTPS');
  const deadline = AbortSignal.timeout(durationSeconds * 1000);
  const stop = signal ? AbortSignal.any([deadline, signal]) : deadline;
  const servedBy = Object.create(null);
  let succeeded = 0;
  let failed = 0;
  let totalMs = 0;
  const snapshot = event => ({
    event, generator: hostname(), succeeded, failed,
    averageMs: succeeded ? Math.round(totalMs / succeeded) : 0,
    servedBy: { ...servedBy },
  });
  log(JSON.stringify({ event: 'load_started', target: target.origin + target.pathname, durationSeconds, concurrency }));
  const report = setInterval(() => log(JSON.stringify(snapshot('load_progress'))), 5000);
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (!stop.aborted) {
        const started = performance.now();
        try {
          const response = await fetch(target, {
            method: 'POST', headers: { Connection: 'close' },
            signal: AbortSignal.any([stop, AbortSignal.timeout(10000)]),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const result = await response.json();
          if (typeof result.pod !== 'string' || !result.pod) throw new Error('Response missing pod identity');
          succeeded += 1;
          totalMs += performance.now() - started;
          servedBy[result.pod] = (servedBy[result.pod] || 0) + 1;
        } catch {
          if (!stop.aborted) failed += 1;
        }
        await delay(20, undefined, { signal: stop }).catch(() => {});
      }
    }));
  } finally {
    clearInterval(report);
  }
  const result = snapshot('load_finished');
  log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  const result = await runLoad({
    url: process.env.TARGET_URL || 'http://cpu-web/work',
    durationSeconds: integer(process.env.DURATION_SECONDS, 120, 1, 600, 'DURATION_SECONDS'),
    concurrency: integer(process.env.CONCURRENCY, 2, 1, 8, 'CONCURRENCY'),
    signal: controller.signal,
  });
  if (result.succeeded === 0) process.exitCode = 1;
}