# Lab 01: Scaling with HPA, PDBs, and KEDA

Allow 75-90 minutes. Use the existing `aks-training-overlay` cluster and the training infrastructure in [infra.md](../../infra.md). The [browser presenter and custom images](../../apps/scaling-demo/README.md) are now available. On 2026-09-13 the presenter was deployed and HPA scale-out from two to four replicas was observed with the custom web/load images. See the completion record for remaining checks.

For a browser-led demonstration, open http://127.0.0.1:18080 while the presenter's localhost port-forward is running. It shows each reviewed command, its explanation, and live output. It does not provide an unrestricted shell or enable KEDA. Use the [reconnect instructions](../../apps/scaling-demo/README.md#reconnect) after restarting your terminal or changing machines.

## Outcomes

By the end, you should be able to:

- Scale a web Deployment using CPU utilization and explain the role of CPU requests.
- Observe a PodDisruptionBudget reject an eviction, then permit it after capacity is added.
- Scale queue workers from zero using KEDA, inspect its generated HPA, and return to zero.
- Distinguish pod scaling, node scaling, and disruption protection.

| Mechanism | What it controls | Signal used in this lab |
| --- | --- | --- |
| HPA | Deployment replica count | Average CPU utilization relative to requests |
| PDB | Whether an API eviction is permitted; it does not scale pods | Ready pods versus `minAvailable` |
| KEDA | Activation/deactivation and an HPA for the target Deployment | Redis list length |
| Cluster autoscaler | Number of nodes; not enabled by this lab | Unschedulable pods and removable nodes |

## Boundaries and prerequisites

