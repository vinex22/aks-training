'use strict';

const element = id => document.getElementById(id);
const formatNumber = new Intl.NumberFormat();
const formatCompact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const samples = [];
const batchStatuses = new Set(['Sending', 'Completed', 'Failed', 'Cancelled', 'Timed out']);
let snapshot = null;
let receivedAt = 0;
let refreshing = null;
let connectionError = '';
let pendingAction = '';
let enqueueAttempt = null;
let acceptedBatchId = null;
let cancelRequestedFor = null;
let feedback = { text: '', tone: 'muted' };

const isCount = value => Number.isSafeInteger(value) && value >= 0;
const number = value => isCount(value) ? formatNumber.format(value) : '--';
const text = (id, value) => { element(id).textContent = value; };
const clock = value => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
const sending = () => snapshot?.batch.current?.status === 'Sending';
const connected = () => Boolean(snapshot && !connectionError && Date.now() - receivedAt < 30000
  && Date.now() - Date.parse(snapshot.observedAt) < 30000);
const supportsRequestIds = () => typeof globalThis.crypto?.randomUUID === 'function';

function badge(id, label, tone = 'muted') {
  text(id, label);
  element(id).dataset.tone = tone;
}

function batchTone(status) {
  if (status === 'Sending') return 'blue';
  if (status === 'Completed') return 'success';
  if (status === 'Failed' || status === 'Timed out') return 'danger';
  if (status === 'Cancelled') return 'warning';
  return 'muted';
}

function timeValue(id, value) {
  const target = element(id);
  target.textContent = clock(value);
  if (Number.isFinite(Date.parse(value))) {
    target.dateTime = value;
    target.title = new Date(value).toLocaleString();
  } else {
    target.removeAttribute('datetime');
    target.removeAttribute('title');
  }
}

function countValue() {
  const input = element('message-count');
  const count = Number(input.value);
  return Number.isInteger(count) && count >= 1 && count <= 500 && input.validity.valid ? count : null;
}

function canEnqueue() {
  return connected() && !snapshot.queue.error && !sending() && !pendingAction
    && !acceptedBatchId && supportsRequestIds() && countValue() !== null;
}

function setControls() {
  const locked = Boolean(pendingAction || sending() || acceptedBatchId);
  element('message-count').disabled = locked;
  element('count-presets').disabled = locked;
  element('enqueue').disabled = !canEnqueue();
  element('cancel').disabled = Boolean(!sending() || pendingAction || cancelRequestedFor);
  element('enqueue').setAttribute('aria-busy', String(pendingAction === 'enqueue'));
  element('cancel').setAttribute('aria-busy', String(pendingAction === 'cancel'));
  let state = 'Ready to enqueue';
  if (pendingAction === 'enqueue') state = 'Submitting request';
  else if (pendingAction === 'cancel') state = 'Requesting cancellation';
  else if (cancelRequestedFor) state = 'Cancellation requested; awaiting batch status';
  else if (acceptedBatchId) state = 'Request accepted; awaiting batch status';
  else if (sending()) state = connected() ? 'Batch sending' : 'Last observed batch: Sending';
  else if (!supportsRequestIds()) state = 'Secure request IDs unavailable in this browser';
  else if (!snapshot && !connectionError) state = 'Waiting for queue connection';
  else if (!connected()) state = 'Queue status unavailable; enqueue paused';
  else if (snapshot.queue.error) state = 'Queue unavailable; enqueue paused';
  else if (countValue() === null) state = 'Invalid message count';
  else if (enqueueAttempt?.uncertain) state = 'Previous outcome unconfirmed; retry ID retained';
  text('control-state', state);
  const invalid = countValue() === null;
  element('message-count').setAttribute('aria-invalid', String(invalid));
  text('count-error', invalid ? 'Enter a whole number from 1 to 500.' : '');
  element('count-error').hidden = !invalid;
  document.querySelectorAll('input[name="preset"]').forEach(preset => {
    preset.checked = Number(preset.value) === countValue();
  });
}

