# KEDA Queue Console

An instructor console for sending bounded batches of synthetic messages to Azure Storage Queue and observing queue depth and KEDA processor status. Now deployed in AKS with Workload Identity and private queue access. The existing [HPA console](../hpa-console/README.md) and deployed HPA/QoS/PDB labs are unchanged.

## Deployed Access - 2026-09-15

Use **http://127.0.0.1:18084** through the deployed `keda-console` Service, not the local-only prototype on 18083. See the [current deployment guide](../../labs/keda/DEPLOYED.md) for identity details, verification, updates, and troubleshooting.

```powershell
kubectl --context aks-training-flat -n keda-lab port-forward service/keda-console 18084:80 --address 127.0.0.1
```

The AKS console uses `WorkloadIdentityCredential`; local development retains `AzureCliCredential`. Its Kubernetes reads use TLS-verified in-cluster API requests, not a copied kubeconfig. The Node consumer uses a separate queue-processing identity; the managed KEDA operator uses a third, read-only queue identity. Public storage access and shared keys remain disabled. Application code and locked dependencies are initialized from ConfigMaps using the public Node runtime; no ACR build or pull grant is required.

The previous network/RBAC blockers below apply to the **historical laptop-only prototype**, not this deployed console. New dedicated managed-identity roles have now been created on the queue only; no queue roles were added to the instructor user.

## Historical Local Prototype

The console is implemented and available at http://127.0.0.1:18083 while its local Node server runs. It is **not yet able to enqueue against Azure**:

- Created StorageV2 account `stakskeda555a1e03`, Standard LRS in Central India, resource group `aks-training`.
- Created queue `keda-demo` through Azure Resource Manager. This did not require storage keys or queue data-plane roles.
- HTTPS and TLS 1.2 are enforced; shared-key and anonymous blob access are disabled.
- Management-group policy `StorageAccount_PublicNetwork_Modify`, under assignment `MCAPSGovDeployPolicies`, enforces disabled public network access. Its display name is `SFI - Disable public network access on Storage accounts (excluding NSP configured resources)`. A public-access update was modified by this policy; the effective setting remains Disabled.
- Subsequently created queue private endpoint `pe-keda-queue` at `10.81.2.4` and private DNS linked to the flat VNet. A temporary flat-cluster pod verified private resolution and certificate-validated HTTPS to Azure Queue, which returned 401 without credentials. The original probe expected 403 and failed its assertion; a corrected probe passed, and both test pods were removed. This did not test queue data authorization or grant the laptop private connectivity.
- The signed-in user has Owner permissions on Azure resources, but no queue data roles were found. Approval to assign queue-scoped data roles was requested but not confirmed while the user was unavailable. No new roles were assigned.
- The official Queue SDK's read-only property request returned `AuthorizationFailure`. The UI displays this error and disables enqueue. This is a real connectivity/authorization blocker, not a fake empty queue.
- The KEDA lab's processor and scaler are not deployed. Identity federation, queue permissions, and processor images remain unresolved. No live enqueue, consumption, or KEDA scaling was verified.

## Run Locally

Requires Node.js 22+, npm, Azure CLI, and kubectl. Authenticate interactively to the training tenant using your own machine's Azure CLI. Do not copy credentials or commit login caches. The SDK uses `AzureCliCredential` pinned to tenant `45b68ab1-2c84-414f-918d-e945e189121d`; Kubernetes reads always use context `aks-training-flat` and namespace `keda-lab`.

```powershell
npm --prefix apps/keda-console ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm --prefix apps/keda-console test
if ($LASTEXITCODE -ne 0) { throw 'Console tests failed.' }
npm --prefix apps/keda-console start
```

Open http://127.0.0.1:18083. The server binds only to `127.0.0.1`. Unlike the HPA console, this application runs on the instructor machine, not inside AKS, and needs no Kubernetes Service tunnel. Do not expose it to other machines: it acts as the signed-in Azure user and has no end-user login layer.

## Controls and Guarantees

- Choose 1-500 messages or use the count presets, then enqueue one batch. No messages are sent automatically on page load or on a timer.
- Each message contains a unique ID, batch ID, sequence, timestamp, and fixed synthetic source label. Messages expire after one hour if no processor consumes them.
- Sends are sequential, with a 60-second batch deadline and SDK retries disabled. Cancel stops further sends; it does not delete messages already accepted by Azure.
- Confirmed sent counts reflect acknowledged sends only. A timeout or connection loss can leave the last request's outcome uncertain. Such sends are not automatically retried, and this is not an exactly-once guarantee.
- The latest 100 HTTP request IDs are deduplicated in server memory. Retries of the same accepted request ID do not resend its batch. Restarting the server loses this history; reloading the page loses its pending retry ID.
- Queue depth is approximate and may lag sends or include invisible in-flight messages. It is not a precise count of completed processing. The chart stores recent observations in browser memory only.
- Queue/cluster telemetry is cached for ten seconds; batch progress is returned fresh. Only the last ten batches are retained in server memory.
- A missing processor is shown explicitly. Once queue access works, messages may be enqueued even without processors, but they remain in the queue until consumed or expired. A missing KEDA workload is not shown as healthy scale-to-zero.

## Required Next Steps

1. Connect the console to the now-created private endpoint. Private DNS and HTTPS are verified from the flat cluster, but this local console still needs a private route/DNS path from the instructor machine, or an AKS-hosted version using Workload Identity. No laptop VPN, policy exemption, or NSP was created. Do not evade or disable the governance policy.
2. Approve least-privilege data roles for the sender: `Storage Queue Data Message Sender` and `Storage Queue Data Reader`, scoped to this dedicated queue. Management-plane Owner is not sufficient for the SDK's queue operations. Reader is needed for approximate depth; sender is needed for enqueue. The console includes no purge, dequeue, delete, or queue-creation endpoint.
3. Recheck queue properties with the SDK and perform a small synthetic enqueue after network and identity access are resolved.
4. If demonstrating actual autoscaling, complete and deploy the [KEDA lab](../../labs/keda/README.md), including the processor image, separate application/scaler identity federation, and queue permissions. The console's batch producer can replace the optional timed generator Job for classroom use; no changes to the processor's message handling are required for the JSON text payloads.

## Tests and Verification

Seven Node tests pass: batch bounds, unique messages and TTL, overlap and deduplication handling, cancellation, partial failures, local assets, Host/origin controls, and explicit unavailable-resource states. These tests use injected queue implementations; they do not prove Azure data-plane access.

Live Azure management-plane creation and policy events were checked. A real Queue SDK property read failed with `AuthorizationFailure`, recorded above. Desktop (1440 x 1000) and mobile (390 x 844) screenshots showed real blocked-state telemetry, rendered icons/chart axes, and no detected horizontal overflow in checked controls. The enqueue control was correctly disabled. Successful enqueue/cancel behavior was tested locally, not against the protected Azure queue.

The source uses official `@azure/identity` and `@azure/storage-queue` packages, plus locally served Lucide icons. Exact dependency versions are recorded in the lockfile. No custom Docker image was built, no AKS workload was deployed, and no ACR or existing-cluster configuration was changed. Source changes remain uncommitted.

## Retained Resources

Stopping the local console does not delete Azure storage or Private Link resources. The account, queue, private endpoint, and private DNS remain and can incur charges. There are no queued messages confirmed from this console. Deleting or changing retained cloud resources requires a separate request. See [infra.md](../../infra.md) for the authoritative inventory and [HANDOFF.md](../../HANDOFF.md) for project continuation.