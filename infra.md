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

## Cost

The Free tier applies only to control plane pricing. Four node VMs in total, managed disks, load balancers, public IPs, and outbound traffic can incur charges. Stopping clusters reduces compute costs but does not eliminate charges for retained resources. Delete the training environment when it is no longer needed.