import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readInCluster } from './kube-api.mjs';

const execute = promisify(execFile);
const context = 'aks-training-flat';
const namespace = 'keda-lab';

export async function readCluster() {
  try {
    let items;
    if (process.env.KUBERNETES_SERVICE_HOST) {
      items = await readInCluster();
    } else {
      const { stdout } = await execute('kubectl', [
        '--context', context, '--namespace', namespace, 'get', 'deployments,pods,scaledobjects,hpa',
        '-o', 'json', '--request-timeout=8s',
      ], { timeout: 12000, maxBuffer: 2000000, windowsHide: true });
      items = JSON.parse(stdout).items;
    }
    const deployment = items.find(item => item.kind === 'Deployment' && item.metadata.name === 'azure-queue-processor');
    const scaler = items.find(item => item.kind === 'ScaledObject' && item.metadata.name === 'azure-queue-scaler');
    const hpa = items.find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.name === 'azure-queue-processor-hpa');
    return {
      context, namespace, available: Boolean(deployment && scaler),
      reason: !deployment || !scaler ? 'Processor / KEDA lab not deployed' : null,
      pods: items.filter(item => item.kind === 'Pod' && item.metadata.labels?.app === 'azure-queue-processor').map(pod => ({
        name: pod.metadata.name, phase: pod.status.phase, node: pod.spec.nodeName || 'Unassigned',
        ready: !pod.metadata.deletionTimestamp && Boolean(pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')),
      })),
      scaler: scaler ? {
        name: scaler.metadata.name, min: scaler.spec.minReplicaCount, max: scaler.spec.maxReplicaCount,
        ready: Boolean(scaler.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')),
        active: Boolean(scaler.status?.conditions?.some(condition => condition.type === 'Active' && condition.status === 'True')),
      } : null,
      hpa: hpa ? { current: hpa.status?.currentReplicas ?? null, desired: hpa.status?.desiredReplicas ?? null } : null,
    };
  } catch {
    return { context, namespace, available: false, reason: 'Kubernetes telemetry unavailable. Check the flat-cluster context and KEDA APIs.', pods: [], scaler: null, hpa: null };
  }
}