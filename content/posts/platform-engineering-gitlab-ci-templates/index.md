---
title: "Platform Engineering Before You Called It That"
date: 2027-04-12T09:00:00+02:00
draft: true
description: "Shared GitLab CI templates and IaC modules as an internal product: versioning, breaking-change discipline, and why adoption beats mandate."
menu:
  sidebar:
    name: "GitLab CI Templates as a Product"
    identifier: platform-engineering-gitlab-ci-templates
    weight: 26
tags: ["devops", "gitlab-ci", "platform-engineering", "iac", "ci-cd"]
categories: ["devops"]
---

Before "platform engineering" was a job title on conference badges, I was doing a version of it: building shared GitLab CI pipeline templates and Terraform modules that other squads could pull into their own repositories instead of writing their own CI/CD from scratch. Nobody called it a platform. It was just the CI/CD person consolidating a stack of slightly different `.gitlab-ci.yml` files into one that worked for all of them. But the moment more than one team depends on a file you don't own the deploy schedule for, you're running a product, whether you call it that or not, and products have users, releases, and a support burden if you get the interface wrong.

## The template is an API, treat the version like one

The failure mode I've seen, and caused, early on, is treating a shared CI template like an internal utility function: edit it in place, whoever includes it gets the new behavior immediately. That's fine right up until the change you make for team A's use case silently breaks team B's pipeline, and team B finds out when their deploy fails on a Friday.

The fix is unglamorous: pin by tag, not by branch, and treat every template like a versioned dependency.

```yaml
# .gitlab-ci.yml in a consuming project
include:
  - project: 'platform/ci-templates'
    ref: 'v3.4.0'
    file: '/templates/java-service.yml'
```

Not:

```yaml
include:
  - project: 'platform/ci-templates'
    ref: 'main'
    file: '/templates/java-service.yml'
```

`ref: main` feels convenient because teams get improvements automatically. It also means the platform team can break every consumer's pipeline with a single merge, with no review step on the consuming side and no way to roll one team back without rolling everyone back. Semantic versioning on the template repo (tags, a changelog, a documented deprecation window before removing a job or renamed variable) turns "we changed the pipeline" from an incident into a changelog entry someone reads on their own schedule.

## Breaking changes need a migration path, not just a warning

A shared module accumulates assumptions over time: a default runner tag, a variable name, an artifact path convention. Changing any of those is a breaking change even when the diff looks small. The discipline that saved me the most pain was never removing an interface in the same release that introduces its replacement. Add the new job or variable name, keep the old one working with a deprecation notice, give consumers a release or two to migrate, then remove it.

```yaml
# templates/java-service.yml (v3.x)
.deploy-template:
  script:
    - |
      if [ -n "$DEPLOY_TARGET" ]; then
        echo "WARNING: DEPLOY_TARGET is deprecated, use DEPLOY_ENVIRONMENT. Removed in v4.0.0."
        export DEPLOY_ENVIRONMENT="$DEPLOY_TARGET"
      fi
    - ./deploy.sh --environment "$DEPLOY_ENVIRONMENT"
```

That's more code than just renaming the variable and posting about it in chat, but the alternative is a rollout that happens all at once during an incident review, because someone's production deploy job failed at the worst possible time, and trust in the shared template, the whole reason it exists, takes the damage instead.

The same applies to the IaC modules. A module that provisions a standard set of Azure resources for a service is, from the consumer's point of view, a black box with inputs and outputs. Renaming an output, changing a default, or altering a resource's naming convention inside the module can force a destroy-and-recreate on every consumer's `terraform plan` even if nobody touched their own code. Pin module versions the same way:

```hcl
module "service_infra" {
  source  = "git::https://gitlab.example.com/platform/terraform-modules.git//service-infra?ref=v2.1.0"

  service_name = "orders-api"
  environment  = "production"
}
```

And run `terraform plan` against the new module version in CI before anyone merges the version bump: the plan output is the actual changelog that matters, more than anything written in prose.

## Adoption, not mandate

The organizational lesson took longer to learn than the technical one. Early on, I assumed that if the shared template was objectively better than what a squad had hand-rolled, adoption would follow naturally, and if it didn't, a mandate from above would fix it. Neither is quite right. A team that's told to adopt a golden path it didn't ask for treats it as an imposition to work around rather than a tool to build on, and they will find the gaps, because every hand-rolled pipeline exists for a reason, even if that reason is "nobody got around to consolidating it yet."

What worked better was consulting: sitting with a squad, understanding what their pipeline actually needed to do (their build tool, their test split, their deploy target) and either fitting the existing template to that need or being honest that it didn't fit yet. Sometimes the answer was "your case is different enough that the template doesn't help you," and that's a legitimate outcome, not a failure of the platform. A platform that tries to cover every edge case with configuration flags turns into something worse than twelve separate pipelines: one enormous pipeline with far more conditional blocks than anyone can safely change, because nobody knows which team depends on which flag combination.

## A golden path can patronize

There's a specific way a well-intentioned golden path goes wrong: it starts optimizing for the platform team's ability to reason about all consumers uniformly, at the expense of the individual team's ability to reason about their own pipeline. A template with dozens of configurable variables and several levels of conditional includes is technically flexible and practically opaque: a team debugging a failed deploy has to understand the platform team's abstraction before they can understand their own build.

The templates that held up best were the boring ones: a small number of jobs, minimal parameterization, and an explicit escape hatch (a documented way for a team to override a specific stage without forking the whole template) for the cases that didn't fit. Not every team needs that escape hatch. The ones that do need it badly, and refusing to provide one just pushes them back to hand-rolling everything, which is the outcome the platform was supposed to prevent in the first place.

Across both the CI templates and the IaC modules, the pattern held: the thing you're building is infrastructure other people's incident timelines depend on, whether or not anyone calls it a platform. Version it, don't break it silently, and when a team routes around your template, treat that as a signal about a case you didn't design for, not a discipline problem on their end.
