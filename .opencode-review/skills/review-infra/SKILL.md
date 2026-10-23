---
name: review-infra
description: Review checklist for infrastructure and delivery changes - Dockerfiles, docker-compose, Kubernetes/Helm/Kustomize manifests, Terraform, CI workflows (.github/workflows, .gitea/workflows, .forgejo/workflows, Jenkinsfile), shell scripts and Makefiles.
---

# Infrastructure and CI Review Checklist

## Containers
- Base images unpinned (`latest`, floating major tags) for production images; packages installed without cleanup of caches in the same layer.
- Running as root without need; secrets passed via `ARG`/`ENV` (persisted in image history) or copied into layers.
- `COPY . .` without `.dockerignore` coverage for `.git`, credentials or build output.
- Health checks or entrypoints that hide failures (`|| true`, missing `set -e`).

## Kubernetes / Helm / Kustomize
- Missing resource requests/limits where the rest of the repository sets them; probes pointing to wrong ports or paths.
- Selector or label changes on existing Deployments (immutable fields; rollout breaks).
- Privileged containers, `hostPath`, `hostNetwork`, broad RBAC (`*` verbs or resources) without justification.
- Secrets committed in plain manifests.

## Terraform / IaC
- Changes that force resource replacement (renames, immutable attributes) on stateful resources.
- Security groups or buckets opened to `0.0.0.0/0` or public access; encryption disabled.

## CI workflows
- Untrusted event text (`${{ github.event.issue.title }}`, comment bodies, branch names) interpolated directly into `run:` scripts (command injection). Pass through `env:` instead.
- Secrets exposed to workflows triggered by forks, `pull_request_target` checking out PR head code, or secrets echoed to logs.
- Third-party actions referenced by mutable tags where the repository pins others by SHA.
- `permissions` broadened without need; missing `concurrency` for deploy jobs.

## Shell scripts
- Missing `set -euo pipefail` where failures must stop; unquoted variables in paths or arguments; `rm -rf "$VAR/"` with a possibly empty variable.
- `curl | sh` installs without checksum verification.

## Do not report
- Tool version bumps without behavior changes visible in the diff.
