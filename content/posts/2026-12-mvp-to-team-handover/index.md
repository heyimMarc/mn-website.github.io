---
title: "From MVP to Team Handover: Architecting So Others Can Take Over"
date: 2026-12-21T09:00:00+01:00
draft: true
description: "Lessons from taking a route-planning platform from first MVP through a contractor phase to a permanent team of six in another country: architecture decision records, onboarding-by-test-suite, and making yourself replaceable on purpose."
menu:
  sidebar:
    name: "MVP to Team Handover"
    identifier: mvp-to-team-handover
    weight: 25
tags: ["architecture", "team-building", "leadership"]
categories: ["architecture"]
---

I led a route-planning microservice platform from its first MVP through a contractor-staffed build phase to a handover to a permanent team of six in another country, and eventually into a lead-developer role I helped establish there. The technical work was the easy part. The hard part was accepting, early, that the entire point of the exercise was to make myself unnecessary, and that most of the decisions that made handover succeed had to be made before there was any team to hand over to.

## The MVP mistake that doesn't feel like a mistake

Early MVP code has a specific, seductive failure mode: it works, it's fast to write, and every shortcut is individually justifiable given the deadline. The trouble isn't any single shortcut, it's that shortcuts compound invisibly until the system's actual architecture exists only in the head of whoever wrote it. That's fine as long as that person is still around and still remembers. For a project that's actually growing, someone else eventually has to extend the system without them: I just didn't know when.

The correction I made partway through (later than I'd have liked) wasn't to slow down and gold-plate the MVP. It was to start writing down decisions as they were made, not after the fact when memory has already started reshaping them into something cleaner than what actually happened.

## Architecture decision records, kept honest

Architecture Decision Records only work if they capture the messy real reasoning, including the alternatives that got rejected and why, not a sanitized version written for an audience. A useful ADR for this kind of platform reads something like:

```markdown
# ADR-014: Route computation as a separate service from trip management

## Status: Accepted

## Context
Route computation is CPU-bound and benefits from horizontal scaling
independent of trip management's request pattern, which is I/O-bound
and bursty around business-hours trip creation.

## Decision
Route computation runs as its own service, communicating with trip
management via an async message queue rather than a synchronous call.

## Alternatives considered
- Synchronous REST call from trip management: rejected because route
  computation latency under load would directly degrade trip creation,
  an unrelated user-facing path.
- Same service, separate thread pool: rejected because it couples
  deployment and scaling of two workloads with different resource
  profiles, and a route-computation bug could still exhaust process
  memory shared with trip management.

## Consequences
Introduces eventual consistency between trip state and route
availability. Trip management must handle "route not yet computed"
as a valid, expected state rather than an error.
```

The "alternatives considered" section is the part people skip and the part that matters most for handover. A new team reading only the decision will, with total confidence, propose the synchronous version six months later because it looks simpler, and burn a cycle rediscovering the reason it was rejected. That's the failure mode the extra paragraph is there to prevent.

## Onboarding by test suite, not by document

Documentation rots. A test suite that exercises real behavior doesn't, or if it does, it rots loudly by failing rather than quietly by becoming wrong while everyone assumes it's still current. The strongest onboarding tool I had wasn't a wiki page, it was pointing new contractors and later the permanent team at the BDD suite (Cucumber scenarios backed by REST Assured and Testcontainers) and having them trace a business scenario like "a route becomes unavailable mid-trip" from the Gherkin feature file down through the step definitions into the actual service code.

That path teaches the domain vocabulary and the service boundaries at once, and it teaches them from something continuously verified against the real system, rather than from prose that might describe a version of the system that no longer exists. A new engineer who can read a failing scenario and locate the responsible service without being told where to look has genuinely onboarded, in a way that reading an architecture wiki page doesn't reliably produce on its own.

## Contractors into a permanent team: the transition nobody plans for

Growing a contractor group into the seed of a permanent team is a different problem from either hiring contractors or hiring permanent staff in isolation, and it gets little attention because most handover advice assumes a clean swap rather than an overlapping, gradual one. The failure mode I watched for and tried to design against was contractors optimizing for the contract's stated deliverables rather than for the system's long-term shape, which is a rational response to how contracts are usually structured, not a character flaw. The correction was folding architectural discipline into what "done" meant for a deliverable (an ADR gets written, the BDD suite gets updated) rather than treating it as cleanup deferred to later. Later rarely comes.

When the permanent team of six came on board in another country, the overlap period mattered more than any single document. Pairing permanent engineers with contractors on real tickets, not toy onboarding tasks, surfaced the tacit knowledge that never made it into any ADR: the reason a particular retry policy exists, the external system quirk that shaped an interface. Establishing a lead-developer role within that new team, rather than routing every architectural question back to me, was the actual point of the whole exercise: the role needed to exist and have real authority before I stepped back, not be created as an afterthought once I was already gone.

## Making yourself replaceable is the actual goal

The uncomfortable part of this work is that a lead who's genuinely done their job well ends most projects being asked fewer questions, not more, and that's success, not a sign of being sidelined. Every ADR written and every scenario added to the BDD suite that documents a domain rule instead of a UI click sequence is a small transfer of judgment away from a single person and into something the next team can inherit without needing that person on a call. It runs against how job security usually gets talked about, but it's the version of the job that still holds up once you're not in the room anymore.
