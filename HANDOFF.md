# AKS Training Handoff

Last updated: 2026-09-15. This document preserves project context across machines and Copilot sessions. It is a historical handoff, not a live Azure health report.

## KEDA Lab - Deployed, 2026-09-15

Current state: deployed the [private KEDA console and Node processor](labs/keda/DEPLOYED.md) in `keda-lab` on `aks-training-flat`. The working URL is http://127.0.0.1:18084 via `service/keda-console`; the original 18083 process is laptop-only and not the deployed demo. Created three managed identities and federated subjects with four least-privilege queue-scoped role assignments, listed in the deployed guide and infra inventory. Workload Identity and Private Link are working: two UI batches each sent 30 messages with zero failures, KEDA activated to three desired processors, consumer logs showed deletion, and both batches drained and returned to zero replicas. The pod-list normalization fix is deployed and the UI showed actual Ready processors. Final state: console 1/1 Ready with zero restarts, queue depth 0, no processor pods or generator Jobs, ScaledObject Ready=True/Active=False. 11 tests and desktop/mobile UI checks passed. Public access/shared keys stay disabled. No ACR build, user/kubelet grant, KEDA operator patch, or other lab changes were made. The prior manifest-only and blocked-state descriptions below are historical, not the current deployment status.

Latest network update: the approved policy-exemption attempt failed with `LinkedAuthorizationFailed`; the user chose Private Link. Created `pe-keda-queue` (Approved, queue subresource) at `10.81.2.4` in new subnet `private-endpoints` (`10.81.2.0/27`) on the flat VNet. Created `privatelink.queue.core.windows.net`, link `keda-flat-vnet`, and endpoint DNS zone group `queue-dns`. An in-cluster probe verified standard queue DNS resolves privately and certificate-validated HTTPS reaches Azure Queue. Azure returned 401 without credentials; an initial test incorrectly required 403, then the corrected test succeeded. Both temporary probe pods were removed. Public access remains disabled. The local console still needs private connectivity or an AKS-hosted implementation plus data-role/Workload Identity setup; no authenticated queue sends or KEDA consumer scaling have been verified. See [infra.md](infra.md) for the resource inventory. The earlier setup description below predates Private Link creation.

Subsequent work: implemented the [local KEDA queue console](apps/keda-console/README.md) at http://127.0.0.1:18083 and created storage account `stakskeda555a1e03` (Standard LRS, Central India) plus queue `keda-demo` in `aks-training`. Account names are populated in the lab templates. **Live enqueue remains blocked:** management-group policy `StorageAccount_PublicNetwork_Modify` enforces disabled public access; the Queue SDK returned `AuthorizationFailure`; no queue data roles were found for the current user and role approval was not confirmed. No role, private endpoint, DNS, policy exemption, ACR image, or Kubernetes workload was created. The local app uses the instructor's Azure CLI login and supports bounded 1-500-message batches, a one-hour TTL, cancellation, and honest missing-processor states. Seven tests pass and desktop/mobile blocked-state rendering was checked; real queue sends and KEDA scale-out remain unverified. Resolve approved private connectivity and queue-scoped sender/reader access before claiming the console is operational. The earlier manifest preparation below is historical.

Prepared the [Azure Storage Queue KEDA lab](labs/keda/README.md) based on the reviewed `lestermarch/demo-aks-keda` repository. Intended target: `aks-training-flat`, namespace `keda-lab`. Seven manifests cover namespace, settings, workload ServiceAccount, processor Deployment, TriggerAuthentication, ScaledObject, and a three-minute generator Job. Processor range is 0-6, queue target 10, polling 10 seconds, cooldown and HPA scale-down stabilization 60 seconds. The user reported enabling KEDA; read-only checks confirmed its ScaledObject and TriggerAuthentication CRDs, and all seven manifests passed client dry-run schema validation. Nothing was deployed or provisioned for this new lab. Storage account, workload/scaler identity client IDs, federation, queue permissions, application images, and flat-cluster ACR pull access must be resolved before deployment. The time-capped upstream generator reports DeadlineExceeded by design. Do not apply unresolved placeholder manifests or modify existing labs/add-ons automatically.

