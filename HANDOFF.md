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
- Initially authored [Lab 01: HPA, PDBs, and KEDA](labs/01-scaling/README.md) with seven Kubernetes manifest files and a PowerShell walkthrough. Initial offline validation passed for all 11 resources, embedded shell syntax, and all 22 PowerShell blocks. No resources were changed during that initial authoring phase.
- Subsequently created Basic ACR `akstraining555a1e03` and published four custom Linux AMD64 demo images. Deployed the [browser presenter](apps/scaling-demo/README.md) with a real streaming terminal and command explanations on the overlay cluster in `scaling-lab`. All 18 manifest resources passed schema checks; ten application tests passed locally and in ACR builds. Browser command execution and desktop/mobile layout were checked. HPA scaled the custom web image from two to four pods and back to two. Both blocked and accepted PDB evictions and replacement recovery were verified. No load Job or test PDB remains; the presenter, two web pods, and HPA remain deployed. KEDA and the queue exercise have not been enabled/run.
- Granted registry-scoped `AcrPull` to the overlay kubelet identity. After explicit user approval, granted the current user AKS RBAC Cluster Admin on the overlay cluster only to resolve Kubernetes access. Exact assignments are recorded in [infra.md](infra.md). The default kubeconfig and flat cluster were not changed.

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

Initial cluster checks included `kubectl get nodes -o wide` and `kubectl get pods -n kube-system`, using separate temporary kubeconfigs. Subsequent overlay checks verified presenter access, web Service traffic from the load generator, HPA scale-out/scale-in, and both PDB eviction cases as recorded above. Cross-network connectivity, public ingress, and the KEDA exercise have not been tested.

Regional preflight confirmed the selected VM size was unrestricted, the required providers were registered, and quota was sufficient. Availability, quota, versions, and health can change; query live Azure state before further provisioning.

## Resume on Another Machine

Prerequisites: Git, GitHub access to the private repository, Azure CLI, `kubectl`, and Azure `kubelogin`. Use PowerShell for the examples below. Authenticate interactively on the new machine; do not transfer tokens or kubeconfig files from this machine.

After verifying publication in the section below, clone the repository, or pull it in an existing clean checkout:

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
- The localhost presenter port-forward repeatedly disconnected with `lost connection to pod` while the presenter remained Ready with zero restarts. Restarting the tunnel restored access temporarily; the cause has not been established. Do not assume the tunnel is still running. Use the [presenter reconnect guide](apps/scaling-demo/README.md#reconnect), which also covers obtaining new machine-local credentials. No public endpoint or automatic reconnection was configured.

## Decisions and Limits

- Two clusters were chosen to demonstrate Overlay versus VNet-routable pod networking side by side. A third disposable cluster was discussed but not created or authorized.
- The flat cluster can be reused for break/fix labs after networking exercises. Cluster-wide changes affect everyone sharing that cluster; namespaces do not isolate upgrades, networking, or add-on operations.
- This is training infrastructure, not a production-ready baseline. Initial system pools also host lab workloads. Public API endpoints are enabled; local admin accounts are disabled. Node-pool SSH was not explicitly disabled, although no local SSH keys were supplied and nodes have no public IPs.
- No VNet peering, private API connectivity, or enterprise hub/spoke network was created.
- KEDA, node autoscaling, paid monitoring, gateways, and Istio are not configured. Metrics Server is running; it is not equivalent to Azure managed monitoring.
- Kubernetes version auto-upgrades are not configured; the node OS upgrade channel is `NodeImage`.
- The Free tier does not eliminate VM, disk, networking, or retained-resource costs. Do not stop, delete, resize, or add paid services without authorization for that change.

## Remaining Work

[Lab 01](labs/01-scaling/README.md) contains HPA scale-out/scale-in, rejected and accepted PDB evictions, and KEDA Redis queue scaling from zero. It now uses custom ACR images and an AKS-hosted browser presenter. The source test command is `npm --prefix apps/scaling-demo test`; image builds are documented in the [presenter guide](apps/scaling-demo/README.md). Verify current context/capacity before further operations. Managed KEDA enablement requires separate approval, and its end-to-end exercise has not been run. No CI/CD workflow exists. Base-image vulnerability warnings remain documented; this is not a production-hardened baseline.

Suggested next work, subject to the user's direction:

1. Turn the original topics into an ordered curriculum with lab prerequisites and expected outcomes.
2. Run and refine Lab 01 on the existing overlay cluster, record observed results and cleanup, then prepare Overlay versus flat-network exercises.
3. Plan monitoring, gateway, and service mesh modules with explicit cost and compatibility checks before enabling add-ons.
4. Design scoped troubleshooting exercises with recovery steps and a known healthy baseline.
5. Capture existing infrastructure as code if requested, without replacing live resources by default.

Do not infer from this list that any new deployment, third cluster, paid add-on, or destructive exercise has been approved.

## Publication State

On 2026-09-13, the user explicitly requested committing and pushing all pending project work to `https://github.com/vinex22/aks-training.git`, branch `main`. This publication includes the scaling lab, all four demo image sources, presenter UI, tests, dependency lockfile, Kubernetes manifests, infrastructure inventory, and repository instructions. Generated dependencies, credentials, and machine-local kubeconfigs are excluded.

Project work was committed and pushed on 2026-09-13 as `6ae5ed495d9fc089d43548e2aaab823a39e0db99` (`Add AKS scaling lab and deployed presenter demo`). After the push, `git ls-remote origin refs/heads/main` matched that local commit exactly. This handoff confirmation is a follow-up documentation commit. New clones can now retrieve the lab, application sources, and infrastructure records.

Pre-publication checks passed: all ten application tests, handoff links, Git whitespace checks, and common credential-pattern checks across 32 candidate files. Generated dependencies and machine-local credentials were not committed. No Azure configuration changes or fresh live-health checks were performed during publication. Use `git status --short --branch` and remote history to check subsequent publication state rather than treating this record as a permanent statement about branch synchronization.

## Suggested Copilot Prompt

> Read HANDOFF.md, infra.md, and topics.txt. Summarize the completed work and remaining labs. Verify the existing Azure context and cluster health without changing infrastructure. Then help me choose the next training module. Do not recreate clusters or enable paid add-ons without my approval.