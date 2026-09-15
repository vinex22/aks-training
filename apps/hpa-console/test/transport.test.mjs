import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createClusterClient } from '../cluster.mjs';

test('DELETE transmits foreground propagation and UID preconditions over HTTP', async context => {
  let received;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received = { body, length: request.headers['content-length'], method: request.method, path: request.url };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'Success' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.close(); server.closeAllConnections(); });
  const client = createClusterClient({
    read: async () => 'test-fixture',
    transport: (options, response) => httpRequest({ ...options, hostname: '127.0.0.1', port: server.address().port }, response),
  });
  const options = { kind: 'DeleteOptions', apiVersion: 'v1', propagationPolicy: 'Foreground', preconditions: { uid: 'test-job-uid' } };
  assert.deepEqual(await client('DELETE', '/apis/batch/v1/namespaces/{namespace}/jobs/hpa-load', options), { status: 'Success' });
  assert.equal(received.method, 'DELETE');
  assert.equal(received.path, '/apis/batch/v1/namespaces/hpa-flat/jobs/hpa-load');
  assert.deepEqual(JSON.parse(received.body), options);
  assert.equal(Number(received.length), Buffer.byteLength(JSON.stringify(options)));
});