## PDB Lab - Deployed 2026-09-15

The [PDB lab](labs/pdb/README.md) is deployed on `aks-training-flat` in `pdb-lab`: Deployment `pdb-demo` has four Ready pods, verified 2+2 across the two nodes using required hostname topology spreading. PDB `pdb-demo` sets `minAvailable: 4` and reports zero allowed disruptions. A server-side dry-run eviction was rejected with `TooManyRequests` for violating the pod's disruption budget. No actual eviction, cordon, or drain was performed. The guide includes a real lab-selected drain with a timeout and uncordon cleanup; do not run an unfiltered drain on this shared cluster. All four pods remain deployed, and HPA/QoS resources were not modified.

## QoS Lab - Deployed 2026-09-15

Deployed all [QoS manifests](labs/qos/namespace.yaml) to `aks-training-flat`, namespace `qos-lab`, after user approval and successful server-side dry-run validation. Kubernetes reported `qos-best-effort` Running/Ready with BestEffort QoS and `qos-burstable` Running/Ready with Burstable QoS. The `qos-guaranteed-unschedulable` pod has Guaranteed QoS and intentionally remains Pending: both nodes have insufficient CPU and memory for its 16 CPU / 64Gi request. Do not resize nodes or reduce its requests to repair this expected demonstration state. No HPA lab resources, Azure roles, ACR resources, or cluster settings were modified.

## Current Work - Flat Cluster HPA Demo

