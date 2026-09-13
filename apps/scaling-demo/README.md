# AKS Scaling Presenter and Demo Images

The presenter is deployed on `aks-training-overlay` in `scaling-lab`. Open [the local presenter](http://127.0.0.1:18080) while its port-forward is running. This is the AKS-hosted application, not a local mock.

Verified on 2026-09-13: browser command execution, mutation confirmation, desktop/mobile layout, HPA scaling from two to four and back to two, PDB rejection at two healthy pods, accepted eviction at three, and replacement recovery. The final baseline keeps the presenter, two web pods, and HPA running with no load Job or test PDB. KEDA and Redis/worker end-to-end execution remain pending; worker lifecycle logic passed the source and image-build tests.

## Browser workflow

1. Select HPA, Disruption Budgets, KEDA, or Diagnostics.
2. Select a step. Read its actual command, explanation, and expected observation.
3. For a change, check the confirmation box and select **Run Command**.
4. Read the streamed stdout/stderr in the terminal. A watch runs for at most 45 seconds; **Stop** stops the command, not changes already applied.

The terminal executes a reviewed command catalog, not arbitrary typed shell input. Only one action runs at a time across browser sessions. A rejected PDB eviction is an expected nonzero command result, explained alongside the terminal.

HPA starts with two pods, targets 50% of a 100m CPU request, and caps at four. The load Job runs for 120 seconds with a 180-second Kubernetes deadline and reports request counts by serving pod. Allow new pods a few metrics collection cycles before expecting HPA decisions.

KEDA still requires separate cluster-owner approval and managed add-on enablement from the [lab guide](../../labs/01-scaling/README.md). The presenter cannot install add-ons or grant permissions. Without the KEDA CRD, **Apply queue scaler** reports the real Kubernetes error.

## Images

All four Linux AMD64 images are published in Basic ACR `akstraining555a1e03.azurecr.io`, using the `1.0.0` tag. Each remote build runs the ten Node tests. Node is pinned to `24.21.0-alpine3.24` by digest and Alpine packages are updated during the build.

| Repository | Purpose | Published digest |
| --- | --- | --- |
| `scaling/web` | CPU work API, pod/node identity, independent health/readiness endpoints | `sha256:ef5b51f402ef34f4d0d0cb09924ecde3ac7f35d51675c1ebb48eaab968cc8ed3` |
| `scaling/load` | Bounded concurrent requests, fresh connections, per-pod distribution logs | `sha256:2e46b460feec142a2dae867c65e7c6fd224ba6412980a597fa214e1f53723a51` |
| `scaling/worker` | Redis queue worker and queue seeding/status utility | `sha256:ece43eda715fb4e234ab1c17bedc837644784fa72752d8abb824ebff5f2328a1` |
| `scaling/presenter` | Browser terminal, command explanations, bounded kubectl runner | `sha256:bcfc58dd212acf52afa46f9ff17aba398bed709b067cd40049ba568ea6fa9a2b` |

The web image exposes `GET /status`, `GET /healthz`, `GET /readyz`, and `POST /work` on port 8080. Work is deliberately CPU-intensive but bounded; do not expose it publicly. Every work response and completion log includes the pod identity. The lab Service uses port 80 and forwards to container port 8080.

The worker atomically moves jobs from `jobs` to `processing` using Redis `BLMOVE`, simulates two seconds of work, then removes the processing entry and increments `completed` in a transaction. On SIGTERM it finishes the in-flight job before exiting. A hard crash can leave an entry in `processing`; there is no automatic recovery/requeue mechanism. Redis remains disposable with no persistence, TLS, or authentication, so this is not a production delivery guarantee. Use unique job IDs and synthetic data only.

## Access and security

- ACR admin credentials are disabled. The overlay kubelet identity has `AcrPull` scoped to this registry only.
- The presenter uses a dedicated Kubernetes ServiceAccount and a namespace Role. It has no permission to read secrets, execute inside pods, change RBAC, access other namespaces, drain nodes, or enable Azure add-ons.
- Kubernetes `create` permissions cannot be restricted with `resourceNames`; the server's fixed catalog restricts creation to the reviewed lab manifests. Patch/update/delete permissions are additionally restricted to named lab resources where possible. This is a trusted training tool, not a multi-tenant sandbox.
- The ConfigMap contains only an in-cluster connection template pointing at the projected service-account token file. It contains no credentials or machine-local kubeconfig.
- The Service is ClusterIP. A deny-ingress NetworkPolicy blocks ordinary pod-network access; the authorized kubelet port-forward remains usable. HTTP Host is restricted to localhost, mutation requests require a custom header, cross-origin execution is rejected, and output is bounded and stripped of terminal control sequences.
- There is no public ingress or end-user authentication layer. Do not bind the port-forward to `0.0.0.0`, add a LoadBalancer, or publish the presenter without designing authentication and authorization first.
- The editor's base-image scanner still reports 2 critical / 11 high findings for the pinned base. Updating OS packages and using the current Node release does not establish a clean scan of final artifacts. These images are training-only and require final-image vulnerability review before production use. The editor also flags multiple CMD instructions despite separate Docker build stages; all four ACR builds succeeded with the intended stage-specific CMD.

## Reconnect

Use PowerShell 7 from the repository root. Azure CLI must be logged into the training tenant and subscription from [infra.md](../../infra.md). Do not use local admin credentials to bypass access errors.

```powershell
$Subscription = '555a1e03-73fb-4f88-9296-59bd703d16f3'
$Context = 'aks-training-overlay'
$Kubeconfig = Join-Path ([IO.Path]::GetTempPath()) 'aks-training-presenter.kubeconfig'
az aks get-credentials --resource-group aks-training --name $Context --subscription $Subscription --file $Kubeconfig --format exec
if ($LASTEXITCODE -ne 0) { throw 'Unable to retrieve user credentials.' }
kubelogin convert-kubeconfig -l azurecli --kubeconfig $Kubeconfig
if ($LASTEXITCODE -ne 0) { throw 'Unable to configure Azure CLI authentication.' }
kubectl --kubeconfig $Kubeconfig --context $Context -n scaling-lab get pods
kubectl --kubeconfig $Kubeconfig --context $Context -n scaling-lab port-forward service/scaling-presenter 18080:80 --address 127.0.0.1
```

Keep the final command running while using http://127.0.0.1:18080. Stop it with Ctrl+C. Port-forwarding does not create a public endpoint or change the current context in your default kubeconfig.

## Rebuild

Run from the repository root. Use a new release tag and update the manifests together; the presenter image embeds those manifests, so rebuild it after any lab manifest changes. Its embedded paths are `/app/labs`; they are not paths on your laptop.

```powershell
npm --prefix apps/scaling-demo ci
npm --prefix apps/scaling-demo test
if ($LASTEXITCODE -ne 0) { throw 'Source tests failed.' }
$Registry = 'akstraining555a1e03'
$Subscription = '555a1e03-73fb-4f88-9296-59bd703d16f3'
$Version = '1.0.1'
foreach ($Image in @('web', 'load', 'worker', 'presenter')) {
    Write-Host "Building scaling/${Image}:$Version for Linux AMD64"
    az acr build --registry $Registry --subscription $Subscription --image "scaling/${Image}:$Version" --target $Image --platform linux/amd64 --file apps/scaling-demo/Dockerfile .
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $Image" }
}
```

These commands build/push only; they do not update running pods. The root Docker ignore file constrains Docker's build context. ACR CLI archives the repository before the Docker build, so keep credentials outside the repository even when ignored by Docker.

## Deploy again

The current deployment already exists. Do not reapply workload baselines while HPA or KEDA is actively managing replicas. To deploy the presenter after reviewing namespace ownership and verifying images/access:

```powershell
kubectl --kubeconfig $Kubeconfig --context $Context get namespace scaling-lab --show-labels
kubectl --kubeconfig $Kubeconfig --context $Context -n scaling-lab apply --dry-run=server -f labs/01-scaling/presenter.yaml
if ($LASTEXITCODE -ne 0) { throw 'Presenter server validation failed.' }
kubectl --kubeconfig $Kubeconfig --context $Context -n scaling-lab apply -f labs/01-scaling/presenter.yaml
if ($LASTEXITCODE -ne 0) { throw 'Presenter deployment failed.' }
kubectl --kubeconfig $Kubeconfig --context $Context -n scaling-lab rollout status deployment/scaling-presenter --timeout=180s
```

A new environment also needs the namespace manifest before the server dry-run. Creating the namespace and presenter Role/RoleBinding requires an authorized administrator. The browser presenter itself does not have that permission.

## Cleanup

Use the [lab cleanup](../../labs/01-scaling/README.md#cleanup-and-reset) after confirming ownership. Deleting `scaling-lab` also removes the presenter and disconnects its browser session. It does not delete ACR, images, Azure role assignments, or clusters. Those are retained intentionally; deleting them requires separate approval.

## References

- [AKS and ACR integration](https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration)
- [ACR remote builds](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tutorial-quick-task)
- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [xterm.js](https://xtermjs.org/)
- [Node Redis](https://github.com/redis/node-redis)