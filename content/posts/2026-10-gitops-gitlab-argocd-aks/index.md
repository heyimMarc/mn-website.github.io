---
title: "GitOps Delivery That Survives an Audit"
date: 2026-10-19T09:00:00+02:00
draft: true
description: How GitLab CI and ArgoCD split the pipeline into build and deploy, why pull-based sync beats a kubectl apply from CI, and the quality gates that keep an audit trail worth trusting on AKS.
menu:
  sidebar:
    name: "GitOps: GitLab CI + ArgoCD on AKS"
    identifier: gitops-gitlab-argocd-aks
    weight: 16
tags: ["gitops", "gitlab-ci", "argocd", "kubernetes", "aks", "devops"]
categories: ["devops"]
---

Every few months someone asks who deployed what to production and when, and why. If the honest answer involves scrolling through a Slack channel or an engineer's shell history, you don't have a deployment process, you have a story. The setup I run day to day (GitLab CI for build, ArgoCD for deploy, Helm as the packaging format, AKS as the target) exists mostly because it makes that question boring to answer: check the Git history of the environment repository.

## Two pipelines, two repositories

The mistake I made early on was treating "CI/CD" as one pipeline that builds an image and then also applies it to the cluster. That collapses two very different concerns, producing an artifact and deciding what should currently be running, into one job, and it means your deploy credentials live in the same pipeline that runs arbitrary build scripts and third-party actions.

Split it instead:

- **App repository**: GitLab CI builds the Java service, runs the quality gates, builds and pushes a container image tagged with the Git SHA, and updates the image tag in a Helm values file, in a *separate* environment repository.
- **Environment repository**: contains only Helm charts and values per environment (`values-dev.yaml`, `values-staging.yaml`, `values-prod.yaml`). No build logic. ArgoCD watches this repository and nothing else.

```yaml
# .gitlab-ci.yml (app repo, relevant stages)
stages: [build, quality, package, promote]

build:
  stage: build
  script:
    - ./gradlew bootJar
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA

quality-gate:
  stage: quality
  script:
    - ./gradlew spotlessCheck sonar rewriteDryRun
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

promote-to-dev:
  stage: promote
  script:
    - git clone https://gitlab-ci-token:${ENV_REPO_TOKEN}@gitlab.example.com/platform/env-config.git
    - cd env-config
    - yq -i ".image.tag = \"$CI_COMMIT_SHORT_SHA\"" apps/orders-service/values-dev.yaml
    - git commit -am "orders-service: bump to $CI_COMMIT_SHORT_SHA" && git push
  environment: dev
```

That last step is a commit, not a deploy. Nothing in the app pipeline ever touches the cluster directly. The commit to the environment repository *is* the deployment request; ArgoCD decides whether and when to act on it.

## Why pull beats push

Push-based deploys, a CI job with `kubectl apply` or `helm upgrade`, need cluster credentials sitting inside the CI system. That's a wide door: anyone who can trigger or modify a pipeline can, in principle, reach production. It also means your cluster's actual state can drift from what's in Git the moment someone runs a manual `kubectl edit` to fix an incident at 2am, and nothing notices.

ArgoCD inverts this. The controller runs inside the cluster, has its own scoped credentials, and pulls the desired state from Git on an interval (plus webhook-triggered syncs for lower latency). CI never holds a kubeconfig for anything beyond a read-only registry token. If someone hand-edits a Deployment during an incident, ArgoCD's next reconciliation loop flags it as `OutOfSync` and reverts it if auto-sync is on, which is exactly the behavior you want once the incident is over and you don't want to remember which resource somebody touched.

```yaml
# Application manifest, environment repo, watched by ArgoCD
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: orders-service-prod
  namespace: argocd
spec:
  project: platform
  source:
    repoURL: https://gitlab.example.com/platform/env-config.git
    targetRevision: main
    path: apps/orders-service
    helm:
      valueFiles: [values-prod.yaml]
  destination:
    server: https://aks-prod.internal
    namespace: orders
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=false
```

`selfHeal: true` is the setting that actually earns its keep. Without it, ArgoCD only tells you the cluster has drifted; with it, the cluster corrects itself. I keep `prune: true` off for a couple of stateful namespaces where an orphaned PVC reference has bitten me before: pruning a resource that's still referenced by a StatefulSet's storage claim is not a mistake you want to make twice.

## The audit trail is the point

For production, sync is not fully automated: merge to the environment repository's `main` branch requires an approval from someone other than the author, enforced by a GitLab protected branch rule and a CODEOWNERS entry per app directory. That single control answers, structurally, three questions an auditor always asks: who requested the change, who approved it, and what exact artifact went live. All three are Git metadata: commit author, MR approver, commit SHA matching the image tag. No spreadsheet, no change-ticket system bolted on the side.

The hard lesson here was learning that "automated" and "unreviewed" are not the same thing, and that GitOps lets you have automation for dev/staging and a human gate for prod without running two different deployment mechanisms. The mechanism (commit to environment repo, ArgoCD syncs) never changes; only the branch protection rule changes.

## Quality gates before the commit even happens

None of this matters if bad code reaches the point of being promotable. The `quality-gate` stage above runs on every merge request and blocks the merge, not just the deploy:

- **Spotless** for formatting: a merge request with a formatting diff is a merge request nobody can review properly.
- **SonarQube** quality gate for coverage delta and new code smells, with the gate configured to fail on new blocker/critical issues rather than an absolute coverage threshold, since absolute thresholds punish legacy modules and don't move behavior.
- **OpenRewrite** dry-run recipes for the migrations we're rolling out gradually (dependency upgrades, deprecated API removal): it reports what *would* change without touching the branch, so reviewers see the debt without a 400-file diff blocking an unrelated feature.

The gate that has saved us the most incidents, though, isn't a linter: it's that the environment repository's Helm values are schema-validated against a JSON schema per chart (`helm template --validate` plus a `kubeconform` step) before the promotion commit lands. A typo'd resource limit or a missing `readinessProbe` fails fast in CI instead of failing an ArgoCD sync in production later, with a much less friendly error message.

## What this setup does not solve

GitOps does not make bad Helm charts good, and it does not replace a rollback strategy: reverting the environment repo commit triggers a redeploy of the old image, which is fast, but it is still a full rollout, not an instant traffic shift. For that we still lean on readiness gates and a conservative `maxUnavailable`. GitOps also doesn't remove the need for someone to own the ArgoCD installation itself: the controller, its RBAC, and its own upgrade path are one more piece of cluster infrastructure, not a SaaS you can forget about.

What it does buy is a deployment history that is just `git log`, a security boundary that keeps CI from ever holding production credentials, and a self-healing loop that turns "someone fixed it manually and forgot to tell anyone" from a silent risk into a Slack notification. For anything that has to answer an auditor's questions eventually, that trade is worth the extra repository.
