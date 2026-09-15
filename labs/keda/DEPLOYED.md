# Deployed Private Queue Demo

Deployed on 2026-09-15 to `aks-training-flat`, namespace `keda-lab`. This is the current operating guide; the original upstream Go generator discussion is historical.

## Open the Console

```powershell
kubectl --context aks-training-flat -n keda-lab port-forward service/keda-console 18084:80 --address 127.0.0.1
```

Open http://127.0.0.1:18084. The browser talks to a localhost tunnel; the AKS-hosted console connects privately to `stakskeda555a1e03.queue.core.windows.net` at `10.81.2.4`. There is no public ingress or storage access. The old localhost Node app on 18083 is not the deployed console and still lacks a private route from the laptop.

For a classroom run, enqueue 30 messages and observe the queue backlog, KEDA Active status, desired replicas, and processor pods. Try 60 messages for a larger visible backlog. Messages take approximately three seconds each to process. Queue counts and status refreshes are approximate and asynchronous; metrics can momentarily lag a completed batch.

Cancel stops further sends only. It does not delete messages already queued. Consumers continue processing until the queue drains, then KEDA scales them to zero after its cooldown. The console remains one replica. A zero-processor state with an empty queue and a Ready ScaledObject is healthy. The generated HPA may show a minimum of one or unavailable metrics at zero: KEDA handles the zero/one transitions, while HPA handles active replicas up to six.

## Runtime and Resources

- `keda-console`: one-replica Deployment, Service, ServiceAccount, namespace read-only Role/RoleBinding, and ingress-deny NetworkPolicy. The instructor's authorized port-forward remains usable; ordinary incoming pod traffic is denied.
- `azure-queue-processor`: Deployment controlled by `azure-queue-scaler`, 0-6 replicas, queue target 10, polling 10 seconds, cooldown 60 seconds, HPA scale-down stabilization 60 seconds.
- Source: [apps/keda-console](../../apps/keda-console/README.md), including a new Node Queue SDK processor. This deployment does not run the upstream Go binaries and does not build an ACR image.
- `keda-console-code` contains backend source plus package manifest/lockfile; `keda-console-ui` contains the browser files. Init containers copy these into an ephemeral `/app` volume and run locked `npm ci --omit=dev --ignore-scripts`. Main containers mount the result read-only. The public Node base image is digest-pinned in the manifests.
- Every new processor pod needs access to the public image registry and npm registry for initialization. This adds cold-start latency and is a training convenience, not a production packaging pattern. Prefer prebuilt, scanned images for production. No ACR permissions were added for this implementation.
- Each processor uses the official Azure Queue SDK, receives one message at a time with a 120-second visibility timeout, waits three seconds, and deletes using its pop receipt. On SIGTERM it stops fetching new messages and finishes the in-flight delay/delete before exit. Failed processing leaves the message for re-delivery. No exactly-once or poison-message guarantee is implemented, and visibility is not renewed for long-running work; processing delay is bounded to 1-10 seconds.
- No generator Job is deployed. The console is the message producer. The old [generator.yaml](generator.yaml) remains an undeployed upstream template with an unresolved image tag; it is excluded from the deployment script. Its original workload identity assumptions no longer apply: the consumer identity intentionally has no send permission. Do not apply the entire directory to run the demo.

## Workload Identity and Queue Roles

All three identities are in resource group `aks-training`. All role assignments below are scoped only to:

```text
/subscriptions/555a1e03-73fb-4f88-9296-59bd703d16f3/resourceGroups/aks-training/providers/Microsoft.Storage/storageAccounts/stakskeda555a1e03/queueServices/default/queues/keda-demo
```

| Identity | Client ID | Federated Subject | Queue Roles |
| --- | --- | --- | --- |
| `id-keda-console` | `12effe31-84d0-4dfe-85fe-0b3533d43b76` | `system:serviceaccount:keda-lab:keda-console` | Storage Queue Data Message Sender; Storage Queue Data Reader |
| `id-keda-processor` | `6c941ddf-3965-48b5-963f-8f5a5ffdb1a4` | `system:serviceaccount:keda-lab:azure-queue-workload` | Storage Queue Data Message Processor |
| `id-keda-scaler` | `e93870dd-f12d-490a-82b4-a76d5b28cf43` | `system:serviceaccount:kube-system:keda-operator` | Storage Queue Data Reader |