- Work through each section, not the whole guide as a script. Stop on unexpected errors. The rejected eviction is the one intentional error.
- Use PowerShell 7 (`pwsh` on macOS), Azure CLI, `kubectl`, and Azure `kubelogin`. Keep kubectl within one minor version of the API server.
- Obtain Azure login and cluster user credentials using [the infrastructure access guide](../../infra.md#access). Never use local admin credentials or commit kubeconfigs.
- All examples run from the repository root. Initialize the variables below in every terminal used for the lab. Every Kubernetes request targets the explicit context.
- One learner at a time uses `scaling-lab`. It now contains the deployed presenter and demonstration workloads; verify ownership before reusing it. A different namespace requires updating manifest namespaces, the KEDA Redis address, presenter catalog, and RBAC.
- HPA and PDB need no new add-ons if Metrics Server is healthy. KEDA requires a cluster-wide add-on; its approval checkpoint is separate from applying lab workloads.
- No node drain, VM resizing, node autoscaling, paid monitoring, public Service, managed queue, or new cluster is part of this lab. The flat cluster is not touched.
- Existing VM and networking charges continue. Scaling pods to zero does not stop or reduce the number of nodes. KEDA itself also needs cluster resources.
- The custom `scaling/web`, `scaling/load`, `scaling/worker`, and `scaling/presenter` images are in the training ACR with tag `1.0.0`. [Builds and digests](../../apps/scaling-demo/README.md#images) are recorded. These are training images, not a hardened production baseline. ACR pulls use the overlay kubelet managed identity, not registry passwords.
- Redis is disposable, unencrypted, and unauthenticated, with no persistent disk. Its NetworkPolicy allows workers and the presenter in this namespace and managed KEDA components in `kube-system` on port 6379. Use synthetic messages only. This is not a production queue design.

## 1. Verify the target and capacity

Run these read-only checks before deploying anything. Historical health in the handoff is not a current health check.

```powershell
$Subscription = '555a1e03-73fb-4f88-9296-59bd703d16f3'
$Tenant = '45b68ab1-2c84-414f-918d-e945e189121d'
$ResourceGroup = 'aks-training'
$Context = 'aks-training-overlay'
$Namespace = 'scaling-lab'
$Lab = './labs/01-scaling'

Write-Host 'Checking Azure account and existing cluster'
$Account = az account show --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Azure login is required; see the access guide.' }
if ($Account.id -ne $Subscription -or $Account.tenantId -ne $Tenant) {
    throw 'Wrong Azure subscription or tenant. Correct the login context before continuing.'
}
$Cluster = az aks show --resource-group $ResourceGroup --name $Context --subscription $Subscription --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the existing cluster.' }
if ($Cluster.provisioningState -ne 'Succeeded' -or $Cluster.powerState.code -ne 'Running') {
    throw 'Cluster is not ready. Investigate without starting or recreating it.'
}
$Cluster | Select-Object name, kubernetesVersion, provisioningState, powerState, workloadAutoScalerProfile

$ApiServer = kubectl --context $Context config view --minify -o jsonpath='{.clusters[0].cluster.server}'
if ($LASTEXITCODE -ne 0) { throw 'Cluster context is missing; see the access guide.' }
if (([uri]$ApiServer).Host -ne $Cluster.fqdn) {
    throw 'Kubeconfig API endpoint does not match this Azure cluster. Refresh user credentials.'
}
kubectl --context $Context get nodes -o wide --request-timeout=30s
kubectl --context $Context get pods -n kube-system --request-timeout=30s
kubectl --context $Context get apiservice v1beta1.metrics.k8s.io
kubectl --context $Context top nodes
kubectl --context $Context describe nodes
kubectl --context $Context get namespace $Namespace --ignore-not-found
```

Proceed only when both nodes are Ready, system pods are healthy, the metrics API is Available, and `top nodes` returns values. For a fresh lab, the final command returns no namespace. For the deployed presenter, verify the existing namespace belongs to this training run before continuing. Review **Allocated resources** in `describe nodes`, not just instantaneous utilization.

At HPA's four-pod cap, web pods plus the load generator request 450m CPU and 320Mi memory, with CPU limits totaling 2.1 cores. The presenter adds 100m CPU and 128Mi memory requests. The KEDA phase runs after the web pods are removed: Redis plus four workers request 150m CPU and 320Mi memory, in addition to the presenter and managed KEDA components. Leave headroom for system workloads and transient replacement pods. If capacity is insufficient, stop rather than resize nodes.

VS Code Azure tools have a separate authentication context. These examples use Azure CLI only; verify the extension's subscription/tenant separately before using it for resource operations.

## 2. HPA: CPU-driven scale-out and scale-in

### Establish a healthy baseline

Read [web.yaml](web.yaml), [hpa.yaml](hpa.yaml), and [load.yaml](load.yaml). Predict what `averageUtilization: 50` means when each web container requests `100m` CPU.

```powershell
Write-Host 'Creating the lab namespace and validating web resources'
kubectl --context $Context apply -f "$Lab/namespace.yaml"
kubectl --context $Context -n $Namespace apply --dry-run=server -f "$Lab/web.yaml" -f "$Lab/hpa.yaml" -f "$Lab/load.yaml"
kubectl --context $Context -n $Namespace apply -f "$Lab/web.yaml"
kubectl --context $Context -n $Namespace rollout status deployment/cpu-web --timeout=180s
kubectl --context $Context -n $Namespace apply -f "$Lab/hpa.yaml"
kubectl --context $Context -n $Namespace get hpa,pods
kubectl --context $Context -n $Namespace top pods
```

Expected: two Ready web pods and an HPA with a minimum of two and maximum of four. Metrics can show `<unknown>` initially; allow a few collection cycles. Persistent missing metrics are a prerequisite failure, not a reason to increase load.

The target is **50m CPU per pod on average**, not 50% of the 500m limit or 50% of a node. Ignoring tolerance, startup handling, and stabilization, the approximation is:

$$
\text{desiredReplicas} = \left\lceil \text{currentReplicas} \times \frac{\text{currentUtilization}}{\text{targetUtilization}} \right\rceil
$$

For two pods averaging 100m each, utilization is 100% of the request; the formula recommends four replicas. The HPA then applies its bounds and scaling behavior. CPU limits can throttle work; requests affect both scheduling and this utilization calculation.

### Generate load and inspect the decision

```powershell
Write-Host 'Starting a bounded, two-minute load job'
kubectl --context $Context -n $Namespace apply -f "$Lab/load.yaml"
kubectl --context $Context -n $Namespace get hpa cpu-web --watch
```

Watch for CPU above target and replica count increasing above two, up to four. Allow roughly 1-3 minutes; timings depend on metrics collection and image startup. Press Ctrl+C to stop a watch; that does **not** stop the load Job. The generator ends after 120 seconds; its 180-second Job deadline is a safety backstop. Delete and reapply the Job to repeat it after metrics become available.

Inspect the evidence:

```powershell
kubectl --context $Context -n $Namespace get deployment cpu-web
kubectl --context $Context -n $Namespace top pods
kubectl --context $Context -n $Namespace describe hpa cpu-web
kubectl --context $Context -n $Namespace logs job/load-generator --tail=20
```

Find `AbleToScale`, `ScalingActive`, `ScalingLimited`, and the `SuccessfulRescale` events. Hitting `maxReplicas` can make `ScalingLimited=True`; that is not necessarily an error. The load generator prints a JSON summary every five seconds: `succeeded`, `failed`, `averageMs`, and `servedBy` counts for each responding pod. It creates fresh HTTP connections so Service routing can reach different replicas. The web API is `POST /work`; ordinary status/health requests do not generate CPU work.

### Remove load

```powershell
Write-Host 'Stopping load and observing scale-in'
kubectl --context $Context -n $Namespace delete job load-generator --ignore-not-found --wait=true
kubectl --context $Context -n $Namespace get hpa cpu-web --watch
```

Expected: CPU falls and the Deployment returns to two replicas, usually after a few minutes. This lab explicitly uses a 60-second scale-down stabilization window; the Kubernetes default is normally 300 seconds. A window retains recent higher recommendations to reduce oscillation; it is not an exact countdown from the last HTTP request.

Checkpoint: record the baseline, peak replicas, and scale-in time. Explain why the HPA cannot add nodes and why reapplying `web.yaml` while the HPA is active can temporarily reset replicas. To repeat the load, first delete any previous `load-generator` Job, then reapply it.

## 3. PDB: reject and permit a voluntary eviction

An API eviction is the mechanism used by a normal node drain, but this exercise targets **one lab pod**. Do not drain or cordon a node on the shared cluster.

### Freeze replicas at two

Remove the HPA before manually changing replica counts so two controllers are not competing. Read [pdb.yaml](pdb.yaml).

```powershell
Write-Host 'Preparing two Ready pods with a minimum availability of two'
kubectl --context $Context -n $Namespace delete hpa cpu-web --ignore-not-found
kubectl --context $Context -n $Namespace scale deployment cpu-web --replicas=2
kubectl --context $Context -n $Namespace rollout status deployment/cpu-web --timeout=180s
kubectl --context $Context -n $Namespace apply --dry-run=server -f "$Lab/pdb.yaml"
kubectl --context $Context -n $Namespace apply -f "$Lab/pdb.yaml"
kubectl --context $Context -n $Namespace get pods -l app=cpu-web
kubectl --context $Context -n $Namespace get pdb cpu-web --watch
```

Wait for exactly two Ready web pods with no terminating pods. Expect `ALLOWED DISRUPTIONS=0`. Stop the watch with Ctrl+C and inspect `kubectl --context $Context -n $Namespace describe pdb cpu-web` for `Current Healthy=2` and `Desired Healthy=2`.

### Attempt the blocked eviction

The following selects a Ready pod and uses a structured `policy/v1` Eviction body. It does not delete the pod directly.

```powershell
$Pods = kubectl --context $Context -n $Namespace get pods -l app=cpu-web -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Unable to select a lab pod.' }
$Victim = $Pods.items | Where-Object {
    -not $_.metadata.deletionTimestamp -and
    ($_.status.conditions | Where-Object { $_.type -eq 'Ready' -and $_.status -eq 'True' })
} | Select-Object -First 1
if (-not $Victim) { throw 'No Ready web pod is available.' }
$PodName = $Victim.metadata.name
$Eviction = @{
    apiVersion = 'policy/v1'
    kind = 'Eviction'
    metadata = @{ name = $PodName; namespace = $Namespace }
} | ConvertTo-Json -Depth 4 -Compress
$Eviction | kubectl --context $Context -n $Namespace create --raw "/api/v1/namespaces/$Namespace/pods/$PodName/eviction" -f -
```

Expected: HTTP 429 / `TooManyRequests`, with **Cannot evict pod as it would violate the pod's disruption budget**. The selected pod remains present. A 403 is an RBAC problem, not a successful PDB test; a 404 means the selected pod disappeared and must be selected again. Do not bypass the budget with direct deletion.

### Add availability, then retry

```powershell
Write-Host 'Adding one replica so one voluntary disruption is permitted'
kubectl --context $Context -n $Namespace scale deployment cpu-web --replicas=3
kubectl --context $Context -n $Namespace rollout status deployment/cpu-web --timeout=180s
kubectl --context $Context -n $Namespace get pdb cpu-web --watch
```

Wait for `ALLOWED DISRUPTIONS=1` and three Ready pods, then stop the watch. **Run the entire eviction block above again**, including selecting a fresh Ready pod. This time the request should succeed. Observe recovery:

```powershell
kubectl --context $Context -n $Namespace get pods -l app=cpu-web -o wide --watch
```

Stop the watch once there are three Ready replacement/current pods. The Deployment restores its desired count; the PDB does not create the replacement. The zero-disruptions interval can be too brief to catch interactively.

Important distinctions:

- PDBs constrain voluntary evictions that use the Eviction API. They do not prevent node failures, direct pod deletion, Deployment/HPA scale-down, or a Deployment's rolling update. Configure rollout strategy separately.
- Existing unavailability from involuntary failures counts against the budget, but the PDB cannot stop that failure.
- `unhealthyPodEvictionPolicy: AlwaysAllow` permits eviction of running, unready pods even when the budget is exhausted. This exercise deliberately selects a Ready pod.
- `minAvailable: 2` with only two replicas can block node maintenance. HPA's minimum of two also leaves no eviction headroom at its floor. Production choices must reconcile availability, surge capacity, and maintenance.
- A PDB does not spread pods across nodes or zones. This workload has a soft hostname spread preference, not a high-availability guarantee.

Checkpoint: explain the blocked request and identify which controller replaced the successfully evicted pod.

## 4. KEDA: queue-driven scaling from zero

### Release web capacity

After finishing the PDB exercise, remove only those lab resources. Direct workload deletion during cleanup is intentionally not subject to a PDB.

```powershell
Write-Host 'Removing the completed HPA/PDB workload'
kubectl --context $Context -n $Namespace delete job load-generator --ignore-not-found
kubectl --context $Context -n $Namespace delete hpa cpu-web --ignore-not-found
kubectl --context $Context -n $Namespace delete -f "$Lab/pdb.yaml" -f "$Lab/web.yaml" --ignore-not-found --wait=true
```

### Approval checkpoint: managed KEDA add-on

The handoff originally recorded KEDA as disabled. Recheck now and record whether it was already enabled:

```powershell
$KedaState = az aks show --resource-group $ResourceGroup --name $Context --subscription $Subscription --query workloadAutoScalerProfile.keda.enabled --output tsv
if ($LASTEXITCODE -ne 0) { throw 'Unable to determine the managed KEDA state.' }
Write-Host "Managed KEDA enabled before this lab: $KedaState"
kubectl --context $Context get crd scaledobjects.keda.sh --ignore-not-found
kubectl --context $Context get deployment -A | Select-String 'keda'
```

If enabled and healthy, reuse it. If disabled or empty, **stop and obtain explicit approval from the cluster owner before running the enable command below**. Adding files to this repository is not that approval. If a non-managed KEDA installation or external metrics adapter already exists, stop and resolve ownership/compatibility; do not install a second copy. No Helm installation is needed for the managed add-on.

Only after approval, and only if the managed add-on is not already enabled:

```powershell
Write-Host 'Enabling managed KEDA on the existing overlay cluster (approval required)'
az aks update --resource-group $ResourceGroup --name $Context --subscription $Subscription --enable-keda
if ($LASTEXITCODE -ne 0) { throw 'KEDA enablement failed. Do not continue with the manifests.' }
```

Check readiness, including when reusing an existing add-on:

```powershell
az aks show --resource-group $ResourceGroup --name $Context --subscription $Subscription --query workloadAutoScalerProfile.keda.enabled --output tsv
kubectl --context $Context wait --for=condition=Established crd/scaledobjects.keda.sh --timeout=180s
kubectl --context $Context -n kube-system get deployments,pods | Select-String 'keda'
kubectl --context $Context -n kube-system rollout status deployment/keda-operator --timeout=180s
kubectl --context $Context -n kube-system rollout status deployment/keda-operator-metrics-apiserver --timeout=180s
kubectl --context $Context wait --for=condition=Available apiservice/v1beta1.external.metrics.k8s.io --timeout=180s
kubectl --context $Context -n kube-system get deployment keda-operator -o jsonpath='{.spec.template.spec.containers[*].image}'
```

All KEDA pods, including admission webhooks, should be Ready. If component names differ, inspect the listed Deployments before adapting the checks. The AKS version controls the managed KEDA version; record the operator image and use matching KEDA documentation. Do not assume it matches the latest upstream release. No cloud credentials are needed by this Redis scaler.

### Create the queue and idle workers

Read [queue.yaml](queue.yaml) and [scaledobject.yaml](scaledobject.yaml). Workers start at zero. The scaler uses a fully qualified Redis Service address because KEDA runs in a different namespace.

```powershell
Write-Host 'Creating the disposable Redis queue and zero-replica worker'
kubectl --context $Context -n $Namespace apply --dry-run=server -f "$Lab/queue.yaml"
kubectl --context $Context -n $Namespace apply -f "$Lab/queue.yaml"
kubectl --context $Context -n $Namespace rollout status deployment/redis --timeout=180s
kubectl --context $Context -n $Namespace exec deployment/redis -- redis-cli ping
kubectl --context $Context -n $Namespace apply --dry-run=server -f "$Lab/scaledobject.yaml"
kubectl --context $Context -n $Namespace apply -f "$Lab/scaledobject.yaml"
kubectl --context $Context -n $Namespace wait --for=condition=Ready scaledobject/queue-worker --timeout=180s
kubectl --context $Context -n $Namespace get scaledobject,hpa,deployment
```

Expected: Redis responds `PONG`; ScaledObject is Ready but not Active; `queue-worker` has zero pods. KEDA creates `keda-hpa-queue-worker`. Its HPA minimum may display one while the Deployment is zero: KEDA owns activation/deactivation, and the generated HPA manages scaling while active. An inactive HPA at zero is not by itself a fault.

Never attach another HPA to `queue-worker` or edit KEDA's generated HPA; change the ScaledObject instead. Do not reapply `queue.yaml` during active scaling because it declares `replicas: 0`.

### Add synthetic work

```powershell
Write-Host 'Adding 200 synthetic queue messages'
$Messages = 1..200 | ForEach-Object { "job-$_" }
kubectl --context $Context -n $Namespace exec deployment/redis -- redis-cli RPUSH jobs @Messages
kubectl --context $Context -n $Namespace exec deployment/redis -- redis-cli LLEN jobs
kubectl --context $Context -n $Namespace get deployment queue-worker --watch
```

Watch zero become one, then increase up to four while the backlog is large. The initial poll interval is ten seconds, but scheduling and image pulls add latency. A brief intermediate count may be missed. Stop the watch with Ctrl+C while workers are still processing, then inspect:

```powershell
kubectl --context $Context -n $Namespace get scaledobject,hpa,pods
kubectl --context $Context -n $Namespace describe scaledobject queue-worker
kubectl --context $Context -n $Namespace describe hpa keda-hpa-queue-worker
kubectl --context $Context -n $Namespace logs -l app=queue-worker --all-containers=true --prefix=true --tail=10
kubectl --context $Context -n $Namespace exec deployment/redis -- redis-cli LLEN jobs
```

The scaler uses `AverageValue`: approximately one worker per five **waiting** messages, bounded by four replicas. A backlog of 20 recommends four workers; 200 still caps at four. Each worker atomically moves a message to the `processing` list, simulates two seconds of work, then acknowledges it and increments `completed`. Its JSON logs identify both the pod and job. HPA responds to queue depth even though worker CPU usage is low.

### Observe the return to zero

```powershell
kubectl --context $Context -n $Namespace get deployment queue-worker --watch
```

Expected: the queue drains, workers decrease, then return to zero after inactivity. KEDA's 60-second `cooldownPeriod` controls the transition to zero; the generated HPA's 30-second stabilization window controls ordinary scale-in while active. These are separate controls, not a guaranteed additive timer. Allow a few minutes and inspect queue length and ScaledObject conditions if workers remain.

Once zero, stop the watch and rerun the message-injection block to verify reactivation. The browser presenter creates unique IDs and displays waiting/processing/completed counts. With manual injection, use new IDs for each batch. The worker finishes its in-flight job on graceful shutdown, but a hard crash can strand a job in `processing`; there is no automatic recovery. Redis itself has no persistence. Queue length zero does not prove every message completed. Production workers still need durable storage, retries, idempotency, and crash recovery; a PDB cannot fix delivery guarantees or block autoscaler scale-down.

Checkpoint: record the generated HPA, maximum observed replicas, time to activate, and time to return to zero. Explain why the ordinary CPU HPA in part 2 could not wake workers from zero.

## Troubleshooting

| Symptom | Inspect | Likely explanation / next step |
| --- | --- | --- |
| HPA reports `<unknown>` persistently | Metrics API, `top pods`, `describe hpa` | Metrics Server unavailable, startup delay, or missing CPU requests. Restore metrics before generating more load. |
| HPA stays at two | Job status/logs, CPU metrics, HPA events | Load expired/failed, DNS or Service mismatch, or CPU below target. Delete the old Job and reapply only after checking errors. |
| More replicas requested, but pods Pending | `describe pod`, node allocated resources | Insufficient CPU/memory or another scheduling constraint. Stop load; do not resize the cluster without approval. |
| PDB never allows eviction | Ready count, selectors, PDB status | Too few Ready replicas or readiness failure. Add the planned third replica and wait; do not force deletion. |
| Eviction succeeds unexpectedly | Pod readiness, PDB selector, healthy count | Wrong pod selected, more than two healthy pods, or AlwaysAllow applied to an unhealthy pod. Re-establish the baseline. |
| ScaledObject kind is unknown | CRD and managed add-on state | KEDA is absent or not ready. Follow the approval checkpoint. |
| ScaledObject not Ready | `describe scaledobject`, KEDA operator logs | Redis DNS/connectivity, policy blocking access, or conflicting HPA ownership. Check the FQDN and installed KEDA version. |
| Workers stay at zero with queued work | Redis `LLEN jobs`, ScaledObject Active/Ready, operator logs | Scaler cannot read the list, or is paused/misconfigured. Check errors rather than manually scaling around them. |
| Workers stay running after queue drains | ScaledObject/HPA conditions and events | Cooldown/stabilization still applies, metrics errors, or work remains. A metrics error is not evidence of an empty queue. |
| ImagePullBackOff or admission rejection | Pod/Deployment events | Registry access/rate limits or cluster policy. Use approved images; do not weaken policy for the sample. |

Useful scoped diagnostics:

```powershell
kubectl --context $Context -n $Namespace get events --sort-by=.metadata.creationTimestamp
kubectl --context $Context -n $Namespace describe pods
kubectl --context $Context -n kube-system logs deployment/keda-operator --tail=100
```

Only use the KEDA log command once KEDA exists. Logs from the shared operator can include other workloads; do not publish them without review.

## Cleanup and reset

Deleting this namespace deletes **everything inside it**, including the presenter, its scoped RBAC, and synthetic queue data. It disconnects the webapp. Confirm it belongs exclusively to this run before proceeding. Do not use this on another learner's namespace. The ACR and Azure role assignments remain; do not remove them as part of routine lab cleanup.

If part 4 created a ScaledObject, delete it first while KEDA is still healthy. This lets its finalizer and generated HPA clean up normally. Skip this block if the KEDA section was not run:

```powershell
Write-Host 'Removing the lab ScaledObject while KEDA is still available'
kubectl --context $Context -n $Namespace delete scaledobject queue-worker --ignore-not-found --wait=true --timeout=120s
```

After checking ownership, cleanup for any completed or partially completed section:

```powershell
Write-Host 'Deleting only the dedicated scaling-lab namespace'
kubectl --context $Context get namespace $Namespace --show-labels
$Confirmation = Read-Host "Type $Namespace to confirm deletion of this lab namespace"
if ($Confirmation -ne $Namespace) { throw 'Cleanup cancelled.' }
kubectl --context $Context delete namespace $Namespace --ignore-not-found --wait=true --timeout=180s
if ($LASTEXITCODE -ne 0) { throw 'Namespace cleanup incomplete. Inspect finalizers; do not force-remove them.' }
kubectl --context $Context get namespace $Namespace --ignore-not-found
kubectl --context $Context get nodes
```

Expected: the namespace no longer exists and both nodes remain Ready. To rerun, begin at the preflight and namespace creation steps. No workloads are installed in the flat cluster.

**Managed KEDA stays enabled by default.** Only if it was enabled solely for this lab, no other workloads depend on it, and the cluster owner explicitly approves disabling it, inspect all KEDA resources and remove the add-on:

```powershell
kubectl --context $Context get scaledobjects,scaledjobs -A
```

Do not proceed if other workloads depend on KEDA, or if the ownership/baseline is unknown. After separate approval:

```powershell
az aks update --resource-group $ResourceGroup --name $Context --subscription $Subscription --disable-keda
if ($LASTEXITCODE -ne 0) { throw 'KEDA removal failed; inspect the cluster state.' }
az aks show --resource-group $ResourceGroup --name $Context --subscription $Subscription --query workloadAutoScalerProfile.keda.enabled --output tsv
```

Never delete a cluster, resource group, node pool, or shared metrics component as lab cleanup. After an actual run, update [HANDOFF.md](../../HANDOFF.md) with observations and verification date; update [infra.md](../../infra.md) only for verified configuration changes, such as managed KEDA enablement.

## Completion record

All 18 resources in eight YAML files passed strict Kubernetes 1.35.0 / KEDA schema checks. Ten application tests passed locally and inside all four final ACR builds. The presenter passed server dry-run, deployment readiness, live browser command execution, and desktop/mobile layout checks. HPA scale-out/scale-in and both PDB eviction cases were verified. KEDA add-on enablement and a complete KEDA run remain outstanding. Record additional observations below after running them:

| Evidence | Observed result |
| --- | --- |
| Date, cluster/context, Kubernetes version | 2026-09-13; aks-training-overlay; 1.35.7 |
| HPA baseline, peak, and return to two | Two Ready baseline pods; four replicas at 296% / 50% CPU target; load stopped; automatic scale-in to two verified |
| Eviction at two Ready pods rejected by PDB | Verified through presenter: TooManyRequests / disruption-budget rejection |
| Eviction at three Ready pods accepted; replacement Ready | Verified through presenter: HTTP 201; Deployment recovery verified |
| Managed KEDA baseline, approval if changed, operator image | Disabled on 2026-09-13; not enabled; no operator image |
| Queue activation from zero, scale-out, drain, return to zero | Not run |
| Namespace removed; nodes Ready; final KEDA state | Namespace retained intentionally for presenter; two Ready web pods with HPA; no load Job or PDB; KEDA still disabled |

## References

- [Kubernetes HPA walkthrough and upstream sample](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/)
- [Kubernetes API-initiated eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/api-eviction/)
- [Kubernetes disruption budgets](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)
- [Azure CLI AKS update reference](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-update)
- [AKS managed KEDA overview](https://learn.microsoft.com/en-us/azure/aks/keda-about)
- [KEDA Redis Lists scaler](https://keda.sh/docs/2.20/scalers/redis-lists/)
- [KEDA ScaledObject reference](https://keda.sh/docs/2.20/reference/scaledobject-spec/)