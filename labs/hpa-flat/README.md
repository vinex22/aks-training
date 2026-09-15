# HPA Demo on the Flat Cluster

An adaptation of [Jeason Joseph's HPA walkthrough](https://medium.com/@kjjeason/horizontal-pod-autoscaling-hpa-scaling-your-kubernetes-applications-efficiently-77ec2ed3b506), using the existing `aks-training-flat` cluster. Do not create a cluster or follow the article's resource-group deletion step.

## Configuration

- Namespace: `hpa-flat`; Deployment, Service, and HPA: `php-apache`.
- Public Kubernetes sample image: `registry.k8s.io/hpa-example:latest`. No ACR image build is required.
- CPU request: 200m per pod; limit: 500m. HPA targets 50% of the request, equivalent to 100m average CPU per pod, not 50% of a node.
- Replica range: 1-10, matching the article. A TCP readiness probe avoids generating CPU work from HTTP health checks.
- Demo adaptations: memory bounds, namespace isolation, a five-minute load Job with a 330-second deadline, and a 60-second scale-down stabilization window instead of the usual five-minute default.
- Service: ClusterIP, port 80. No public IP, ingress, paid add-on, cluster resizing, or Azure role changes.
- This is an intentionally CPU-intensive sample, not a production-hardened application. The upstream sample uses a mutable image tag and its existing Apache runtime permissions. Do not expose it publicly or use it for sensitive data.

## Classroom Web Console

The [load console](../../apps/hpa-console/README.md) is deployed alongside the sample in `hpa-flat`. It provides Start/Stop, 1-8 load workers, a bounded duration, live HPA CPU/replica metrics, pod tiles, and scaling events.

```powershell
kubectl --context aks-training-flat -n hpa-flat port-forward service/hpa-console 18082:80 --address 127.0.0.1
```

Open http://127.0.0.1:18082 and use **2 workers / 3 minutes** for a classroom run. Select **Stop load** to end traffic; use **Clear run** if it has already completed. Wait for CPU to fall and HPA to scale in. This creates/deletes the same named `hpa-load` Job as the CLI exercise, so do not run both methods at once.

The console uses a public Node runtime and ConfigMap-mounted files, not a new ACR image. Its [deployment and access guide](../../apps/hpa-console/README.md) includes the namespace permission boundaries, tests, and reconnect steps. The basic PHP Service at port 18081 still returns only `OK!`.

## Deploy

Run PowerShell from the repository root. Azure CLI must be authenticated to the subscription and tenant in [infra.md](../../infra.md). Existing user credentials and Azure CLI-mode `kubelogin` are required.

```powershell
$Context = 'aks-training-flat'
$Namespace = 'hpa-flat'
kubectl --context $Context get nodes
kubectl --context $Context top nodes
kubectl --context $Context apply -f labs/hpa-flat/namespace.yaml
kubectl --context $Context apply --dry-run=server -f labs/hpa-flat/application.yaml -f labs/hpa-flat/hpa.yaml -f labs/hpa-flat/load.yaml
if ($LASTEXITCODE -ne 0) { throw 'Manifest validation failed.' }
kubectl --context $Context apply -f labs/hpa-flat/application.yaml -f labs/hpa-flat/hpa.yaml
if ($LASTEXITCODE -ne 0) { throw 'Deployment failed.' }
kubectl --context $Context -n $Namespace rollout status deployment/php-apache --timeout=180s
kubectl --context $Context -n $Namespace get hpa,pods
```

The application manifest omits `spec.replicas` so reapplying it does not fight the HPA. Initial creation defaults to one replica. HPA metrics may initially be unknown until Metrics Server samples the new pod.

## Access the Service

```powershell
kubectl --context aks-training-flat -n hpa-flat port-forward service/php-apache 18081:80 --address 127.0.0.1
```

While the tunnel is running, open http://127.0.0.1:18081. The page displays `OK!`, not a dashboard. Each HTTP request performs CPU work. A port-forward targets one selected pod; the load Job below connects to the ClusterIP Service inside the cluster, allowing traffic to reach new replicas. Restart the tunnel if its selected pod is removed.

## Generate Load and Watch

In one terminal:

```powershell
kubectl --context aks-training-flat -n hpa-flat get hpa php-apache --watch
```

In another terminal:

```powershell
kubectl --context aks-training-flat apply -f labs/hpa-flat/load.yaml
kubectl --context aks-training-flat -n hpa-flat logs -f job/hpa-load --pod-running-timeout=120s
```

Inspect replicas and CPU in a third terminal:

```powershell
kubectl --context aks-training-flat -n hpa-flat get pods -l app=php-apache -o wide
kubectl --context aks-training-flat -n hpa-flat top pods
kubectl --context aks-training-flat -n hpa-flat describe hpa php-apache
```

Expect CPU utilization to exceed 50%, followed by additional replicas. The exact count and timing depend on load, metrics sampling, and available capacity; reaching ten is not required to demonstrate HPA. Replica count is controlled by the HPA, not the load Job.

## Stop and Observe Scale-In

The Job stops automatically after five minutes. To stop it sooner:

```powershell
kubectl --context aks-training-flat -n hpa-flat delete job hpa-load --ignore-not-found
kubectl --context aks-training-flat -n hpa-flat get hpa php-apache --watch
```

After CPU falls, allow the 60-second stabilization window plus metrics/controller delays for scale-in to one pod. Stopping `kubectl logs` or a watch with Ctrl+C does not stop the Job. Delete the previous Job before applying its manifest again for a new run.

## Cleanup

Only when finished with this demo:

```powershell
kubectl --context aks-training-flat delete namespace hpa-flat --wait=true --timeout=180s
```

This removes the demo, not the cluster, its system components, the resource group, or ACR. Keep the overlay cluster unchanged.

## Verification Record

The following records the CLI walkthrough verified on 2026-09-15 against `aks-training-flat`, before the web console was added. For the subsequent console run and its final idle baseline, see the [console verification record](../../apps/hpa-console/README.md#verification).

- All five resources passed client/schema validation; app, Service, HPA, and load Job passed server-side dry-run admission.
- Both cluster nodes were Ready and Metrics Server returned node CPU/memory readings before deployment.
- Initial deployment: one Ready PHP/Apache pod. The localhost Service tunnel returned HTTP 200 with `OK!` before and after the exercise.
- Under load, observed two Ready application pods and CPU utilization of 78% against the 50% target. Load logs showed at least 700 successful requests and zero failures.
- HPA `SuccessfulRescale` events recorded new replica sizes of 2, then 4, then 1. Four was a recorded HPA scaling decision; the two-Ready-pod snapshot was the direct under-load readiness observation.
- Deleted the load Job early after proving scale-out, then waited for scale-in. Final Deployment: one Ready pod, zero restarts. HPA: one current / one desired replica, CPU about 0% (1m), `ScalingActive=True` and `AbleToScale=True`.
- Initial missing-metric warnings resolved after metrics sampling. At idle, `ScalingLimited=True / TooFewReplicas` means the calculated demand is below the configured minimum of one; it is not a failure.
- Final deployed resources: namespace, Deployment, ClusterIP Service, and HPA. No load Job remains. The localhost tunnel must stay running for browser access and may need restarting after pod replacement.
- No cluster, node-pool, add-on, ACR, or Azure role changes were made. Source and documentation changes are local and uncommitted.