Federated issuer: `https://centralindia.oic.prod-aks.azure.com/45b68ab1-2c84-414f-918d-e945e189121d/abb40d98-82c0-4dad-91c9-571a15d42a8b/`. Audience: `api://AzureADTokenExchange`.

Role assignment IDs, in table order: console sender `74ac71de-df4b-46ac-87ac-3f25b967f59b`, console reader `6ce54394-21b0-4490-a7ee-c92ca571a36c`, processor `a129a5f7-6b4d-4527-b23e-b4bfa5042e8e`, scaler reader `ef880e06-3512-4e7b-bd94-6104668f68a2`.

The console has only read permissions in Kubernetes, not permission to change replicas, Jobs, secrets, or RBAC. The processor does not mount the normal Kubernetes API token; the Workload Identity webhook supplies its separate federation token. The existing managed KEDA operator uses an identity override in TriggerAuthentication and was not reinstalled or patched.

## Update the Application

From the repository root with PowerShell 7, Node 22+, Azure CLI login, and the correct kubectl context:

```powershell
npm --prefix apps/keda-console ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm --prefix apps/keda-console test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
& ./apps/keda-console/deploy.ps1
```

The script runs tests, server-side validation, publishes only explicit source files in ConfigMaps, and deploys only the console/processor/scaler baseline. It restarts existing Deployments without setting processor replica count. Prefer updating after the queue has drained. Reconnect the tunnel after a console rollout. Azure identity/role resources already exist; the script does not provision or grant Azure permissions.

## Inspect and Troubleshoot

```powershell
kubectl --context aks-training-flat -n keda-lab get deployments,pods,scaledobjects,hpa
kubectl --context aks-training-flat -n keda-lab describe scaledobject azure-queue-scaler
kubectl --context aks-training-flat -n keda-lab logs deployment/keda-console --tail=30
kubectl --context aks-training-flat -n keda-lab logs -l app=azure-queue-processor -c processor --tail=30 --prefix
```

- `AuthorizationFailure`: distinguish DNS/private routing from identity federation and queue-role propagation. The queue hostname must resolve to `10.81.2.4` from this VNet; public network access stays Disabled.
- Federation failures: verify the flat issuer, exact ServiceAccount subject, client IDs (not principal IDs), and `azure.workload.identity/use: "true"` labels.
- Init errors: inspect `prepare-runtime` logs for dependency registry/TLS failures. Do not disable TLS or introduce credentials into ConfigMaps.
- Consumer logs are available only while pods exist; no centralized log collection was added. At zero replicas, a log selector may find no pods normally.
- The oversized QoS pod and zero-disruption PDB in other namespaces are deliberate teaching setups, not errors to fix as part of this lab.

## Cleanup

When separately requested, remove only `keda-lab` after allowing the queue to drain. This does not remove Azure storage, messages, private endpoint/DNS, managed identities, role assignments, or the KEDA add-on. Those resources incur their normal charges until explicitly cleaned up. Do not remove the other training namespaces or disable the storage security policies.

## Verification

11 Node tests pass, including Workload Identity selection, graceful consumer shutdown, and in-cluster PodList normalization. Client schema and server admission checks passed; console rollout and ScaledObject Ready checks passed.

- Two live UI batches each sent 30/30 messages with zero failures. KEDA activated from zero and requested three processors; consumer logs confirmed processing and deletion. Both runs returned to zero after the queue drained.
- Corrected PodList normalization and verified the deployed UI lists actual Ready processor names and their nodes. Desktop (1440 x 1000) and mobile (390 x 844) screenshots were inspected; chart pixels and local icons rendered, and checked controls had no horizontal overflow.
- Final state: console 1/1 Ready, zero restarts; processor Deployment 0/0; ScaledObject Ready=True, Active=False; queue approximate count 0 with no SDK access error; no generator Job. The second batch remains in the console's in-memory history until the console restarts.
- Storage still has public network access Disabled, shared-key access false, and its private endpoint connection Approved. No human-user data roles, kubelet roles, or policy exceptions were created.
- Source and documentation changes are not committed or pushed. The localhost-only Service tunnel on port 18084 was left running for the user.