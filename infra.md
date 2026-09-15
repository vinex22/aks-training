# AKS Training Infrastructure

## Deployment

- Resource group: `aks-training`
- Region: Central India (`centralindia`)
- Subscription: `ME-MngEnvMCAP497026-vinayjain-1`
- Subscription ID: `555a1e03-73fb-4f88-9296-59bd703d16f3`
- Tenant ID: `45b68ab1-2c84-414f-918d-e945e189121d`
- Requested on: 2026-09-13
- Status: Provisioned and verified on 2026-09-13. Both clusters report `Succeeded` and `Running`.
- [Open resource group in Azure Portal](https://portal.azure.com/#@45b68ab1-2c84-414f-918d-e945e189121d/resource/subscriptions/555a1e03-73fb-4f88-9296-59bd703d16f3/resourceGroups/aks-training/overview)

## Clusters

| Name | Purpose | Pod Networking | Node Resource Group |
| --- | --- | --- | --- |
| `aks-training-overlay` | Main training labs | Azure CNI Overlay | `aks-training-overlay-nodes` |
| `aks-training-flat` | Networking comparison and subsequent break/fix labs | Azure CNI Pod Subnet, dynamic IP allocation | `aks-training-flat-nodes` |

Both AKS resources belong to `aks-training`. AKS-managed VMs, disks, load balancers, and public IPs live in the separate node resource groups above.

## Shared Configuration

- Kubernetes: `1.35.7`.
- Cluster SKU: Base, Free pricing tier (no financially backed API server SLA).
- Initial system pool: `systempool`, 2 x `Standard_D2s_v5` nodes per cluster, Azure Linux.
- OS disks: 64 GiB managed disks per node; observed OS: Azure Linux 3.0.
- Network data plane: Cilium; outbound connectivity: Standard Load Balancer.
- Authentication: Microsoft Entra ID with Azure RBAC; local accounts disabled.
- Public API endpoints; authorization is required. No private endpoint connectivity is configured.
- Managed identities, OIDC issuer, and workload identity enabled.
- No local SSH keys are created or uploaded.
- SSH was not explicitly disabled at the node-pool level; nodes have no public IPs.
- Kubernetes version auto-upgrades are not configured; node OS upgrade channel is `NodeImage`.
- Node autoscaling and KEDA are not enabled initially.
- Paid monitoring, gateways, and service mesh are not enabled initially; configure them during the relevant labs.
- Training-only sizing: the initial system pool also runs lab workloads. Add separate user pools and suitable resilience before production use.

## Networks and Identities

| Cluster | VNet | Node Subnet | Pod Range | Service CIDR | Control Plane Identity |
| --- | --- | --- | --- | --- | --- |
| `aks-training-overlay` | `vnet-aks-training-overlay` (`10.80.0.0/16`) | `nodes` (`10.80.0.0/24`) | Overlay: `10.240.0.0/16` | `10.250.0.0/24` | `id-aks-training-overlay` |
| `aks-training-flat` | `vnet-aks-training-flat` (`10.81.0.0/16`) | `nodes` (`10.81.0.0/24`) | VNet subnet `pods`: `10.81.16.0/20` | `10.251.0.0/24` | `id-aks-training-flat` |

Each control plane identity receives Network Contributor on its own VNet. The VNets are not peered initially.

## Verification

| Cluster | Provisioning | Power | Nodes | System Pods |
| --- | --- | --- | --- | --- |
| `aks-training-overlay` | Succeeded | Running | 2/2 Ready | All Running, all containers ready |
| `aks-training-flat` | Succeeded | Running | 2/2 Ready | All Running, all containers ready |

Verified using Azure resource inspection and authenticated `kubectl get nodes` / `kubectl get pods -n kube-system`. Workload identity webhook pods showed two historical startup restarts per pod but were ready at verification. Application traffic and training-specific add-ons have not been tested.

## Access

The deploying user `vinayjain_microsoft.com#EXT#@MngEnvMCAP497026.onmicrosoft.com` has `Azure Kubernetes Service RBAC Cluster Admin` on each cluster individually. No subscription-wide role was added.

The validation used temporary kubeconfigs outside the repository and did not change existing default Kubernetes contexts. To add the clusters to your normal kubeconfig, run:

```powershell
az aks get-credentials --resource-group aks-training --name aks-training-overlay --subscription 555a1e03-73fb-4f88-9296-59bd703d16f3 --format exec
az aks get-credentials --resource-group aks-training --name aks-training-flat --subscription 555a1e03-73fb-4f88-9296-59bd703d16f3 --format exec
kubelogin convert-kubeconfig -l azurecli
kubectl --context aks-training-overlay get nodes
kubectl --context aks-training-flat get nodes
```

Requires Azure CLI authentication in the subscription above, `kubectl`, and `kubelogin`. The explicit conversion avoids device-login prompts. Adding credentials selects the last cluster as the current context; use explicit `--context` arguments for lab commands.

## Container Registry

Created and verified on 2026-09-13 for the scaling demo images:

- Name: `akstraining555a1e03`.
- Login server: `akstraining555a1e03.azurecr.io`.
- Resource group / region: `aks-training` / `centralindia`.
- SKU: Basic; provisioning state: `Succeeded`.
- Admin account: disabled. Authentication uses Microsoft Entra ID; registry permissions use classic Azure RBAC.
- Public network endpoint enabled; anonymous pull is not enabled. No private endpoint was created.
- Published Linux AMD64 images: `scaling/web:1.0.0`, `scaling/load:1.0.0`, `scaling/worker:1.0.0`, and `scaling/presenter:1.0.0`. [Archived digests and build instructions](https://github.com/vinex22/aks-training/blob/6ae5ed495d9fc089d43548e2aaab823a39e0db99/apps/scaling-demo/README.md#images) remain in GitHub history. No registry images were changed or deleted during the 2026-09-15 lab cleanup.
- Overlay kubelet managed identity `731bbde5-866d-4712-8195-9d45a033ead3` has registry-scoped `AcrPull`. Role assignment: `7aa5f362-6cb0-4e98-a89c-ea91a54f8d81`. Presenter, web, and load image pulls succeeded on AKS.

## Scaling Presenter

- Current status: removed on 2026-09-15 along with the entire overlay `scaling-lab` namespace, including its app controllers, pods, Services, HPA, configuration, and namespace RBAC. The following deployment details are historical; the presenter is no longer accessible.
- Deployed on 2026-09-13 to `aks-training-overlay`, namespace `scaling-lab`.
- Deployment / Service / ServiceAccount: `scaling-presenter`; one replica, ClusterIP Service port 80 to container port 8080.
- Namespace Role/RoleBinding allows only the reviewed lab resource types; no cluster role, secret access, or pod exec permission is granted to the application.
- Browser access: http://127.0.0.1:18080 through a localhost-only `kubectl port-forward`. No public ingress or LoadBalancer was created.
- The current user object `fdf1faee-f73a-490f-a783-92587421b77c` was granted **Azure Kubernetes Service RBAC Cluster Admin** on the overlay cluster only, with explicit user approval after an initial Forbidden error. Role assignment: `778ac78e-a6dd-4588-a2ef-7ecb74e87b3e`. No subscription-wide role or flat-cluster assignment was added.
- Both nodes were Ready during deployment. Presenter UI, read-only commands, web/HPA deployment, load generation, HPA scale-out to four and scale-in to two, and both PDB eviction cases were verified. KEDA remains disabled; no cluster add-ons were enabled.
- Final lab state on 2026-09-13: one Ready presenter pod, two Ready web pods, HPA enabled, no load Job, and the test PDB removed. Redis and queue workers have not been deployed; their KEDA exercise remains pending.
- Historical operating instructions: [archived presenter guide](https://github.com/vinex22/aks-training/blob/6ae5ed495d9fc089d43548e2aaab823a39e0db99/apps/scaling-demo/README.md).

## Flat Cluster HPA Demo - 2026-09-15

- Cluster / namespace: `aks-training-flat` / `hpa-flat`.
- Deployment, ClusterIP Service, and HPA: `php-apache`; image: `registry.k8s.io/hpa-example:latest`.
- CPU request / limit: 200m / 500m per pod; HPA target: 50%; replica bounds: 1-10; scale-down stabilization: 60 seconds.
- Load Job: `hpa-load`, HTTP traffic through `http://php-apache/`, bounded to five minutes with a 330-second deadline.
- Access: http://127.0.0.1:18081 through localhost-only Service port-forwarding. Verified HTTP 200 and `OK!` before and after the exercise.
- Verified HPA rescale events: 1 -> 2 -> 4 -> 1. Under-load snapshot: two Ready pods, 78% CPU against the 50% target, and at least 700 successful HTTP requests with no failures. Final state: one Ready application pod, HPA one current / one desired replica, about 0% CPU. Load Job removed; app, Service, and HPA remain deployed. Initial missing-metric warnings resolved.
- No new cluster, node pool, registry image, public IP, ingress, Azure role, or paid add-on was created for this demo. Both AKS resources and ACR were retained.
- KEDA and Defender workloads were observed in both clusters' system namespaces and preserved. This supersedes initial notes about disabled add-ons; no add-on configuration was changed here.
- Manifests, replay commands, verification, and namespace-only cleanup: [flat HPA lab](labs/hpa-flat/README.md).

## Classroom Load Console - 2026-09-15

- Cluster / namespace: `aks-training-flat` / `hpa-flat`; Deployment, Service, ServiceAccount, Role, and RoleBinding: `hpa-console`; one console replica.
- Browser: http://127.0.0.1:18082 with localhost-only port-forwarding of `service/hpa-console` port 80 to container port 8080. No public endpoint was created.
- Runtime: public `node:24.21.0-alpine3.24` image pinned by digest in [console.yaml](labs/hpa-flat/console.yaml), with read-only `hpa-console-code`, `hpa-console-ui`, and `hpa-console-icons` ConfigMaps. No custom ACR image or new registry access assignment.
- Read permissions: namespaced pods/events, named PHP/Apache HPA, and named load Job. Mutation: create a fixed, bounded `hpa-load` Job or delete it with foreground propagation and UID preconditions. Kubernetes Job creation cannot itself be name-restricted by RBAC; this remains a trusted instructor-only tool.
- UI: Start/Stop, 1-8 workers, 30-300 seconds per run, live CPU relative to the 200m request, Ready/desired replicas, a five-minute chart, pod details, and HPA events. `hpa-console-local-access` denies ordinary inbound pod traffic; use the authorized localhost tunnel.
- Verified Start generated real traffic and HPA scale-out; observed 178% CPU and four Ready app pods. Five source tests pass, desktop/mobile rendering was checked, and corrected Stop/Clear removed the named load Job and its pod. Deployment and replay steps: [console guide](apps/hpa-console/README.md).
- Final check on 2026-09-15: console 1/1 Ready and PHP/Apache 1/1 Ready, both with zero restarts; HPA one current / one desired replica at 0% CPU. No load Job/pod remained, and the console Service URL returned live idle telemetry.
- Both clusters, ACR, existing images, Azure roles, add-ons, and PHP/Apache HPA configuration were left unchanged by console deployment.

## QoS Lab - 2026-09-15

- Cluster / namespace: `aks-training-flat` / `qos-lab`. Namespace and all three Deployments were applied after server-side dry-run validation.
- [BestEffort](labs/qos/best-effort.yaml): `qos-best-effort`, no CPU/memory requests or limits; verified one Running/Ready pod with `BestEffort` QoS.
- [Burstable](labs/qos/burstable.yaml): `qos-burstable`, requests 10m CPU / 8Mi memory, limits 100m CPU / 32Mi memory; verified one Running/Ready pod with `Burstable` QoS.
- [Oversized Guaranteed](labs/qos/guaranteed-unschedulable.yaml): `qos-guaranteed-unschedulable`, requests equal limits at 16 CPU / 64Gi memory; verified `Guaranteed` QoS and Pending with `PodScheduled=False`. Scheduler event: `0/2 nodes are available: 2 Insufficient cpu, 2 Insufficient memory`.
- Pending is intentional: scheduling uses requests and requires one node with sufficient allocatable resources. Guaranteed QoS does not guarantee scheduling. Do not resize nodes to make this example run.
- The HPA lab, clusters, add-ons, Azure roles, and ACR were not modified. No commit or push was performed.

## PDB Lab - 2026-09-15

- Cluster / namespace: `aks-training-flat` / `pdb-lab`; Deployment and PDB: `pdb-demo`.
- Four BusyBox HTTP-server pods with TCP readiness; each requests 10m CPU / 8Mi memory and limits 100m CPU / 32Mi memory. No Service or public endpoint is needed.
- Required hostname topology spread (`maxSkew: 1`, `minDomains: 2`, `DoNotSchedule`); verified two Ready pods per node, four total, zero restarts.
- PDB `minAvailable: 4`; verified four healthy pods and zero allowed disruptions. Server-side dry-run eviction returned `TooManyRequests` because it would violate the disruption budget.
- All lab resources remain deployed. No node was cordoned/drained and no actual pod eviction was attempted. Existing HPA/QoS labs, cluster infrastructure, add-ons, ACR, and Azure roles were not changed.
- [PDB lab guide](labs/pdb/README.md) includes a selector-scoped cordon/drain demonstration with uncordon cleanup. A regular unfiltered drain can affect unrelated workloads even while this PDB blocks its own pods.

## KEDA Private Deployment - 2026-09-15

- Active workloads: namespace `keda-lab` on `aks-training-flat`; console `keda-console`, consumer `azure-queue-processor`, ScaledObject `azure-queue-scaler`, generated HPA `azure-queue-processor-hpa` (0-6 consumers, queue target 10). Console Service port 80 -> 8080; localhost tunnel http://127.0.0.1:18084.
- Runtime uses the digest-pinned public Node image with source/UI ConfigMaps and a locked npm init container. Node SDK consumer replaces the upstream Go image template. Optional old generator Job is not deployed. No ACR changes are required.
- Managed identities in `aks-training`: console client `12effe31-84d0-4dfe-85fe-0b3533d43b76`, principal `82e2ec43-b168-4692-a19d-f21184982364`; processor client `6c941ddf-3965-48b5-963f-8f5a5ffdb1a4`, principal `45b6e16c-2e8d-424c-84a1-b74dd45da3e5`; scaler client `e93870dd-f12d-490a-82b4-a76d5b28cf43`, principal `32da9358-55f9-45af-9862-e5078c17a12a`.
- Console identity has Storage Queue Data Message Sender and Storage Queue Data Reader; processor has Storage Queue Data Message Processor; scaler has Storage Queue Data Reader. All four assignments target only `stakskeda555a1e03/queueServices/default/queues/keda-demo`. Federation subjects and role IDs: [deployed guide](labs/keda/DEPLOYED.md).
- Live verification: two batches each sent 30/30 messages with zero failures, KEDA became Active and requested three consumers, processor logs confirmed deletion, and both runs returned to zero after queue drain. Pod-list telemetry was corrected and verified in the UI. Final state: console 1/1 Ready with zero restarts, processor 0/0, queue depth 0 with no access error, ScaledObject Ready=True/Active=False, no generator Jobs. 11 source tests and desktop/mobile rendering checks passed.
- No human-user queue roles, kubelet roles, policy exemption, public storage access, cluster resizing, or changes to other lab workloads were introduced. Private endpoint and DNS are retained as below.

## Historical KEDA Local Prototype

- Created StorageV2 account `stakskeda555a1e03`, Standard LRS, Central India, resource group `aks-training`, subscription `555a1e03-73fb-4f88-9296-59bd703d16f3`; provisioning succeeded.
- Created Azure Queue `keda-demo` via the management plane. Queue endpoint: `https://stakskeda555a1e03.queue.core.windows.net/keda-demo`.
- HTTPS-only, TLS 1.2 minimum, no shared-key access, no anonymous blob access. Public network access remains Disabled. A queue private endpoint was subsequently created as recorded below.
- Governance policy `StorageAccount_PublicNetwork_Modify` under management-group assignment `MCAPSGovDeployPolicies` was observed modifying public-network settings on create/update. A user-approved exemption request failed with `LinkedAuthorizationFailed` because the current identity lacks assignment-level `exempt/action` permission. No exemption was created; the user chose Private Link instead.
- Current console user `ce7d64a9-7c39-42fb-b260-125bd7fe5800` has management-plane Owner roles but no observed queue data roles. Queue sender/reader role approval was not confirmed and no new Azure role was assigned. Live SDK queue properties returned `AuthorizationFailure`.
- The [KEDA console](apps/keda-console/README.md) runs locally at http://127.0.0.1:18083 using Azure CLI identity. It shows queue/processor setup blockers and disables enqueue until queue access succeeds. No messages are confirmed sent. It has not been deployed to AKS; the KEDA processor/scaler manifests remain undeployed.
- Required follow-up: put the console on an approved network path to the private endpoint and configure queue-scoped data roles, followed by authenticated data-plane testing. Existing HPA, QoS, and PDB workloads were left unchanged.

## Queue Private Endpoint - 2026-09-15

- Resource group / region: `aks-training` / `centralindia`.
- Endpoint: `pe-keda-queue`; connection: `keda-queue-connection`, Approved; target: `stakskeda555a1e03`, subresource `queue` only.
- Dedicated subnet: `private-endpoints`, `10.81.2.0/27`, in `vnet-aks-training-flat`. Existing node/pod subnets were not modified. Private endpoint network policies are disabled on the new subnet.
- Private IP: `10.81.2.4`.
- DNS zone: `privatelink.queue.core.windows.net`; VNet link: `keda-flat-vnet`, registration disabled, linked only to the flat VNet.
- Endpoint DNS zone group: `queue-dns`; Azure-managed A record: `stakskeda555a1e03` -> `10.81.2.4`.
- Verified from a temporary pod on the flat cluster: the standard queue hostname resolved to `10.81.2.4`, TLS certificate validation succeeded, and Azure Queue returned HTTP 401 for the intentionally unauthenticated request. This proves private DNS and HTTPS reachability, not application identity or queue data permissions.
- The original diagnostic failed only because it asserted HTTP 403 instead of accepting the observed 401 authentication challenge. The corrected diagnostic succeeded; both diagnostic pods were deleted afterward.
- No private connectivity for the instructor laptop or overlay VNet was added. The local console is not made operational by this endpoint alone. No policy exception, Azure role, or application deployment was added during Private Link setup.
- Private endpoint uptime/data processing and private DNS can incur charges in addition to retained storage.

## Cost


The Free tier applies only to control plane pricing. Four node VMs in total, managed disks, load balancers, public IPs, and outbound traffic can incur charges. Stopping clusters reduces compute costs but does not eliminate charges for retained resources. Delete the training environment when it is no longer needed.

The Basic container registry, image storage beyond included allowances, image transfers, and ACR Tasks build execution can also incur charges. Lab namespace cleanup does not remove the registry or its images.