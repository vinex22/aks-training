# HPA Classroom Load Console

The console runs on `aks-training-flat` in namespace `hpa-flat`. Open http://127.0.0.1:18082 while its localhost Service tunnel is running. The web page controls a real Kubernetes load Job and displays live PHP/Apache pods, HPA CPU utilization, desired replicas, a five-minute timeline, and Kubernetes scaling events.

## Classroom Workflow

1. Start with one Ready application pod, no active load, and a connected status. Metrics Server can take a few sampling cycles after deployment to provide CPU data.
2. Choose **2 load workers** and **3 minutes**, then select **Start load**. Each worker repeatedly requests `http://php-apache/` through the in-cluster Service. Workers increase request concurrency, not the number of application pods directly.
3. Compare CPU utilization with the **50%** target, then watch desired replicas increase and new pod tiles become Ready. The HPA bounds remain **1-10**. The console itself is not part of the HPA target.
4. Select **Stop load** to delete the `hpa-load` Job and its pod. If a run already finished, select **Clear run** before starting another. The action does not delete PHP/Apache, the HPA, or the console.
5. Watch CPU fall and the HPA scale back to one pod. Allow the **60-second** stabilization window plus metrics and reconciliation delays; scale-in is not instantaneous.

CPU percentage is relative to the application's **200m CPU request**, not total node capacity. For example, 178% means roughly 356m average CPU per measured application pod. Its CPU limit is 500m. The HPA's 50% target corresponds to approximately 100m per pod.

The controls support 1-8 workers and 30-300 seconds per run. Job execution has a deadline 30 seconds beyond the selected duration; completed Jobs expire after ten minutes. Closing the browser or losing the tunnel does not stop load, but the Job retains its deadline. The timeline is browser-local and resets on refresh; events are read from Kubernetes and can include historical metric warnings.

## Reconnect

