# KEDA Azure Storage Queue Lab

Queue-scaling lab inspired by [Lester March's AKS KEDA demo](https://github.com/lestermarch/demo-aks-keda). Target: existing `aks-training-flat`, namespace `keda-lab`. Do not recreate AKS, reinstall KEDA, or replace ACR.

## Current Deployment

The console, Node Queue SDK processor, identities, and ScaledObject are now deployed using private queue access. **Use the [deployed lab guide](DEPLOYED.md)** and http://127.0.0.1:18084 through the console Service tunnel. The console replaces the upstream generator for classroom batches. The old `generator.yaml` remains an unconfigured reference and is NOT applied by the deployment script. Do not apply the full directory, and do not follow the original Go image/federation steps below against the active runtime.

## Historical Manifest Preparation

Prepared on 2026-09-15. The Kubernetes manifests are not deployed or end-to-end tested. Subsequently created storage account `stakskeda555a1e03` and queue `keda-demo` for the [local queue console](../../apps/keda-console/README.md), and populated the account name in these templates. Azure Policy enforces disabled public access and queue data-role approval is pending, so the console currently shows an authorization error. Identity placeholders, federation, permissions, private connectivity, and both application images must still be resolved before deploying the processor/scaler. The installed flat-cluster CRDs expose `keda.sh/v1alpha1`; no KEDA workloads were created here.

All seven YAML resources passed `kubectl apply --dry-run=client --validate=true` using the installed Kubernetes/KEDA schemas. This involved read-only API/schema access, not live deployment or scaler authentication testing. Server-side admission and application runtime behavior remain unverified.

## Files

| Manifest | Purpose |
| --- | --- |
| [namespace.yaml](namespace.yaml) | Isolated `keda-lab` namespace |
| [config.yaml](config.yaml) | Queue name, account name, generation range, processing delay |
| [service-account.yaml](service-account.yaml) | Workload Identity for both sample applications |
| [processor.yaml](processor.yaml) | Queue consumer Deployment, managed by KEDA |
| [trigger-authentication.yaml](trigger-authentication.yaml) | Separate Azure identity used by KEDA to read queue metrics |
| [scaled-object.yaml](scaled-object.yaml) | Queue-length scaler and generated HPA settings |
| [generator.yaml](generator.yaml) | Optional, time-bounded message producer Job |

## Flow and Limits

The generator sends a random batch of 12-36 messages, then sleeps for 60 seconds. Each processor retrieves a message, simulates three seconds of work, and deletes it. When no messages are available, the upstream processor waits 20 seconds before retrying.

KEDA polls every 10 seconds and uses a target of 10 messages per replica. The processor is bounded to **0-6 replicas**, rather than the upstream 1-250. An empty queue can therefore scale the processor to zero; new messages activate it again. KEDA controls activation and scale-to-zero, while its generated HPA handles scaling among active replicas. Do not create a second HPA or apply the CPU HPA from the separate lab to this Deployment.

`cooldownPeriod: 60` concerns scaling to zero after inactivity; the HPA's 60-second scale-down stabilization concerns active-replica reductions. Neither guarantees scaling at exactly 60 seconds. Queue counts are approximate and sampling, in-flight messages, and scheduling affect the result. The default Azure Queue scaler strategy counts visible and invisible messages.

The processor manifest omits `spec.replicas` so later applies do not reset KEDA's desired count. Initial creation can briefly start one pod before KEDA takes control.

The upstream generator never exits normally. Its Job is limited by `activeDeadlineSeconds: 180`, plus a five-second termination grace period, with no retries. **`Failed / DeadlineExceeded` is expected when this runtime cap ends the run**, not a successful Job completion. It usually sends a few batches, not an exact guaranteed total. Completed/failed Jobs are removed after ten minutes. For an exact finite message count and successful completion, the generator code would need a separate enhancement.

## Required Values and Azure Setup

These prerequisites are not created by the YAML, and enabling the KEDA add-on alone does not configure them:

1. An Azure Storage account and dedicated queue reachable from the cluster. Default queue name here is `keda-demo`. Do not use a queue carrying real workloads or sensitive messages.
2. Images built from the upstream `apps/az-message-generator` and `apps/az-message-processor` sources, published as Linux AMD64 images to the existing registry. The old `scaling/worker` image is a Redis worker, not this Azure Queue processor. No suitable image is assumed to already exist.
3. A user-assigned **workload identity** used by the generator and processor, with queue data permissions for sending, receiving, and deleting. A lab-friendly shared identity can use `Storage Queue Data Contributor` scoped to the dedicated queue or account; separate application identities are preferable for tighter isolation.
4. A separate **KEDA identity** with `Storage Queue Data Reader` access to the dedicated queue/account for queue properties used by the scaler. This is not the kubelet image-pull identity.
5. Federated identity credentials using the flat cluster's OIDC issuer and audience `api://AzureADTokenExchange`:
   - Workload identity subject: `system:serviceaccount:keda-lab:azure-queue-workload`.
   - KEDA identity subject: `system:serviceaccount:kube-system:keda-operator`, after confirming that is the managed add-on's operator ServiceAccount. The identity override in TriggerAuthentication must be federated with the **operator's** ServiceAccount, not only the application account.
6. The installed KEDA operator must support Azure Workload Identity token acquisition and the chosen identity override. Verify managed add-on configuration without replacing its ServiceAccount or installing a second operator.
7. The flat cluster's kubelet needs appropriate image-pull authorization on ACR. The earlier console used public Node plus ConfigMaps and did not grant flat-cluster `AcrPull`. Check existing permissions and obtain approval before adding any Azure roles.

| Placeholder | Replace In | Expected Value |
| --- | --- | --- |
| `stakskeda555a1e03` (populated) | ConfigMap and ScaledObject | Created account; network/data access is still blocked |
| `REPLACE_WITH_WORKLOAD_IDENTITY_CLIENT_ID` | ServiceAccount annotation | Workload managed identity **client ID**, not object/principal ID |
| `REPLACE_WITH_KEDA_IDENTITY_CLIENT_ID` | TriggerAuthentication | Scaler managed identity **client ID** |
| `replace-with-built-tag` | Both application images | Verified published tag for each image, preferably pin its digest |

The tenant annotation uses the existing training tenant recorded in [infra.md](../../infra.md). If changing the queue name, update both ConfigMap and ScaledObject. Changes to ConfigMap environment variables or ServiceAccount identity annotations require new application pods to take effect.

Both application pod templates carry `azure.workload.identity/use: "true"`. The Workload Identity webhook injects Azure authentication variables and its projected federation token. `automountServiceAccountToken: false` disables the ordinary Kubernetes API token, not that explicitly injected federation token. No storage account keys, client secrets, or connection strings are embedded in these files.

## Validation and Future Deployment Order

From the repository root, locate unresolved placeholders first:

```powershell
Get-ChildItem labs/keda -Filter *.yaml | Select-String -Pattern 'REPLACE_WITH_|replace-with-built-tag'
kubectl --context aks-training-flat get crd scaledobjects.keda.sh triggerauthentications.keda.sh
kubectl --context aks-training-flat apply --dry-run=client --validate=true -f labs/keda/
```

Schema checks cannot validate Azure identity federation, queue access, image existence, or working scaler authentication. Do not deploy until the prerequisites and replacements above are complete. After explicit deployment approval:

```powershell
$Templates = Get-ChildItem labs/keda -Filter *.yaml | Select-String -Pattern 'REPLACE_WITH_|replace-with-built-tag'
if ($Templates) { throw 'Replace all KEDA manifest placeholders before deployment.' }
kubectl --context aks-training-flat apply -f labs/keda/namespace.yaml
if ($LASTEXITCODE -ne 0) { throw 'Namespace creation failed.' }
kubectl --context aks-training-flat apply --dry-run=server -f labs/keda/
if ($LASTEXITCODE -ne 0) { throw 'Admission validation failed.' }
kubectl --context aks-training-flat apply -f labs/keda/config.yaml -f labs/keda/service-account.yaml -f labs/keda/processor.yaml -f labs/keda/trigger-authentication.yaml -f labs/keda/scaled-object.yaml
if ($LASTEXITCODE -ne 0) { throw 'KEDA baseline deployment failed.' }
kubectl --context aks-training-flat -n keda-lab wait scaledobject/azure-queue-scaler --for=condition=Ready --timeout=120s
kubectl --context aks-training-flat -n keda-lab get scaledobject,hpa,deployments,pods
```

Wait for the scaler to be Ready before starting the generator. With an empty queue, `Active=False` and zero processor replicas can be healthy idle behavior. Do not require Deployment rollout to one Ready pod as an idle success criterion.

## Demonstrate Backlog Scaling

Apply only the generator once the baseline is healthy, then observe:

```powershell
kubectl --context aks-training-flat apply -f labs/keda/generator.yaml
kubectl --context aks-training-flat -n keda-lab logs -f job/azure-queue-generator --pod-running-timeout=120s
```

In another terminal:

```powershell
kubectl --context aks-training-flat -n keda-lab get deployment azure-queue-processor --watch
```

Inspect the complete state and processor logs in a separate terminal:

```powershell
kubectl --context aks-training-flat -n keda-lab get scaledobject,hpa,deployments,pods
kubectl --context aks-training-flat -n keda-lab describe scaledobject azure-queue-scaler
kubectl --context aks-training-flat -n keda-lab logs -l app=azure-queue-processor --tail=30 --prefix
```

Stopping the log command does not stop the producer. Let the deadline expire or stop it explicitly:

```powershell
kubectl --context aks-training-flat -n keda-lab delete job azure-queue-generator --ignore-not-found --cascade=foreground --wait=true --timeout=90s
kubectl --context aks-training-flat -n keda-lab get deployment azure-queue-processor --watch
```

The remaining messages must drain before scale-to-zero. Delete a completed/failed generator Job before applying its manifest again; applying an existing completed Job does not rerun it.

## Sample Caveats

The upstream processor lacks explicit SIGTERM handling, message visibility renewal, and idempotency/poison-message logic. A termination grace period in YAML cannot implement those features. Keep the three-second processing delay; if processing exceeds the queue visibility timeout, another worker can receive the same message. Azure Queue processing is not an exactly-once guarantee. The generator gives messages a two-hour TTL, so a broken processor can leave backlog after the demo.

The manifests add non-root execution, read-only filesystems, dropped capabilities, and resource bounds. Compatibility with the eventual built images must still be tested. The upstream Dockerfiles use `golang:latest`; use reviewed, versioned builds before running this lab. No HTTP Service is required for these background applications. A separate [queue console](../../apps/keda-console/README.md) now supports instructor-triggered synthetic batches, but live sending remains blocked by storage networking and data permissions.

## Cleanup Scope

When requested, deleting only `keda-lab` removes the workloads and KEDA objects, but does not delete the Azure queue or messages, managed identities, role assignments, ACR images, or KEDA add-on. Stop the generator and let the queue drain before removing processors when preserving queued work matters. Retained Azure resources can still incur charges. Do not delete the resource group or disturb existing HPA/QoS/PDB labs.

## References

- [Original lab](https://github.com/lestermarch/demo-aks-keda)
- [KEDA Azure Storage Queue scaler](https://keda.sh/docs/2.18/scalers/azure-storage-queue/)
- [KEDA Azure Workload Identity](https://keda.sh/docs/2.18/authentication-providers/azure-ad-workload-identity/)