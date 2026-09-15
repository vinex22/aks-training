import assert from 'node:assert/strict';
import test from 'node:test';
import { AzureCliCredential, WorkloadIdentityCredential } from '@azure/identity';
import { createCredential } from '../azure.mjs';

test('local console uses Azure CLI while pods use only explicit Workload Identity', () => {
  assert.ok(createCredential({}) instanceof AzureCliCredential);
  assert.ok(createCredential({ KUBERNETES_SERVICE_HOST: '10.0.0.1', AZURE_TENANT_ID: 'tenant', AZURE_CLIENT_ID: 'client', AZURE_FEDERATED_TOKEN_FILE: '/test/token' }) instanceof WorkloadIdentityCredential);
  assert.throws(() => createCredential({ KUBERNETES_SERVICE_HOST: '10.0.0.1' }), /Workload Identity variables are missing/);
});