Requires the authenticated `aks-training-flat` context. See [infra.md](../../infra.md#access) for credential setup on another machine. Run this in PowerShell and leave the terminal open:

```powershell
kubectl --context aks-training-flat -n hpa-flat get deployment/hpa-console
kubectl --context aks-training-flat -n hpa-flat port-forward service/hpa-console 18082:80 --address 127.0.0.1
```

Then open http://127.0.0.1:18082. This is the console's ClusterIP Service, not a public Azure endpoint. Use a different free local port if 18082 is occupied and update the browser URL accordingly. Restart the tunnel after a console rollout, cluster restart, or `lost connection to pod` error. The separate PHP sample at port 18081 is optional and has no dashboard.

## Implementation

- `server.mjs`: static assets, localhost Host checks, same-origin mutation checks, and short-lived status caching.
- `cluster.mjs`: TLS-verified Kubernetes API access with a projected ServiceAccount token, real HPA/pod/event reads, and a fixed BusyBox load Job definition.
- `public/`: responsive UI and canvas timeline. Lucide icons are served locally from the locked npm package; there are no browser CDN dependencies.
- [console.yaml](../../labs/hpa-flat/console.yaml): one console replica, ClusterIP Service, ServiceAccount, namespace Role/RoleBinding, and ingress-deny NetworkPolicy.
- `deploy.ps1`: tests, server-side validation, three ConfigMaps, and the console rollout. Existing application and HPA manifests are not reapplied.

No custom image was built or published. Deployment uses the digest-pinned public Node runtime already specified in the manifest and read-only ConfigMaps for the small application, UI, and Lucide bundle with its license. This avoids requiring flat-cluster ACR access. No registry permission or other Azure role was changed.

The runtime uses `--preserve-symlinks` and `--preserve-symlinks-main` because ConfigMap files are symlinks: resolving their timestamped backing paths would break entry-point detection and asset paths. DELETE requests include `Content-Length` so Kubernetes receives foreground propagation and UID preconditions; a real HTTP regression test covers this behavior.

## Test and Redeploy

Run from the repository root using PowerShell 7 with Node.js 22 or newer, npm, and kubectl. Install the pinned dependencies, run tests, then redeploy only after reviewing the intended cluster and namespace:

```powershell
npm --prefix apps/hpa-console ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm --prefix apps/hpa-console test
if ($LASTEXITCODE -ne 0) { throw 'Console tests failed.' }
& ./apps/hpa-console/deploy.ps1
```

The script uses `npm.cmd` on Windows to avoid a parsing issue in this machine's npm PowerShell wrapper. It uses server-side apply for generated ConfigMaps without storing credentials or generated bundles in Git. Existing console pods restart on redeployment, so reconnect the Service tunnel afterward. The Node image remains a training dependency, not a final-image security certification.

## Security Boundaries

- The ServiceAccount can list pods/events, get only the `php-apache` HPA, and get/delete only the named `hpa-load` Job. It has no deployment scaling, HPA mutation, pod exec, secret-reading, RBAC-management, or other-namespace permission.
- Kubernetes cannot restrict Job **creation** by resource name. The application enforces a fixed Job name, namespace, Service target, public BusyBox image, resource bounds, and worker/duration limits. A compromised console could create other Jobs in this namespace; this is a trusted instructor tool, not a multi-tenant sandbox.
- Load pods do not mount ServiceAccount tokens and run non-root with dropped capabilities and a read-only filesystem. The console runs non-root with a read-only filesystem and a bounded CPU/memory allocation.
- A NetworkPolicy denies ordinary inbound pod-network traffic to the console. Authorized kubelet port-forwarding remains usable. HTTP Host is restricted to localhost; mutations require a custom header and same-origin requests. Do not expose it with a public ingress/LoadBalancer or bind its tunnel to `0.0.0.0` without adding appropriate authentication and authorization.
- All connected browser sessions share the same load Job. The server rejects overlapping starts; an existing CLI-created `hpa-load` also blocks a new run. A successful Stop requests foreground deletion using the observed Job UID to avoid deleting a replacement with the same name.

## Emergency Stop and Cleanup

To stop traffic without the browser:

```powershell
kubectl --context aks-training-flat -n hpa-flat delete job hpa-load --ignore-not-found --cascade=foreground --wait=true --timeout=90s
kubectl --context aks-training-flat -n hpa-flat get pods -l app=hpa-load
```

The Load Job should leave no pod behind. To remove only the console after stopping any active run:

```powershell
kubectl --context aks-training-flat delete -f labs/hpa-flat/console.yaml --ignore-not-found
kubectl --context aks-training-flat -n hpa-flat delete configmap hpa-console-code hpa-console-ui hpa-console-icons --ignore-not-found
```

Full lab cleanup is documented in the [HPA lab guide](../../labs/hpa-flat/README.md#cleanup). Never delete the cluster or resource group to reset this demo.

## Verification

Verified on 2026-09-15:

- Five Node tests passed, including request bounds, same-origin/Host protection, asset serving, and real DELETE request framing. Console resources passed server-side admission and the repaired pod rollout succeeded.
- The live web UI started a two-worker load Job. CPU reached 178% versus the 50% HPA target; four PHP/Apache pods were observed Ready, with HPA events also recording a later desired count of eight. Request logs from both workers showed successful responses and zero failures in the inspected samples.
- Fixed an initial DELETE-body framing issue that orphaned a load pod; that completed test pod was explicitly removed. With the fix deployed, both clearing a completed run and stopping a running run removed the Job and its pod.
- Desktop (1440 x 1000) and mobile (390 x 844) screenshots were inspected. Icons and the nonblank chart rendered; checked controls, metrics, and pod tiles had no horizontal overflow. Rendered icons now remain stable between telemetry updates.
- Keyboard activation and the click handler were verified against the live API, including an HTTP 202 Stop/Clear response and removal of both Job and pod. Automated pointer clicks were inconclusive while the integrated browser reported `document.visibilityState=hidden`; no claim of a complete pointer-automation pass is made.
- Final live check: console 1/1 Ready, PHP/Apache 1/1 Ready, both with zero restarts; HPA one current / one desired replica at 0% CPU; no load Job or load pod remains. The Service tunnel at http://127.0.0.1:18082 serves live telemetry with `load.exists=false` and `phase=Idle`.
- No ACR image build, Azure role assignment, cluster resize, paid add-on, or overlay-cluster change was performed. Worktree changes remain uncommitted.