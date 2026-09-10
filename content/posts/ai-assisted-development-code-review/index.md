---
title: "AI-Assisted Development That Survives Code Review"
date: 2027-02-01T09:00:00+01:00
draft: false
description: Agent skills and automated review loops speed up code review, test generation and repetitive refactoring, but only if AI output goes through the exact same pipeline gates as anything a human wrote, with no exceptions.
menu:
  sidebar:
    name: "AI-Assisted Development That Survives Review"
    identifier: ai-assisted-development-code-review
    weight: 21
tags: ["ai", "claude-code", "code-review", "developer-tooling", "quality-gates"]
categories: ["backend"]
---

The productivity claims around AI coding tools are mostly noise. The useful question isn't "how much faster," it's "does the output still have to earn its way through the same gates as everything else." On the platform I work on day to day, we use Claude Code with custom agent skills for code review support, test generation, and repetitive refactoring, and the entire arrangement only works because none of that changes the review bar. It changes who, or what, does the first pass.

## What automation actually replaces

The three places AI-assisted workflows have earned a permanent spot:

**Repetitive refactoring.** OpenRewrite already handles mechanical, semantically-verified transformations: deprecated API removal, dependency migrations. What it doesn't handle is refactoring that requires judgment about naming or structure but is still repetitive across a codebase: renaming a domain concept consistently across twenty modules, or converting a batch of DTOs from classes to records once a Micronaut Serde upgrade makes that viable. An agent skill scoped to "apply this exact transformation pattern to files matching this glob, using this file as the canonical example" does that reliably, because the task has almost no decision space left in it by the time you've written the brief.

**Test generation for coverage gaps.** Given an existing service and a coverage report, an agent can draft unit tests for untested branches significantly faster than a human writing them from scratch. The tests it generates are a first draft, not a merge candidate (more on that below), but a first draft that covers the boring branches (null checks, validation failures, the obvious happy path) frees a human reviewer's attention for the tests that actually require thinking about edge cases in business logic.

**A first-pass review pass before a human ever looks at the diff.** This is the highest-leverage use, and the one worth describing in detail.

## The automated review loop

Every merge request triggers an agent-driven review pass as a CI job, before a human reviewer is assigned. The agent has read access to the diff, the surrounding module, and the architecture rules (the same ArchUnit rules that run as a build gate, see the note on architecture tests below), and it posts findings as MR comments: missed null handling, an inconsistency with an established pattern elsewhere in the module, a method that quietly violates the aggregate boundary.

```yaml
# .gitlab-ci.yml
ai-review:
  stage: quality
  script:
    - claude-code run --skill=code-review --diff="$CI_MERGE_REQUEST_DIFF_BASE_SHA..HEAD" --output=gitlab-comments
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  allow_failure: true
```

`allow_failure: true` is deliberate: the AI review pass is advisory, not a gate. It has no authority to block a merge, and it has no authority to approve one. What it changes is what the human reviewer sees first: obvious issues are already flagged and, in many cases, already fixed by the same author before a human opens the diff at all. The human review that follows is shorter and spends its time on the things that actually need a person: does this design decision make sense, does this match what the ticket asked for, is this the right place for this logic in the domain model. That reallocation, not raw speed, is the actual gain.

## The guardrail that matters most: no exceptions to the gates

Here is the part that's easy to get wrong and expensive when you do: AI-generated code (a full feature branch, a generated test suite, a refactor) goes through exactly the same pipeline as a human-written change. Same SonarQube quality gate, same Spotless formatting check, same ArchUnit architecture tests, same required human approval on the merge request. There is no fast lane for "the agent wrote this and I read it, so it's fine." An agent-authored change that fails the quality gate fails the pipeline, full stop, the same as if a person wrote it.

```java
@AnalyzeClasses(packages = "com.example.orders")
class ArchitectureTest {

    @ArchTest
    static final ArchRule domain_must_not_depend_on_infrastructure =
        classes().that().resideInAPackage("..domain..")
            .should().onlyDependOnClassesThat()
            .resideInAnyPackage("..domain..", "java..", "kotlin..");

    @ArchTest
    static final ArchRule aggregates_must_not_be_returned_from_repositories =
        methods().that().areDeclaredInClassesThat()
            .resideInAPackage("..repository..")
            .should(new DoesNotExposeAggregateRoot());
}
```

Architecture tests like these matter more with AI-assisted development than without it, not less. A generated change that "just works" at the unit-test level can still cheerfully violate a module boundary that isn't obvious from a local diff: an agent given a task scoped to one module has no structural reason to know it's about to reach across a boundary a human on the team would recognize from experience. The ArchUnit suite catches that mechanically, at the same severity as any other violation, before a human reviewer has to notice it by inspection.

The tempting exception is generated tests specifically: reasoning that tests are lower-risk than production code, so a slightly lower bar on style and structure is fine. It isn't, and this is a well-known failure mode with agent-generated tests in particular: relax the bar and you get tests that assert against mocked internals instead of observable behavior, technically passing, providing near-zero regression protection, and indistinguishable from a good test at a glance unless someone actually reads what's being asserted. We don't carve out that exception. Tests generated by an agent go through the identical review, including "does this test actually verify behavior, or does it just execute the code," as a test a human wrote.

## Human review is not a formality here

Every change still requires human sign-off before merge, including changes where an agent did most of the drafting. That's not a compliance checkbox; it's the actual point of the arrangement. The agent is fast at pattern-matching against precedent and mechanical consistency, and that's exactly what it's good at, exactly why it's useful for review-pass triage and repetitive refactors. It has no accountability for whether a design decision fits the product, and no context for organizational history like "we tried that approach two years ago and it caused a production incident, here's why we don't do it that way anymore." That judgment stays with the human reviewer, structurally, not by convention: the merge button is unavailable without a human approval, regardless of what wrote the diff.

The net effect after a year of running this: review turnaround is faster because the mechanical issues are gone before a human opens the tab, test coverage on new code is higher because generating a first-draft test is nearly free, and the actual quality bar (the pipeline gates and the human sign-off) hasn't moved at all. That's the design goal. AI assistance is a way to get to the same bar faster, not a way to lower the bar because the tool is convincing.
