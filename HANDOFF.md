# AKS Training Handoff

Last updated: 2026-09-13. This document preserves project context across machines and Copilot sessions. It is a historical handoff, not a live Azure health report.

## Start Here

1. Read [topics.txt](topics.txt) for the original training scope.
2. Read [infra.md](infra.md) for deployed resource names, network ranges, identities, access commands, and cost caveats.
3. Inspect the current Git state and verify Azure account context before continuing.
4. Reuse the existing clusters. Do not recreate them or assume a blank subscription.

## Work Completed

- Initialized this repository on branch `main` and created the private GitHub repository [vinex22/aks-training](https://github.com/vinex22/aks-training).
- Committed and pushed the original topic outline as `05b7257` (`Initial commit`). Configured `origin` and tracking of `origin/main`.
- Created resource group `aks-training` in Central India (`centralindia`).
- Created `aks-training-overlay` for the main labs and `aks-training-flat` for networking comparisons and later break/fix exercises.
- Created separate VNets, node subnets, the flat cluster's pod subnet, and one user-assigned control plane identity per cluster.
- Granted each cluster identity Network Contributor on its own VNet. Granted the deploying user Azure Kubernetes Service RBAC Cluster Admin scoped to each cluster individually.
- Provisioned both clusters using Azure CLI, not Bicep, Terraform, or azd. No reusable infrastructure template, deployment script, or infrastructure state file has been authored.
- Recorded the resulting configuration in [infra.md](infra.md).

Both clusters use Kubernetes `1.35.7`, Azure Linux 3.0, Cilium, and the Base SKU with the Free control-plane tier. Each has two `Standard_D2s_v5` nodes. The full inventory is maintained in [infra.md](infra.md), rather than duplicated here.

## Deployment Context

| Setting | Value |
| --- | --- |
| Subscription name | `ME-MngEnvMCAP497026-vinayjain-1` |
| Subscription ID | `555a1e03-73fb-4f88-9296-59bd703d16f3` |
| Tenant ID | `45b68ab1-2c84-414f-918d-e945e189121d` |
| Resource group | `aks-training` |
| Region | `centralindia` |

Azure CLI and VS Code Azure extensions have separate authentication contexts. They matched during provisioning, but must be checked independently on a new machine. Do not select an unrelated tenant from personal Copilot memory.

## Last Verified State

On 2026-09-13, Azure reported both clusters as `Succeeded` and `Running`. Authenticated Kubernetes checks confirmed two Ready nodes per cluster and all system pods Running with all containers ready. Workload identity webhook pods had two historical startup restarts per pod; they were healthy at verification.

Verified commands included `kubectl get nodes -o wide` and `kubectl get pods -n kube-system`, using separate temporary kubeconfigs. Application traffic, DNS from an application pod, cross-network connectivity, ingress, and training exercises have not been tested.

Regional preflight confirmed the selected VM size was unrestricted, the required providers were registered, and quota was sufficient. Availability, quota, versions, and health can change; query live Azure state before further provisioning.

## Resume on Another Machine

Prerequisites: Git, GitHub access to the private repository, Azure CLI, `kubectl`, and Azure `kubelogin`. Use PowerShell for the examples below. Authenticate interactively on the new machine; do not transfer tokens or kubeconfig files from this machine.

After these documents have been committed and pushed, clone the repository, or pull it in an existing clean checkout:

```powershell
git clone https://github.com/vinex22/aks-training.git
Set-Location aks-training
git status --short --branch
```

For an existing checkout, inspect `git status` before using `git pull --ff-only`; preserve local work. Open the repository folder in VS Code so its Copilot instructions are available.

Sign in to the deployment tenant, select the intended subscription, and inspect the existing clusters:

```powershell
az login --tenant 45b68ab1-2c84-414f-918d-e945e189121d
az account set --subscription 555a1e03-73fb-4f88-9296-59bd703d16f3
az account show --query '{name:name,id:id,tenantId:tenantId}' --output json
az aks list --resource-group aks-training --subscription 555a1e03-73fb-4f88-9296-59bd703d16f3 --query '[].{name:name,state:provisioningState,power:powerState.code,version:kubernetesVersion}' --output table
```

Use the access commands in [infra.md](infra.md) to obtain user credentials and explicitly convert the kubeconfig to Azure CLI authentication. Those commands update the default kubeconfig and select the last cluster as current context. Use explicit contexts for all subsequent lab commands:

```powershell
kubectl --context aks-training-overlay get nodes -o wide --request-timeout=30s
kubectl --context aks-training-overlay get pods -n kube-system --request-timeout=30s
kubectl --context aks-training-flat get nodes -o wide --request-timeout=30s
kubectl --context aks-training-flat get pods -n kube-system --request-timeout=30s
```

A different user needs appropriate Azure permission to retrieve user credentials and Kubernetes RBAC access. Existing assignments were made for the deploying user only; do not fall back to local admin credentials or grant subscription-wide roles to bypass access issues.

## Known Tooling Issues

- The provisioning machine had the `aks-preview` Azure CLI extension. Do not assume it is installed or required on another machine; verify flags against the installed CLI and current official documentation.
- `az aks get-credentials` reported conversion to Azure CLI authentication, but the first Kubernetes checks still opened device-login prompts. Explicit `kubelogin convert-kubeconfig -l azurecli --kubeconfig <path>` fixed this. With the default kubeconfig, omit `--kubeconfig <path>`.
- Validation kubeconfigs were temporary files outside the repository. They are machine-local and not part of the handoff. No credentials or private keys belong in Git.
- Azure CLI generated guidance contained stale version and networking examples. The actual deployments used live regional version checks and installed CLI help instead. Do not rerun generated examples blindly.
- In PowerShell, use single-quoted JMESPath expressions when they contain backticks; double-quoted expressions can be altered by PowerShell escaping.

## Decisions and Limits

- Two clusters were chosen to demonstrate Overlay versus VNet-routable pod networking side by side. A third disposable cluster was discussed but not created or authorized.
- The flat cluster can be reused for break/fix labs after networking exercises. Cluster-wide changes affect everyone sharing that cluster; namespaces do not isolate upgrades, networking, or add-on operations.
- This is training infrastructure, not a production-ready baseline. Initial system pools also host lab workloads. Public API endpoints are enabled; local admin accounts are disabled. Node-pool SSH was not explicitly disabled, although no local SSH keys were supplied and nodes have no public IPs.
- No VNet peering, private API connectivity, or enterprise hub/spoke network was created.
- KEDA, node autoscaling, paid monitoring, gateways, and Istio are not configured. Metrics Server is running; it is not equivalent to Azure managed monitoring.
- Kubernetes version auto-upgrades are not configured; the node OS upgrade channel is `NodeImage`.
- The Free tier does not eliminate VM, disk, networking, or retained-resource costs. Do not stop, delete, resize, or add paid services without authorization for that change.

## Remaining Work

No runnable labs, sample applications, Kubernetes manifests, test suite, CI/CD workflows, or training guides have been created. There is no build or test command for this documentation-only repository.

Suggested next work, subject to the user's direction:

1. Turn the original topics into an ordered curriculum with lab prerequisites and expected outcomes.
2. Prepare repeatable HPA/PDB/KEDA exercises, then Overlay versus flat-network exercises.
3. Plan monitoring, gateway, and service mesh modules with explicit cost and compatibility checks before enabling add-ons.
4. Design scoped troubleshooting exercises with recovery steps and a known healthy baseline.
5. Capture existing infrastructure as code if requested, without replacing live resources by default.

Do not infer from this list that any new deployment, third cluster, paid add-on, or destructive exercise has been approved.

## Publication State

On 2026-09-13, the user approved a local commit of [infra.md](infra.md), this handoff, and [.github/copilot-instructions.md](.github/copilot-instructions.md). Pushing these documents has not been requested; only the initial topic-outline commit is known to have been pushed.

Before switching machines, push the documentation commit to `origin/main` after approval. Until then, a clone or pull will not contain this handoff. Check Git status and remote history rather than treating this paragraph as a permanent statement about the branch. Update this section once publication is complete.

## Suggested Copilot Prompt

> Read HANDOFF.md, infra.md, and topics.txt. Summarize the completed work and remaining labs. Verify the existing Azure context and cluster health without changing infrastructure. Then help me choose the next training module. Do not recreate clusters or enable paid add-ons without my approval.