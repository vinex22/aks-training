const byId = id => document.getElementById(id);
const terminal = new Terminal({
  convertEol: true, disableStdin: true, cursorBlink: false, scrollback: 3000,
  fontFamily: 'Menlo, Consolas, monospace', fontSize: 12, lineHeight: 1.35,
  theme: { background: '#141c1a', foreground: '#d9e6dd', cursor: '#8dbd9f', selectionBackground: '#3d5b49' },
});
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit);
terminal.open(byId('terminal'));
new ResizeObserver(() => fit.fit()).observe(byId('terminal'));
lucide.createIcons();
let catalog = [];
let selected;
let phase = 'HPA';
let busy = false;

function updateRun() {
  byId('run').disabled = busy || !selected || (selected.mutation && !byId('confirm').checked);
  byId('stop').disabled = !busy;
}

function select(action) {
  selected = action;
  byId('phase-label').textContent = action.phase;
  byId('action-title').textContent = action.label;
  byId('description').textContent = action.description;
  byId('expected').textContent = action.expected;
  byId('command-preview').textContent = action.commands.join('\n');
  byId('command-count').textContent = `${action.commands.length} command${action.commands.length === 1 ? '' : 's'}`;
  byId('mode').textContent = action.mutation ? 'CHANGES LAB' : 'READ ONLY';
  byId('mode').classList.toggle('mutation', Boolean(action.mutation));
  byId('confirm-label').hidden = !action.mutation;
  byId('confirm').checked = false;
  document.querySelectorAll('.step').forEach(button => button.setAttribute('aria-current', String(button.dataset.id === action.id)));
  updateRun();
}

function renderSteps() {
  byId('actions').replaceChildren();
  const filtered = catalog.filter(action => action.phase === phase);
  filtered.forEach((action, index) => {
    const button = document.createElement('button');
    button.className = 'step';
    button.dataset.id = action.id;
    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.textContent = action.label;
    button.append(number, label);
    button.addEventListener('click', () => select(action));
    byId('actions').append(button);
  });
  if (filtered.length) select(filtered[0]);
}

document.querySelectorAll('[data-phase]').forEach(button => {
  button.addEventListener('click', () => {
    phase = button.dataset.phase;
    document.querySelectorAll('[data-phase]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
    renderSteps();
  });
});
byId('confirm').addEventListener('change', updateRun);
byId('clear').addEventListener('click', () => terminal.clear());
byId('stop').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/stop', { method: 'POST', headers: { 'X-Demo-Intent': 'run' } });
    if (!response.ok) throw new Error('Stop request failed');
    terminal.writeln('\nStopping the command. Changes already applied remain in place.');
  } catch (error) { terminal.writeln(error.message); }
});
byId('run').addEventListener('click', async () => {
  const action = selected;
  busy = true;
  updateRun();
  byId('execution-status').textContent = `Running: ${action.label}`;
  terminal.writeln(`\n--- ${action.label} ---\n`);
  let finished = false;
  try {
    const response = await fetch('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-Intent': 'run' },
      body: JSON.stringify({ id: action.id, confirmed: byId('confirm').checked }),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'output') terminal.write(event.text);
        if (event.type === 'done') {
          finished = true;
          byId('execution-status').textContent = event.ok ? 'Completed' : 'Review output';
          terminal.writeln(event.ok ? '\n[command completed]' : '\n[command did not succeed; review the expected observation]');
        }
      }
    }
    if (!finished) throw new Error('Stream disconnected. Inspect the lab state before retrying.');
  } catch (error) {
    terminal.writeln(`\n${error.message}`);
    byId('execution-status').textContent = 'Review output';
  } finally {
    busy = false;
    byId('confirm').checked = false;
    updateRun();
  }
});

async function initialize() {
  try {
    const response = await fetch('/api/actions');
    if (!response.ok) throw new Error('Unable to load presenter actions');
    const data = await response.json();
    catalog = data.actions;
    renderSteps();
    byId('connection').textContent = 'PRESENTER CONNECTED';
    terminal.writeln('AKS Scaling Lab / scaling-lab\n');
    terminal.writeln('Terminal output will appear here.');
    if (data.active) terminal.writeln(`Action already running in another session: ${data.active}`);
  } catch (error) {
    byId('connection').textContent = 'CONNECTION FAILED';
    byId('action-title').textContent = 'Presenter unavailable';
    terminal.writeln(error.message);
  }
}
initialize();