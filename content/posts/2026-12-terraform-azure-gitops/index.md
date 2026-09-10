---
title: "Terraform on Azure with GitOps Discipline: State, Plans, and Drift"
date: 2026-12-21T09:00:00+01:00
draft: false
description: "Practical patterns for running Terraform against Azure with GitLab CI and ArgoCD: remote state, plan-in-MR review, module boundaries, and dealing honestly with drift."
menu:
  sidebar:
    name: "Terraform + GitOps on Azure"
    identifier: terraform-azure-gitops
    weight: 25
tags: ["terraform", "azure", "gitops", "devops"]
categories: ["devops"]
---

Terraform is easy to get working and surprisingly easy to get working badly. It'll happily let a team share a local state file over a network drive, let anyone with cloud credentials run `apply` from their laptop, and let modules balloon until a single `terraform plan` touches half the Azure subscription. None of that is Terraform's fault exactly: it's a tool that reflects whatever discipline you bring to it. The discipline that's worked for me combines remote state, a strict plan-in-merge-request workflow through GitLab CI, and module boundaries drawn around actual ownership rather than convenience.

## State: remote, locked, and boring

The starting point that isn't optional: state lives in Azure Storage with a blob lease for locking, never on a laptop, never in the Git repo itself.

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "tfstate-rg"
    storage_account_name = "tfstateaccountname"
    container_name       = "tfstate"
    key                  = "networking/prod.tfstate"
  }
}
```

The `azurerm` backend's native state locking via blob lease means two concurrent `apply` runs can't corrupt each other: the second one blocks until the first releases the lease. That's necessary but not sufficient. The bigger risk isn't concurrent applies, it's someone running `terraform apply` locally with credentials that don't match what CI would have used, applying a plan that was never reviewed. The fix for that isn't technical, it's procedural: nobody has standing permissions to apply against shared environments interactively. CI service principals apply; humans plan and review.

State file organization matters more as things grow. One giant state file for an entire Azure subscription means every plan is slow, every plan's blast radius is enormous, and a `terraform state rm` mistake in one team's resources can corrupt the mental model of unrelated resources sitting in the same file. Splitting state by bounded contexts (networking, one state per application's infrastructure, shared platform resources like AKS itself) keeps blast radius contained and plan times sane. The tradeoff is you now need `terraform_remote_state` data sources or, more robustly, a small number of stable outputs (subnet IDs, resource group names) published somewhere both states can read, to wire the pieces together without creating a fragile mesh of cross-state dependencies that turns a straightforward change into a four-state coordination exercise.

## Plan-in-MR: the workflow that catches mistakes before they're expensive

The GitLab CI pipeline I've settled into runs `terraform plan` on every merge request, posts the plan output as a pipeline artifact and MR comment, and gates `apply` behind manual approval that only runs after merge to the default branch:

```yaml
plan:
  stage: plan
  script:
    - terraform init
    - terraform plan -out=tfplan
    - terraform show -json tfplan > plan.json
  artifacts:
    paths:
      - tfplan
      - plan.json
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

apply:
  stage: apply
  script:
    - terraform apply tfplan
  dependencies:
    - plan
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: manual
```

The critical property here is that the plan a reviewer reads in the MR is the same plan artifact that gets applied: not a fresh plan generated at apply time that could have drifted from what was reviewed if something else merged in between. `terraform plan -out=tfplan` followed by `terraform apply tfplan` guarantees that. Skipping the saved-plan step and just running `plan` then `apply` separately as two commands is a common shortcut that quietly reintroduces a review gap: what got approved and what got applied are no longer provably the same thing.

Reviewing a Terraform plan is a specific skill worth naming explicitly to a team, because it's not the same as reviewing application code. The things worth training reviewers to look for: any `-/+` (destroy and recreate) on a resource that holds state, like a database or storage account, since that's a data-loss risk hiding behind an innocuous-looking diff; any change to IAM role assignments or network security rules, which deserve slower review regardless of how small the diff looks; and the overall resource count changing far more than the MR's stated intent would suggest, which usually means a module upgrade pulled in unrelated changes.

## Module boundaries

The module boundary mistake I've seen most often is drawing modules around Azure resource types instead of around ownership. A "networking module" that every team's infrastructure depends on sounds tidy, but it means every team's plan is coupled to every change anyone makes to networking, and the module's maintainer becomes an unintentional bottleneck for unrelated teams' infrastructure changes. Drawing module boundaries around what one team actually owns and changes independently (even if it means a bit of duplicated resource declarations across modules) keeps blast radius aligned with the organizational boundary that's actually changing things. Shared genuinely-stable primitives, like a naming convention module or a module that creates a resource group with standard tags, are fine to centralize because they change rarely and their interface is small.

## Drift: you will have it, plan for detecting it

No amount of process prevents drift entirely. Someone changes a firewall rule directly in the Azure portal during an incident, at 2am, because it was faster than going through the pipeline, and now the running state diverges from what Terraform thinks it manages. That's a reasonable trade to make under incident pressure: the mistake is not going back afterward to either revert the manual change or codify it.

A scheduled drift-detection pipeline (a nightly `terraform plan` against every environment's state, alerting if the plan isn't empty) is the honest way to surface this rather than discovering it the next time someone runs a real apply and gets an unpleasant surprise about what's about to change underneath resources they didn't touch. It doesn't fix the underlying discipline problem of manual changes happening at all, but it converts an invisible discrepancy into a visible one on a schedule you control, rather than one that surfaces itself at the worst possible moment during the next planned change.
