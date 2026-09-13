import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createPresenter } from '../presenter.mjs';
import { actions } from '../catalog.mjs';

async function start(context) {
  const commands = [];
  const app = createPresenter({ run: async (step, { output }) => { commands.push(step); output('test output\n'); return '{}'; } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  context.after(() => new Promise(resolve => { app.server.close(resolve); app.server.closeIdleConnections(); }));
  return { commands, url: `http://127.0.0.1:${app.server.address().port}` };
}

test('presenter rejects arbitrary commands and unconfirmed changes', async context => {
  const app = await start(context);
  for (const payload of [null, [], { id: 'inspect', command: 'sh' }, { id: 'unknown' }, { id: 'web' }]) {
    const response = await fetch(`${app.url}/api/run`, { method: 'POST', headers: { 'X-Demo-Intent': 'run' }, body: JSON.stringify(payload) });
    assert.equal(response.status, 400);
  }
  assert.equal(app.commands.length, 0);
});

test('presenter refuses cross-origin requests and streams allowlisted commands', async context => {
  const app = await start(context);
  const request = { method: 'POST', headers: { 'X-Demo-Intent': 'run' }, body: JSON.stringify({ id: 'inspect' }) };
  assert.equal((await fetch(`${app.url}/api/run`, { ...request, headers: {} })).status, 403);
  assert.equal((await fetch(`${app.url}/api/run`, { ...request, headers: { ...request.headers, Origin: 'https://untrusted.example' } })).status, 403);
  const response = await fetch(`${app.url}/api/run`, request);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).ok, true);
  assert.equal(app.commands[0].file, 'kubectl');
  assert.ok(app.commands[0].args.includes('--namespace=scaling-lab'));
});

test('catalog cannot alter clusters, namespaces, roles, or invoke a shell', () => {
  for (const action of actions) {
    for (const step of action.steps) {
      assert.ok(['kubectl', 'node'].includes(step.file));
      assert.doesNotMatch(step.args.join(' '), /clusterrole|rolebinding|delete namespace|drain|cordon|aks update/);
      if (step.file === 'kubectl') assert.ok(step.args.includes('--context=lab'));
    }
  }
});

test('presenter serves its terminal, styles and icons locally', async context => {
  const app = await start(context);
  for (const path of ['/', '/app.js', '/style.css', '/xterm.js', '/xterm.css', '/fit.js', '/icons.js']) {
    const response = await fetch(`${app.url}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0);
  }
});