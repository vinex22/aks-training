# PodDisruptionBudget: Block a Drain

Target: `aks-training-flat`, namespace `pdb-lab`. Four lightweight BusyBox HTTP-server pods demonstrate eviction protection without generating CPU load or exposing a public Service. The server listens on port 8080 for TCP readiness; it is not a web application with page content.

## Expected Behavior

- Deployment `pdb-demo` has four replicas. Required hostname topology spreading uses `maxSkew: 1`, `minDomains: 2`, and `DoNotSchedule`. With the current two eligible Linux nodes and sufficient resources, four scheduled replicas are distributed 2+2. This is not hard-coded to VMSS node names; additional eligible nodes would change the distribution.
- PDB `pdb-demo` selects those pods and sets `minAvailable: 4` (an absolute pod count). Once all four pods are healthy, `currentHealthy=4`, `desiredHealthy=4`, and `disruptionsAllowed=0`.
- Cordon prevents new ordinary pods from scheduling on a node. It does not evict existing pods and is not blocked by a PDB.
- A normal drain uses the eviction API. Evicting even one of these four healthy pods would violate the PDB, so those evictions are rejected and the drain cannot finish.
- A PDB does not prevent direct pod deletion, Deployment scale-down/rollouts, node failure, or a drain using `--disable-eviction`. It is not a guarantee against every type of outage. Do not use those bypasses for this demonstration.
- Requiring every replica to remain available deliberately blocks maintenance; this is a teaching example, not a general production recommendation. Topology spreading controls placement, while the PDB controls permitted voluntary evictions.

## Deploy and Inspect

Run from the repository root in PowerShell with the authenticated training context. See [infra.md](../../infra.md) for the subscription and access details.

```powershell
kubectl --context aks-training-flat get nodes
kubectl --context aks-training-flat apply -f labs/pdb/namespace.yaml
kubectl --context aks-training-flat apply --dry-run=server -f labs/pdb/deployment.yaml
if ($LASTEXITCODE -ne 0) { throw 'PDB lab admission validation failed.' }
kubectl --context aks-training-flat apply -f labs/pdb/deployment.yaml
kubectl --context aks-training-flat -n pdb-lab rollout status deployment/pdb-demo --timeout=180s
kubectl --context aks-training-flat -n pdb-lab get pods -o wide
kubectl --context aks-training-flat -n pdb-lab get pdb pdb-demo
```

Proceed only when all four pods are Ready, two are on each node, and the PDB shows zero allowed disruptions. Insufficient eligible nodes/capacity or admission policies can prevent this baseline; do not resize the cluster automatically.

## Cordon and Drain Demonstration

The following is a real node operation. Run it only when ready to demonstrate the brief scheduling impact on this shared cluster. The pod selector restricts eviction attempts to this lab; an unfiltered drain could evict unrelated HPA, QoS, or system workloads before getting blocked by this PDB.

```powershell
$Context = 'aks-training-flat'
$Pods = kubectl --context $Context -n pdb-lab get pods -l app=pdb-demo -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Unable to read demo pods.' }
$Ready = @($Pods.items | Where-Object {
    -not $_.metadata.deletionTimestamp -and
    ($_.status.conditions | Where-Object { $_.type -eq 'Ready' -and $_.status -eq 'True' })
})
$Groups = @($Ready | Group-Object { $_.spec.nodeName })
if ($Ready.Count -ne 4 -or $Groups.Count -ne 2 -or @($Groups | Where-Object Count -ne 2).Count) {
    throw 'Expected four Ready pods distributed 2+2 before draining.'
}
$Budget = kubectl --context $Context -n pdb-lab get pdb pdb-demo -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $Budget.status.currentHealthy -ne 4 -or $Budget.status.disruptionsAllowed -ne 0) {
    throw 'Wait for the PDB to report four healthy pods and zero disruptions allowed.'
}
$Node = $Groups[0].Name
$NodeState = kubectl --context $Context get node $Node -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Unable to read node state.' }
if ($NodeState.spec.unschedulable) { throw 'Node was already cordoned; do not change another operator''s state.' }

try {
    Write-Host "Cordoning $Node; existing pods remain running."
    kubectl --context $Context cordon $Node
    if ($LASTEXITCODE -ne 0) { throw 'Cordon failed.' }
    Write-Host 'Attempting a lab-only drain. PDB rejection and timeout are expected.'
    kubectl --context $Context drain $Node --ignore-daemonsets --pod-selector=app.kubernetes.io/part-of=aks-training-pdb --timeout=30s
    if ($LASTEXITCODE -eq 0) { throw 'Unexpected drain success: inspect the PDB and pod health.' }
    Write-Host 'Inspect drain output for a rejection stating that eviction would violate the disruption budget.'
    kubectl --context $Context -n pdb-lab get pods -o wide
    kubectl --context $Context -n pdb-lab get pdb pdb-demo
} finally {
    Write-Host "Restoring scheduling on $Node"
    kubectl --context $Context uncordon $Node
    if ($LASTEXITCODE -ne 0) { Write-Warning "Uncordon failed. Restore node $Node manually." }
}
```

A nonzero drain exit alone is not proof of PDB protection: confirm its error specifically names the disruption budget. If the terminal is terminated before cleanup runs, explicitly uncordon the selected node. Check that all four pod identities remain unchanged and both nodes are schedulable afterward.

## Cleanup

After restoring any cordoned node, remove only this lab when requested:

```powershell
kubectl --context aks-training-flat delete namespace pdb-lab --wait=true --timeout=180s
```

Namespace deletion intentionally removes the workloads; a PDB does not block that cleanup. Leave the existing HPA/QoS labs, AKS clusters, node pools, and ACR intact.

## Verification

Verified live on 2026-09-15 on `aks-training-flat`:

- Namespace, Deployment, and PDB passed client/schema validation; Deployment and PDB passed server-side admission validation and were deployed.
- Four pods became Running and Ready with zero restarts. Two were scheduled on `aks-systempool-21374336-vmss000004` and two on `aks-systempool-21374336-vmss000005`.
- PDB status reported four healthy pods, four required healthy pods, and zero allowed disruptions.
- A `policy/v1` eviction submitted with `dryRun=All` was rejected with `TooManyRequests`: `Cannot evict pod as it would violate the pod's disruption budget.` No pod was removed.
- The real cordon/drain walkthrough above has not been executed. Neither node was cordoned or drained for this verification; the HPA and QoS labs were not modified.
- All four pods and the PDB remain deployed for the classroom exercise. No cluster resizing, add-on, Azure role, or ACR changes were made. Files remain uncommitted.