function validateSnapshot(value) {
  const nullableText = field => field === null || typeof field === 'string';
  const validBatch = batch => batch && typeof batch.id === 'string' && batch.id.length > 0
    && batchStatuses.has(batch.status) && isCount(batch.requested) && batch.requested > 0
    && isCount(batch.sent) && isCount(batch.failed) && batch.sent + batch.failed <= batch.requested;
  const valid = value && typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt))
    && value.queue && typeof value.queue.account === 'string' && typeof value.queue.name === 'string'
    && (value.queue.approximateMessagesCount === null || isCount(value.queue.approximateMessagesCount))
    && nullableText(value.queue.error) && value.batch
    && (value.batch.current === null || validBatch(value.batch.current))
    && Array.isArray(value.batch.history) && value.batch.history.every(validBatch)
    && value.cluster && typeof value.cluster.available === 'boolean' && nullableText(value.cluster.reason)
    && typeof value.cluster.context === 'string' && typeof value.cluster.namespace === 'string'
    && Array.isArray(value.cluster.pods)
    && value.cluster.pods.every(pod => pod && typeof pod.name === 'string' && typeof pod.ready === 'boolean'
      && typeof pod.phase === 'string' && nullableText(pod.node))
    && (value.cluster.scaler === null || (value.cluster.scaler && typeof value.cluster.scaler.name === 'string'
      && typeof value.cluster.scaler.ready === 'boolean' && typeof value.cluster.scaler.active === 'boolean'
      && isCount(value.cluster.scaler.min) && isCount(value.cluster.scaler.max)))
    && (value.cluster.hpa === null || (value.cluster.hpa
      && (value.cluster.hpa.current === null || isCount(value.cluster.hpa.current))
      && (value.cluster.hpa.desired === null || isCount(value.cluster.hpa.desired))));
  if (!valid) throw new Error('Status response does not match the console API.');
  return value;
}

