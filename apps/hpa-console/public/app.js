const element = id => document.getElementById(id);
const samples = [];
const podElements = new Map();
let snapshot;
let actionPending = false;
let refreshing;
let actionError = '';
let connectionError = '';
let eventsSignature = '';
const icons = () => {
  window.lucide?.createIcons();
  document.querySelectorAll('svg[data-lucide]').forEach(icon => icon.removeAttribute('data-lucide'));
};
const number = value => value == null ? '--' : Number(value).toLocaleString();
const clock = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function showErrors() {
  element('error').textContent = actionError || connectionError;
  element('error').hidden = !(actionError || connectionError);
}

function setControls() {
  const load = snapshot?.load;
  const available = snapshot?.pods.some(pod => pod.ready && !pod.terminating);
  element('start').disabled = actionPending || !available || Boolean(connectionError) || Boolean(load?.exists);
  element('stop').disabled = actionPending || (!load?.exists && !connectionError);
  element('workers').disabled = actionPending || Boolean(load?.exists);
  element('duration').disabled = actionPending || Boolean(load?.exists);
  element('stop-label').textContent = load?.exists && !load.active && load.phase !== 'Stopping' ? 'Clear run' : 'Stop load';
}

function drawTimeline() {
  const canvas = element('timeline');
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  const drawing = canvas.getContext('2d');
  drawing.scale(ratio, ratio);
  const left = 28;
  const top = 10;
  const width = bounds.width - left - 12;
  const height = bounds.height - top - 25;
  const maximum = Math.max(snapshot?.hpa.max || 10, ...samples.map(sample => Math.max(sample.ready, sample.desired || 0)));
  drawing.font = '10px Consolas, monospace';
  for (let tick = 0; tick <= 5; tick += 1) {
    const vertical = top + height - tick / 5 * height;
    drawing.fillStyle = '#61726b';
    drawing.fillText(String(Math.round(tick / 5 * maximum)), 2, vertical + 3);
    drawing.strokeStyle = '#e0e8e3';
    drawing.lineWidth = 1;
    drawing.setLineDash([]);
    drawing.beginPath();
    drawing.moveTo(left, vertical);
    drawing.lineTo(left + width, vertical);
    drawing.stroke();
  }
  drawing.fillText('-5 min', left, bounds.height - 1);
  drawing.fillText('now', left + width - 22, bounds.height - 1);
  if (!samples.length) return;
  const now = Date.now();
  for (const [key, color] of [['desired', '#227aaf'], ['ready', '#13745a']]) {
    drawing.strokeStyle = color;
    drawing.lineWidth = key === 'ready' ? 3 : 2;
    drawing.setLineDash(key === 'desired' ? [5, 4] : []);
    drawing.beginPath();
    let previous;
    for (const sample of samples) {
      if (sample[key] == null) { previous = undefined; continue; }
      const horizontal = left + Math.max(0, 1 - (now - sample.time) / 300000) * width;
      const vertical = top + height - sample[key] / maximum * height;
      if (!previous || sample.time - previous.time > 12000) drawing.moveTo(horizontal, vertical);
      else { drawing.lineTo(horizontal, previous.vertical); drawing.lineTo(horizontal, vertical); }
      previous = { horizontal, vertical, time: sample.time };
    }
    drawing.stroke();
    if (previous) {
      drawing.fillStyle = color;
      drawing.beginPath();
      drawing.arc(previous.horizontal, previous.vertical, 3.5, 0, Math.PI * 2);
      drawing.fill();
    }
  }
}

function renderPods(pods) {
  const container = element('pods');
  container.querySelector('.empty')?.remove();
  const names = new Set(pods.map(pod => pod.name));
  for (const [name, item] of podElements) {
    if (!names.has(name)) { item.remove(); podElements.delete(name); }
  }
  for (const pod of pods) {
    let item = podElements.get(pod.name);
    if (!item) {
      item = document.createElement('article');
      item.className = 'pod';
      item.innerHTML = '<div class="pod-top"><i data-lucide="box" aria-hidden="true"></i><strong>php-apache</strong><span></span></div><p class="pod-name"></p><p class="pod-node"></p><div class="pod-bottom"><span></span><span></span></div>';
      podElements.set(pod.name, item);
      container.append(item);
    }
    item.classList.toggle('pending', !pod.ready || pod.terminating);
    item.querySelector('.pod-top span').textContent = pod.terminating ? 'Terminating' : pod.ready ? 'Ready' : pod.phase;
    item.querySelector('.pod-name').textContent = pod.name;
    item.querySelector('.pod-node').textContent = pod.node;
    item.querySelector('.pod-bottom span:first-child').textContent = pod.ip || 'IP pending';
    item.querySelector('.pod-bottom span:last-child').textContent = `${pod.restarts} restarts`;
  }
  if (!pods.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No workload pods';
    container.append(empty);
  }
  icons();
}

