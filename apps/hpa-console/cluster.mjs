import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';

export function createClusterClient({ namespace = process.env.POD_NAMESPACE || 'hpa-flat', transport = httpsRequest, read = readFile } = {}) {
  const scope = encodeURIComponent(namespace);
  const base = '/var/run/secrets/kubernetes.io/serviceaccount';
  return async (method, path, body) => {
    const [token, ca] = await Promise.all([read(`${base}/token`, 'utf8'), read(`${base}/ca.crt`)]);
    const target = path.replace('{namespace}', scope);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = transport({
        hostname: process.env.KUBERNETES_SERVICE_HOST,
        port: process.env.KUBERNETES_SERVICE_PORT_HTTPS || 443,
        path: target, method, ca, timeout: 8000,
        headers: { Authorization: `Bearer ${token.trim()}`, ...(payload !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
      }, response => {
        let output = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          output += chunk;
          if (output.length > 2000000) request.destroy(new Error('Kubernetes response too large'));
        });
        response.on('error', reject);
        response.on('end', () => {
          let value;
          try { value = JSON.parse(output); } catch { return reject(new Error('Invalid Kubernetes response')); }
          if (response.statusCode >= 400) {
            const error = new Error(value.message || `Kubernetes HTTP ${response.statusCode}`);
            error.status = response.statusCode;
            return reject(error);
          }
          resolve(value);
        });
      });
      request.on('timeout', () => request.destroy(new Error('Kubernetes request timed out')));
      request.on('error', reject);
      request.end(payload);
    });
  };
}

const loadScript = `echo "Load started: workers=$WORKERS duration=$DURATION_SECONDS seconds"
finish=$(( $(date +%s) + DURATION_SECONDS ))
generate() {
  worker="$1"
  succeeded=0
  failed=0
  while [ "$(date +%s)" -lt "$finish" ]; do
    if wget -q -T 5 -O /dev/null http://php-apache/; then
      succeeded=$((succeeded + 1))
    else
      failed=$((failed + 1))
    fi
    total=$((succeeded + failed))
    if [ "$((total % 25))" -eq 0 ]; then
      echo "worker=$worker succeeded=$succeeded failed=$failed"
    fi
    sleep 0.01
  done
  echo "worker=$worker finished succeeded=$succeeded failed=$failed"
}
worker=1
while [ "$worker" -le "$WORKERS" ]; do
  generate "$worker" &
  worker=$((worker + 1))
done
wait
echo "Load finished"`;