async function fetchJson(path, options = {}, expectedStatus = 200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, {
      ...options, signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
    });
    let result;
    try { result = await response.json(); }
    catch {
      const error = new Error(`Unreadable server response (HTTP ${response.status}).`);
      error.uncertain = response.status < 400 || response.status >= 500;
      throw error;
    }
    if (response.status !== expectedStatus) {
      const error = new Error(typeof result?.error === 'string' ? result.error : `HTTP ${response.status}`);
      error.uncertain = response.status < 400 || response.status >= 500;
      throw error;
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Request timed out after 20 seconds.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function latestBatch() {
  const batches = snapshot ? [snapshot.batch.current, ...snapshot.batch.history].filter(Boolean) : [];
  if (acceptedBatchId) return batches.find(batch => batch.id === acceptedBatchId) || null;
  return snapshot?.batch.current || batches.sort((first, second) =>
    (Date.parse(second.startedAt) || 0) - (Date.parse(first.startedAt) || 0))[0] || null;
}

function renderBatch() {
  const batch = latestBatch();
  text('batch-title', batch?.status === 'Sending' ? 'Current batch' : 'Latest batch');
  badge('batch-state', batch?.status || (acceptedBatchId ? 'Accepted' : snapshot ? 'No batch' : 'Waiting'), batchTone(batch?.status));
  text('confirmed-sent', number(batch?.sent));
  text('confirmed-note', batch ? `of ${number(batch.requested)} requested / ${batch.status}`
    : acceptedBatchId ? 'Awaiting confirmed sends' : 'No batch observed');
  text('batch-summary', batch ? `${number(batch.sent)} / ${number(batch.requested)} confirmed`
    : acceptedBatchId ? 'Accepted; awaiting observation' : 'No batch observed');
  element('batch-progress').hidden = !batch;
  element('batch-progress').max = batch?.requested || 1;
  element('batch-progress').value = batch?.sent || 0;
  element('batch-progress').setAttribute('aria-valuetext', batch
    ? `${number(batch.sent)} of ${number(batch.requested)} messages confirmed sent` : 'No confirmed batch observation');
  text('batch-id', batch?.id || acceptedBatchId || '--');
  text('batch-failed', number(batch?.failed));
  timeValue('batch-started', batch?.startedAt);
  timeValue('batch-finished', batch?.finishedAt);
  text('batch-error', batch?.error || '');
  element('batch-error').hidden = !batch?.error;
}

function cell(content, className = '') {
  const target = document.createElement('td');
  target.className = className;
  target.textContent = content;
  return target;
}

function renderPods(cluster) {
  const available = cluster?.available === true;
  const pods = available ? cluster.pods : [];
  const ready = pods.filter(pod => pod.ready).length;
  const scaler = available ? cluster.scaler : null;
  const hpa = available ? cluster.hpa : null;
  text('ready-processors', available ? number(ready) : '--');
  text('processor-note', available ? `${number(pods.length)} pods observed`
    : cluster ? 'Processor / KEDA not deployed' : 'Awaiting cluster status');
  text('desired-replicas', number(hpa?.desired));
  text('replica-note', hpa ? `${number(hpa.current)} current replicas`
    : available ? 'No HPA observed' : cluster ? 'Processor / KEDA not deployed' : 'Awaiting HPA status');
  text('pod-count', available ? `${number(ready)} READY / ${number(pods.length)} OBSERVED`
    : cluster ? 'NOT DEPLOYED / UNAVAILABLE' : 'AWAITING STATUS');
  text('scaler-name', scaler?.name || (available ? 'Not observed' : '--'));
  badge('scaler-ready', scaler ? (scaler.ready ? 'Yes' : 'No') : '--', scaler ? (scaler.ready ? 'success' : 'warning') : 'muted');
  badge('scaler-active', scaler ? (scaler.active ? 'Yes' : 'No') : '--', scaler?.active ? 'blue' : 'muted');
  text('scaler-range', scaler ? `${number(scaler.min)} min / ${number(scaler.max)} max` : '--');
  element('pods-table').hidden = !pods.length;
  element('pods-empty').hidden = Boolean(pods.length);
  text('pods-empty', !cluster ? 'Waiting for processor status' : !available
    ? 'Processor / KEDA not deployed. Processor observations are unavailable.' : 'No processor pods observed');
  const rows = pods.map(pod => {
    const row = document.createElement('tr');
    const status = cell('');
    const readiness = document.createElement('span');
    readiness.className = 'badge';
    readiness.dataset.tone = pod.ready ? 'success' : 'warning';
    readiness.textContent = pod.ready ? 'Ready' : 'Not ready';
    const phase = document.createElement('span');
    phase.className = 'secondary';
    phase.textContent = pod.phase;
    status.append(readiness, phase);
    row.append(cell(pod.name, 'mono'), status, cell(pod.node || 'Not scheduled', 'mono secondary'));
    return row;
  });
  element('pods').replaceChildren(...rows);
}

function renderHistory() {
  const history = [...(snapshot?.batch.history || [])].sort((first, second) =>
    (Date.parse(second.startedAt) || 0) - (Date.parse(first.startedAt) || 0));
  text('batch-count', snapshot ? `${number(history.length)} BATCHES` : 'AWAITING STATUS');
  text('batches-empty', snapshot ? 'No batch history' : 'Waiting for batch status');
  element('batches-empty').hidden = Boolean(history.length);
  element('batches-scroll').hidden = !history.length;
  const rows = history.map(batch => {
    const row = document.createElement('tr');
    const started = cell('');
    const timestamp = document.createElement('time');
    timestamp.textContent = clock(batch.startedAt);
    if (Number.isFinite(Date.parse(batch.startedAt))) {
      timestamp.dateTime = batch.startedAt;
      timestamp.title = new Date(batch.startedAt).toLocaleString();
    }
    started.append(timestamp);
    const status = cell('');
    const label = document.createElement('span');
    label.className = 'badge';
    label.dataset.tone = batchTone(batch.status);
    label.textContent = batch.status;
    status.append(label);
    if (batch.error) {
      const error = document.createElement('span');
      error.className = 'secondary history-error';
      error.textContent = batch.error;
      status.append(error);
    }
    row.append(started, cell(batch.id, 'mono'), cell(number(batch.requested), 'numeric'),
      cell(number(batch.sent), 'numeric confirmed-text'), cell(number(batch.failed), 'numeric'), status);
    return row;
  });
  element('batches').replaceChildren(...rows);
}

function recordSample(time, count) {
  const existing = samples.find(sample => sample.time === time);
  if (existing) existing.count = count;
  else samples.push({ time, count });
  samples.sort((first, second) => first.time - second.time);
  while (samples.length && samples[0].time < Date.now() - 300000) samples.shift();
}

function drawHistory() {
  const canvas = element('queue-history');
  const bounds = canvas.getBoundingClientRect();
  const drawing = canvas.getContext('2d');
  if (!drawing) {
    text('chart-empty', 'Chart unavailable in this browser');
    element('chart-empty').hidden = false;
    return;
  }
  const now = Date.now();
  while (samples.length && samples[0].time < now - 300000) samples.shift();
  const observations = samples.filter(sample => isCount(sample.count));
  const missing = samples.some(sample => sample.count === null);
  text('sample-count', `${number(observations.length)} observations`);
  text('chart-caption', !connected() || snapshot?.queue.error || snapshot?.queue.approximateMessagesCount === null
    ? 'Latest count unavailable' : 'Approximate messages');
  text('chart-empty', !snapshot ? 'Waiting for queue observations' : 'No queue count available');
  element('chart-empty').hidden = Boolean(observations.length);
  const latest = observations[observations.length - 1];
  const summary = latest ? `${observations.length} queue observations in the last five minutes. Last observed: ${number(latest.count)} approximate messages at ${clock(new Date(latest.time).toISOString())}. Minimum ${number(Math.min(...observations.map(sample => sample.count)))}; maximum ${number(Math.max(...observations.map(sample => sample.count)))}.${missing ? ' Includes missing data.' : ''}`
    : 'No queue counts observed in the last five minutes.';
  text('chart-summary', summary);
  canvas.setAttribute('aria-label', `Approximate queue depth history. ${summary}`);
  if (!bounds.width || !bounds.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
  const left = 44;
  const top = 15;
  const width = Math.max(1, bounds.width - left - 14);
  const height = Math.max(1, bounds.height - top - 28);
  const tickStep = Math.ceil(Math.max(20, ...observations.map(sample => sample.count)) / 4);
  const maximum = tickStep * 4;
  drawing.font = '10px Consolas, monospace';
  drawing.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick += 1) {
    const vertical = top + height - tick / 4 * height;
    drawing.fillStyle = '#61726b';
    drawing.textAlign = 'right';
    drawing.fillText(formatCompact.format(tick * tickStep), left - 9, vertical + 3);
    drawing.strokeStyle = '#e1e8e5';
    drawing.beginPath();
    drawing.moveTo(left, vertical);
    drawing.lineTo(left + width, vertical);
    drawing.stroke();
  }
  drawing.strokeStyle = '#acbdb5';
  drawing.beginPath();
  drawing.moveTo(left, top);
  drawing.lineTo(left, top + height);
  drawing.lineTo(left + width, top + height);
  drawing.stroke();
  drawing.textAlign = 'left';
  drawing.fillText('-5 min', left, bounds.height - 4);
  drawing.textAlign = 'center';
  drawing.fillText('-2m 30s', left + width / 2, bounds.height - 4);
  drawing.textAlign = 'right';
  drawing.fillText('now', left + width, bounds.height - 4);
  drawing.strokeStyle = '#117861';
  drawing.fillStyle = '#117861';
  drawing.lineWidth = 2.5;
  drawing.lineJoin = 'round';
  drawing.beginPath();
  let previous = null;
  for (const sample of samples) {
    if (!isCount(sample.count)) { previous = null; continue; }
    const horizontal = left + Math.min(1, Math.max(0, 1 - (now - sample.time) / 300000)) * width;
    const vertical = top + height - sample.count / maximum * height;
    if (!previous || sample.time - previous.time > 12000) drawing.moveTo(horizontal, vertical);
    else {
      drawing.lineTo(horizontal, previous.vertical);
      drawing.lineTo(horizontal, vertical);
    }
    previous = { time: sample.time, vertical };
  }
  drawing.stroke();
  for (const sample of observations) {
    const horizontal = left + Math.min(1, Math.max(0, 1 - (now - sample.time) / 300000)) * width;
    const vertical = top + height - sample.count / maximum * height;
    drawing.beginPath();
    drawing.arc(horizontal, vertical, sample === latest ? 3.5 : 1.8, 0, Math.PI * 2);
    drawing.fill();
  }
}

function render() {
  const live = connected();
  const queue = snapshot?.queue;
  const cluster = snapshot?.cluster;
  document.body.classList.toggle('stale', Boolean(snapshot && !live));
  element('connection-dot').dataset.tone = live ? (queue.error ? 'warning' : 'success') : connectionError || snapshot ? 'danger' : 'warning';
  text('connection-label', live ? (queue.error ? 'Queue unavailable' : 'Queue connected') : connectionError || snapshot ? 'Disconnected' : 'Connecting');
  text('connection-error', connectionError ? `Status unavailable: ${connectionError} Last readings are stale.`
    : snapshot && !live ? 'Status observation is older than 30 seconds. Last readings are stale.' : '');
  element('connection-error').hidden = !connectionError && (!snapshot || live);
  text('queue-error', queue?.error ? `Queue unavailable: ${queue.error}` : '');
  element('queue-error').hidden = !queue?.error;
  element('consumer-warning').hidden = !cluster || cluster.available;
  text('consumer-warning-detail', live && !queue?.error && isCount(queue?.approximateMessagesCount) && queue.approximateMessagesCount > 0
    ? 'Messages awaiting processors.' : 'No processors available to consume messages.');
  text('consumer-reason', cluster?.reason || '');
  element('consumer-reason').hidden = !cluster?.reason;
  if (snapshot) {
    text('cluster-context', cluster.context);
    text('cluster-namespace', cluster.namespace);
    element('updated').dateTime = snapshot.observedAt;
    text('updated', `${live ? 'Observed' : 'Last observed'} ${clock(snapshot.observedAt)}`);
  }
  text('queue-account', queue?.account || '--');
  text('queue-name', queue?.name || '--');
  text('queue-depth', queue?.error ? '--' : number(queue?.approximateMessagesCount));
  text('queue-note', !live && snapshot ? 'Approximate / last observed' : queue?.error ? 'Count unavailable' : 'Approximate messages');
  badge('queue-state', live && !queue.error ? 'Connected' : snapshot || connectionError ? 'Unavailable' : 'Waiting', live && !queue.error ? 'success' : 'muted');
  text('action-feedback', feedback.text);
  element('action-feedback').dataset.tone = feedback.tone;
  element('action-feedback').hidden = !feedback.text;
  text('footer-state', !live ? 'No current telemetry' : sending() ? 'Batch sending' : acceptedBatchId ? 'Awaiting batch status' : 'No active send');
  renderBatch();
  renderPods(cluster);
  renderHistory();
  drawHistory();
  setControls();
}

function refresh() {
  if (refreshing) return refreshing;
  element('refresh').disabled = true;
  element('refresh').setAttribute('aria-busy', 'true');
  refreshing = (async () => {
    try {
      const result = validateSnapshot(await fetchJson('/api/status'));
      snapshot = result;
      receivedAt = Date.now();
      connectionError = '';
      if (acceptedBatchId && [result.batch.current, ...result.batch.history].some(batch => batch?.id === acceptedBatchId)) acceptedBatchId = null;
      if (cancelRequestedFor && (result.batch.current?.id !== cancelRequestedFor || !sending())) cancelRequestedFor = null;
      recordSample(Date.parse(result.observedAt), result.queue.error ? null : result.queue.approximateMessagesCount);
    } catch (error) {
      connectionError = error.message;
      recordSample(Date.now(), null);
    } finally {
      refreshing = null;
      element('refresh').disabled = false;
      element('refresh').setAttribute('aria-busy', 'false');
      render();
    }
  })();
  return refreshing;
}

async function enqueue(event) {
  event.preventDefault();
  if (!canEnqueue()) { setControls(); return; }
  const count = countValue();
  pendingAction = 'enqueue';
  feedback = { text: '', tone: 'muted' };
  render();
  try {
    if (!enqueueAttempt || enqueueAttempt.count !== count) {
      enqueueAttempt = { count, requestId: crypto.randomUUID(), uncertain: false };
    }
    const result = await fetchJson('/api/enqueue', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KEDA-Console': '1' },
      body: JSON.stringify({ count, requestId: enqueueAttempt.requestId }),
    }, 202);
    if (typeof result?.id !== 'string' || !result.id || typeof result.duplicate !== 'boolean') {
      throw new Error('Accepted response did not include a valid batch ID.');
    }
    acceptedBatchId = result.id;
    enqueueAttempt = null;
    feedback = { text: result.duplicate ? 'Existing batch acknowledged; duplicate request recognized.' : 'Batch accepted.', tone: 'success' };
  } catch (error) {
    const uncertain = Boolean(enqueueAttempt?.uncertain) || error.uncertain !== false;
    if (enqueueAttempt) enqueueAttempt.uncertain = uncertain;
    feedback = {
      text: uncertain ? `Enqueue outcome unknown. ${error.message} Request ID retained for retry.` : `Enqueue rejected: ${error.message}`,
      tone: uncertain ? 'warning' : 'danger',
    };
  } finally {
    pendingAction = '';
    render();
    void refresh();
  }
}