function renderEvents(events) {
  const signature = JSON.stringify(events);
  if (signature === eventsSignature) return;
  eventsSignature = signature;
  const container = element('events');
  container.replaceChildren();
  element('event-count').textContent = `${events.length} RECENT EVENTS`;
  for (const event of events) {
    const row = document.createElement('div');
    row.className = `event${event.type === 'Warning' ? ' warning' : ''}`;
    const time = document.createElement('time');
    time.dateTime = event.time;
    time.textContent = clock(event.time);
    const title = document.createElement('strong');
    const icon = document.createElement('i');
    icon.dataset.lucide = event.type === 'Warning' ? 'triangle-alert' : 'arrow-up-down';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = event.reason;
    title.append(icon, label);
    const message = document.createElement('p');
    message.textContent = event.message;
    row.append(time, title, message);
    container.append(row);
  }
  if (!events.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No autoscaler events';
    container.append(empty);
  }
  icons();
}

function render() {
  const { pods, hpa, load, observedAt, events } = snapshot;
  const ready = pods.filter(pod => pod.ready && !pod.terminating).length;
  document.body.classList.remove('stale');
  element('connection-dot').className = 'dot live';
  element('connection-label').textContent = 'Live cluster';
  element('updated').textContent = `Updated ${clock(observedAt)}`;
  element('ready').textContent = number(ready);
  element('desired').textContent = number(hpa.desired);
  element('cpu').textContent = hpa.cpu == null ? '--' : `${hpa.cpu}%`;
  element('target').textContent = `Target ${number(hpa.target)}% of CPU request`;
  element('replica-range').textContent = `${hpa.min} minimum / ${hpa.max} maximum`;
  const inactive = hpa.conditions.find(condition => condition.type === 'ScalingActive' && condition.status === 'False');
  element('decision').textContent = inactive ? inactive.reason : hpa.desired == null ? 'Awaiting metrics' : hpa.desired > ready ? 'Scaling out' : hpa.desired < ready ? 'Scaling in' : 'At desired capacity';
  element('phase').textContent = load.phase;
  element('phase').classList.toggle('active', load.active);
  element('active-workers').textContent = load.active ? number(load.workers) : '0';
  element('workload-state').textContent = load.active ? 'Concurrent HTTP requests' : 'No active load';
  element('run-detail').textContent = load.exists ? `Job: hpa-load / ${load.phase}` : 'No load Job';
  element('pod-count').textContent = `${ready} READY / ${pods.length} OBSERVED`;
  element('footer-state').textContent = load.active ? 'Load active / automatic timeout' : 'Idle load generator';
  if (load.active) {
    element('workers').value = load.workers;
    element('workers-value').value = String(load.workers);
  }
  renderPods(pods);
  renderEvents(events);
  const time = Date.parse(observedAt);
  if (!samples.length || samples[samples.length - 1].time !== time) samples.push({ time, ready, desired: hpa.desired });
  while (samples.length && Date.now() - samples[0].time > 300000) samples.shift();
  element('sample-count').textContent = `${samples.length} samples`;
  element('chart-empty').hidden = samples.length > 1;
  element('timeline').setAttribute('aria-label', `Replica history: ${ready} pods Ready; HPA desired ${number(hpa.desired)}`);
  drawTimeline();
  showErrors();
  setControls();
}

async function update() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const response = await fetch('/api/status', { signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      snapshot = result;
      connectionError = '';
      render();
    } catch (error) {
      connectionError = `Cluster telemetry unavailable: ${error.message}. Last readings are stale; any load Job keeps its automatic deadline.`;
      document.body.classList.add('stale');
      element('connection-dot').className = 'dot offline';
      element('connection-label').textContent = 'Disconnected';
      showErrors();
      setControls();
    }
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

async function action(path, options) {
  actionPending = true;
  actionError = '';
  showErrors();
  setControls();
  try {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HPA-Console': '1' },
      body: JSON.stringify(options), signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await update();
  } catch (error) { actionError = error.message; showErrors(); }
  finally { actionPending = false; setControls(); }
}

element('load-form').addEventListener('submit', event => {
  event.preventDefault();
  action('/api/start', { workers: Number(element('workers').value), durationSeconds: Number(element('duration').value) });
});
element('stop').addEventListener('click', () => action('/api/stop'));
element('workers').addEventListener('input', () => { element('workers-value').value = element('workers').value; });
element('refresh').addEventListener('click', update);
window.addEventListener('resize', drawTimeline);
setInterval(() => {
  const seconds = snapshot?.load.active ? Math.max(0, Math.ceil((Date.parse(snapshot.load.endsAt) - Date.now()) / 1000)) : 0;
  element('remaining').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}, 1000);
icons();
drawTimeline();
setControls();
(async function poll() { await update(); setTimeout(poll, 3000); })();