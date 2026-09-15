import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';

export async function getKubernetes(path) {
  const base = '/var/run/secrets/kubernetes.io/serviceaccount';
  const [token, ca] = await Promise.all([readFile(`${base}/token`, 'utf8'), readFile(`${base}/ca.crt`)]);
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: process.env.KUBERNETES_SERVICE_HOST,
      port: process.env.KUBERNETES_SERVICE_PORT_HTTPS || 443,
      path, ca, timeout: 8000, headers: { Authorization: `Bearer ${token.trim()}` },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2000000) request.destroy(new Error('Kubernetes response too large'));
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode === 404) return resolve(null);
        if (response.statusCode !== 200) return reject(new Error(`Kubernetes returned ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid Kubernetes response')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Kubernetes request timed out')));
    request.on('error', reject);
    request.end();
  });
}

export async function readInCluster(get = getKubernetes) {
  const scope = '/namespaces/keda-lab';
  const resources = await Promise.all([
    get(`/apis/apps/v1${scope}/deployments/azure-queue-processor`),
    get(`/api/v1${scope}/pods?labelSelector=app%3Dazure-queue-processor`),
    get(`/apis/keda.sh/v1alpha1${scope}/scaledobjects/azure-queue-scaler`),
    get(`/apis/autoscaling/v2${scope}/horizontalpodautoscalers/azure-queue-processor-hpa`),
  ]);
  return resources.flatMap(resource => {
    if (!resource) return [];
    if (resource.items) return resource.items.map(item => ({ ...item, kind: item.kind || resource.kind?.replace(/List$/, '') }));
    return [resource];
  });
}