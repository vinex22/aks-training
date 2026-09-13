import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { integer } from './config.mjs';

const action = process.argv[2] || 'status';
if (!['seed', 'status'].includes(action)) throw new Error('Use: node queue.mjs seed [count] | status');
const count = action === 'seed' ? integer(process.argv[3], 200, 1, 5000, 'count') : 0;
const client = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
  socket: { connectTimeout: 5000, reconnectStrategy: false },
});
client.on('error', error => console.error(JSON.stringify({ event: 'redis_error', type: error.name })));
try {
  await client.connect();
  if (action === 'seed') {
    const batch = randomUUID().slice(0, 8);
    await client.rPush('jobs', Array.from({ length: count }, (_, index) => `${batch}-${index + 1}`));
    console.log(JSON.stringify({ event: 'jobs_enqueued', batch, count }));
  }
  const [waiting, processing, completed] = await client.multi().lLen('jobs').lLen('processing').get('completed').exec();
  console.log(JSON.stringify({ event: 'queue_status', waiting, processing, completed: Number(completed || 0) }));
} finally {
  if (client.isOpen) await client.close();
}