export function loadJob({ workers, durationSeconds }, namespace = 'hpa-flat') {
  if (!Number.isInteger(workers) || workers < 1 || workers > 8 || !Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 300) {
    const error = new Error('Use 1-8 workers and a duration of 30-300 seconds.');
    error.status = 400;
    throw error;
  }
  return {
    apiVersion: 'batch/v1', kind: 'Job',
    metadata: { name: 'hpa-load', namespace, labels: { 'app.kubernetes.io/managed-by': 'hpa-console' } },
    spec: {
      activeDeadlineSeconds: durationSeconds + 30, backoffLimit: 0, ttlSecondsAfterFinished: 600,
      template: {
        metadata: { labels: { app: 'hpa-load' } },
        spec: {
          automountServiceAccountToken: false, restartPolicy: 'Never', terminationGracePeriodSeconds: 5,
          containers: [{
            name: 'load', image: 'busybox:1.37.0', command: ['/bin/sh', '-c'], args: [loadScript],
            env: [{ name: 'WORKERS', value: String(workers) }, { name: 'DURATION_SECONDS', value: String(durationSeconds) }],
            resources: { requests: { cpu: '25m', memory: '16Mi' }, limits: { cpu: '200m', memory: '64Mi' } },
            securityContext: { allowPrivilegeEscalation: false, runAsNonRoot: true, runAsUser: 1000, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
          }],
        },
      },
    },
  };
}

export function createLab({ request = createClusterClient(), namespace = process.env.POD_NAMESPACE || 'hpa-flat' } = {}) {
  const jobs = '/apis/batch/v1/namespaces/{namespace}/jobs';
  const jobPath = `${jobs}/hpa-load`;
  const currentJob = async () => {
    try { return await request('GET', jobPath); } catch (error) { if (error.status === 404) return null; throw error; }
  };
  let changing = false;
  const mutate = async action => {
    if (changing) { const error = new Error('Another load action is in progress.'); error.status = 409; throw error; }
    changing = true;
    try { return await action(); } finally { changing = false; }
  };
  return {
    async status() {
      const [hpa, pods, job, events] = await Promise.all([
        request('GET', '/apis/autoscaling/v2/namespaces/{namespace}/horizontalpodautoscalers/php-apache'),
        request('GET', '/api/v1/namespaces/{namespace}/pods?labelSelector=app%3Dphp-apache'),
        currentJob(),
        request('GET', '/api/v1/namespaces/{namespace}/events?fieldSelector=involvedObject.kind%3DHorizontalPodAutoscaler%2CinvolvedObject.name%3Dphp-apache'),
      ]);
      const complete = job?.status?.conditions?.some(condition => ['Complete', 'Failed'].includes(condition.type) && condition.status === 'True');
      const variables = job?.spec.template.spec.containers[0].env || [];
      const variable = name => Number(variables.find(item => item.name === name)?.value || 0);
      const startedAt = job?.status?.startTime || job?.metadata.creationTimestamp;
      return {
        observedAt: new Date().toISOString(), namespace,
        pods: pods.items.map(pod => ({
          name: pod.metadata.name, node: pod.spec.nodeName || 'Unassigned', ip: pod.status.podIP || null,
          phase: pod.status.phase, terminating: Boolean(pod.metadata.deletionTimestamp),
          ready: pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True') || false,
          restarts: pod.status.containerStatuses?.reduce((total, container) => total + container.restartCount, 0) || 0,
        })),
        hpa: {
          current: hpa.status?.currentReplicas ?? null, desired: hpa.status?.desiredReplicas ?? null,
          min: hpa.spec.minReplicas, max: hpa.spec.maxReplicas,
          cpu: hpa.status?.currentMetrics?.find(metric => metric.resource?.name === 'cpu')?.resource.current.averageUtilization ?? null,
          target: hpa.spec.metrics.find(metric => metric.resource?.name === 'cpu')?.resource.target.averageUtilization ?? null,
          conditions: hpa.status?.conditions || [],
        },
        load: {
          exists: Boolean(job), active: Boolean(job && !complete && !job.metadata.deletionTimestamp),
          phase: !job ? 'Idle' : job.metadata.deletionTimestamp ? 'Stopping' : complete ? (job.status.succeeded ? 'Completed' : 'Failed') : job.status?.active ? 'Running' : 'Starting',
          workers: variable('WORKERS') || (job ? 1 : 0),
          endsAt: job ? new Date(Date.parse(startedAt) + (variable('DURATION_SECONDS') || 300) * 1000).toISOString() : null,
        },
        events: events.items.map(event => ({
          reason: event.reason, message: event.message, type: event.type,
          time: event.lastTimestamp || event.eventTime || event.metadata.creationTimestamp,
        })).sort((left, right) => Date.parse(right.time) - Date.parse(left.time)).slice(0, 12),
      };
    },
    start(options) {
      const job = loadJob(options, namespace);
      return mutate(async () => {
        if (await currentJob()) { const error = new Error('A load Job already exists. Stop / clear it before starting another run.'); error.status = 409; throw error; }
        await request('POST', jobs, job);
        return { started: true };
      });
    },
    stop() {
      return mutate(async () => {
        const job = await currentJob();
        if (job) await request('DELETE', jobPath, { apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Foreground', preconditions: { uid: job.metadata.uid } });
        return { stopping: Boolean(job) };
      });
    },
  };
}