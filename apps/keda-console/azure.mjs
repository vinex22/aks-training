import { AzureCliCredential, WorkloadIdentityCredential } from '@azure/identity';
import { QueueClient } from '@azure/storage-queue';

export const account = 'stakskeda555a1e03';
export const queueName = 'keda-demo';
export const tenantId = '45b68ab1-2c84-414f-918d-e945e189121d';

export function createCredential(environment = process.env) {
  if (environment.KUBERNETES_SERVICE_HOST || environment.AZURE_FEDERATED_TOKEN_FILE) {
    if (!environment.AZURE_FEDERATED_TOKEN_FILE || !environment.AZURE_CLIENT_ID || !environment.AZURE_TENANT_ID) {
      throw new Error('Workload Identity variables are missing; verify the pod label and ServiceAccount federation.');
    }
    return new WorkloadIdentityCredential({ tenantId: environment.AZURE_TENANT_ID, clientId: environment.AZURE_CLIENT_ID, tokenFilePath: environment.AZURE_FEDERATED_TOKEN_FILE });
  }
  return new AzureCliCredential({ tenantId, processTimeoutInMs: 10000 });
}

export function createQueueClient() {
  const credential = createCredential();
  const client = new QueueClient(`https://${account}.queue.core.windows.net/${queueName}`, credential, {
    retryOptions: { maxTries: 1, tryTimeoutInMs: 10000 },
  });
  return client;
}

export function createQueue() {
  const client = createQueueClient();
  return {
    async status() {
      try {
        const properties = await client.getProperties({ abortSignal: AbortSignal.timeout(15000) });
        return { account, name: queueName, approximateMessagesCount: properties.approximateMessagesCount, error: null };
      } catch (error) {
        const code = error.code || error.name || 'AccessError';
        return { account, name: queueName, approximateMessagesCount: null, error: `Queue access unavailable (${code}). Verify private DNS/network access, Azure identity authentication, and queue-scoped data roles.` };
      }
    },
    send(body, options) { return client.sendMessage(body, options); },
  };
}