async function cancel() {
  if (!sending() || pendingAction || cancelRequestedFor) return;
  const batchId = snapshot.batch.current.id;
  pendingAction = 'cancel';
  feedback = { text: '', tone: 'muted' };
  render();
  try {
    const result = await fetchJson('/api/cancel', {
      method: 'POST', headers: { 'X-KEDA-Console': '1' },
    }, 202);
    if (typeof result?.cancelling !== 'boolean') throw new Error('Unreadable cancellation acknowledgement.');
    cancelRequestedFor = result.cancelling ? batchId : null;
    feedback = {
      text: result.cancelling ? 'Cancellation requested. Confirmed sends are not undone.' : 'No active send was available to cancel.',
      tone: result.cancelling ? 'warning' : 'muted',
    };
  } catch (error) {
    feedback = {
      text: error.uncertain === false ? `Cancellation rejected: ${error.message}` : `Cancellation outcome unknown. ${error.message}`,
      tone: 'danger',
    };
  } finally {
    pendingAction = '';
    render();
    void refresh();
  }
}

function countChanged() {
  if (enqueueAttempt && enqueueAttempt.count !== countValue()) {
    feedback = enqueueAttempt.uncertain
      ? { text: 'Previous enqueue outcome remains unknown. Changed count is a separate request.', tone: 'warning' }
      : { text: '', tone: 'muted' };
    enqueueAttempt = null;
  }
  render();
}

element('enqueue-form').addEventListener('submit', enqueue);
element('cancel').addEventListener('click', cancel);
element('refresh').addEventListener('click', refresh);
element('message-count').addEventListener('input', countChanged);
document.querySelectorAll('input[name="preset"]').forEach(preset => {
  preset.addEventListener('change', () => {
    if (!preset.checked) return;
    element('message-count').value = preset.value;
    countChanged();
  });
});
window.addEventListener('resize', drawHistory);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { render(); void refresh(); }
});
window.lucide?.createIcons();
document.querySelectorAll('svg[data-lucide]').forEach(icon => icon.removeAttribute('data-lucide'));
render();
(async function poll() {
  await refresh();
  setTimeout(poll, 3000);
})();