- On 2026-09-15, removed the overlay cluster's entire `scaling-lab` namespace at the user's request. Both clusters and ACR were retained, and both clusters had two Ready nodes after cleanup. The flat cluster had no lab workloads at that time.
- The user then requested the PHP/Apache HPA walkthrough on `aks-training-flat`. The new [flat HPA lab](labs/hpa-flat/README.md) uses namespace `hpa-flat`, the upstream `registry.k8s.io/hpa-example` image, a ClusterIP Service, and an HPA with 1-10 replicas and a 50% CPU target against a 200m request. A five-minute load Job and 60-second scale-down window make the exercise bounded and repeatable.
- Live verification completed: HPA rescale events recorded 1 -> 2 -> 4 -> 1 replicas. Under-load observation showed two Ready pods and 78% CPU versus the 50% target; at least 700 requests succeeded with no failures. The load Job was removed and the final Deployment/HPA returned to one Ready/current/desired replica and about 0% CPU. http://127.0.0.1:18081 returned HTTP 200 with `OK!` before and after the exercise through a localhost-only Service tunnel. The app, Service, and HPA remain deployed; consult the lab's verification record for details and replay commands.
- Subsequently deployed the [classroom load console](apps/hpa-console/README.md) in `hpa-flat`. Open http://127.0.0.1:18082 through `service/hpa-console` port-forwarding for Start/Stop, worker/duration settings, live CPU, pods, desired replicas, timeline, and HPA events. It manages only the bounded `hpa-load` Job and reads cluster telemetry; it does not scale the application directly. The console runs on a digest-pinned public Node image with source/UI ConfigMaps; no custom image was built and no flat-kubelet ACR role was granted. The prior PHP-only tunnel closed; reconnect it separately if needed.
- Console verification observed CPU at 178% and four Ready application pods. Fixed and regression-tested a DELETE-body framing issue so foreground Stop removes the Job and its pod; the earlier completed orphan was cleaned up. Five tests pass; deployment and desktop/mobile UI checks passed. See the console guide for current verification and reconnect status.
- Final console check on 2026-09-15: console and PHP/Apache each 1/1 Ready with zero restarts; HPA one current / one desired replica at 0% CPU; no load Job or load pod. The live console URL returned idle telemetry. Its click handler and keyboard activation are verified; integrated-browser pointer automation was inconclusive while the page was hidden, as recorded in the console guide. The localhost tunnel was left running; restart it if access is lost.
- KEDA and Defender components were observed in `kube-system` on both clusters and preserved. Older statements below about disabled add-ons are historical. This work did not change add-on settings, cluster sizing, Azure roles, or ACR.
- The old app sources and `labs/01-scaling` files were removed from the workspace concurrently by another actor; those deletions were preserved. The interrupted custom dashboard was never built into an image or deployed. Do not restore old files automatically. Historical links below point to the published GitHub version instead.
- No new commit or push has been performed for these changes. The published history below predates the cleanup and new demo.

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
- Initially authored [Lab 01: HPA, PDBs, and KEDA](https://github.com/vinex22/aks-training/blob/6ae5ed495d9fc089d43548e2aaab823a39e0db99/labs/01-scaling/README.md) with seven Kubernetes manifest files and a PowerShell walkthrough. Initial offline validation passed for all 11 resources, embedded shell syntax, and all 22 PowerShell blocks. No resources were changed during that initial authoring phase.
- Subsequently created Basic ACR `akstraining555a1e03` and published four custom Linux AMD64 demo images. Deployed the [browser presenter](https://github.com/vinex22/aks-training/blob/6ae5ed495d9fc089d43548e2aaab823a39e0db99/apps/scaling-demo/README.md) with a real streaming terminal and command explanations on the overlay cluster in `scaling-lab`. All 18 manifest resources passed schema checks; ten application tests passed locally and in ACR builds. Browser command execution and desktop/mobile layout were checked. HPA scaled the custom web image from two to four pods and back to two. Both blocked and accepted PDB evictions and replacement recovery were verified. The presenter, web pods, and HPA were retained then, but removed on 2026-09-15. The queue exercise had not been run.
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
- The historical localhost presenter port-forward repeatedly disconnected with `lost connection to pod` while the presenter remained Ready with zero restarts. Restarting the tunnel restored access temporarily; the cause was not established. The presenter has since been removed. The [archived presenter reconnect guide](https://github.com/vinex22/aks-training/blob/6ae5ed495d9fc089d43548e2aaab823a39e0db99/apps/scaling-demo/README.md#reconnect) applies only if explicitly redeployed. No public endpoint or automatic reconnection was configured.

## Decisions and Limits

- Two clusters were chosen to demonstrate Overlay versus VNet-routable pod networking side by side. A third disposable cluster was discussed but not created or authorized.
- The flat cluster can be reused for break/fix labs after networking exercises. Cluster-wide changes affect everyone sharing that cluster; namespaces do not isolate upgrades, networking, or add-on operations.
- This is training infrastructure, not a production-ready baseline. Initial system pools also host lab workloads. Public API endpoints are enabled; local admin accounts are disabled. Node-pool SSH was not explicitly disabled, although no local SSH keys were supplied and nodes have no public IPs.
- No VNet peering, private API connectivity, or enterprise hub/spoke network was created.
- KEDA, node autoscaling, paid monitoring, gateways, and Istio are not configured. Metrics Server is running; it is not equivalent to Azure managed monitoring.
- Kubernetes version auto-upgrades are not configured; the node OS upgrade channel is `NodeImage`.
- The Free tier does not eliminate VM, disk, networking, or retained-resource costs. Do not stop, delete, resize, or add paid services without authorization for that change.

## Remaining Work

The active exercise is the [flat HPA lab](labs/hpa-flat/README.md) with the [web load console](apps/hpa-console/README.md). Run `npm --prefix apps/hpa-console test` for current application tests. The [archived Lab 01](https://github.com/vinex22/aks-training/blob/6ae5ed495d9fc089d43548e2aaab823a39e0db99/labs/01-scaling/README.md) also covered PDB evictions and KEDA queue scaling; its sources are no longer in the workspace. Do not run its former npm test command against missing files. Verify current context/capacity before further operations. KEDA components are present, but the queue exercise has not been verified end to end. No CI/CD workflow exists. The published demo images are not a production-hardened baseline.

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