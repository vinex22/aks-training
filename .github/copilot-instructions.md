# AKS Training Project Instructions

- Read [HANDOFF.md](../HANDOFF.md) before resuming project work, [infra.md](../infra.md) for the infrastructure inventory, and [topics.txt](../topics.txt) for training scope.
- Existing Azure resources are training infrastructure. Verify live state and subscription/tenant context before operations; never assume the workspace needs new clusters. Historical health checks are not current health guarantees.
- Use explicit Azure subscription and Kubernetes context for resource operations. Do not recreate, delete, stop, or resize resources, or enable paid add-ons, without authorization for that change.
- Never commit tokens, private keys, kubeconfigs, or login caches. Obtain credentials through the current machine's authenticated tools.
- Preserve existing user changes. Keep infrastructure records and handoff status updated after verified changes, distinguishing planned work from completed work.
- Show visible progress for scripts and multi-step operations. Prefer PowerShell examples consistent with the existing documentation.
- This repository currently contains documentation only: there is no application build or automated test suite. Validate Markdown references and command syntax; report whether Azure checks were actually run.