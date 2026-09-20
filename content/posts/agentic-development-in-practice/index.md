---
title: "Agentic Development in Practice: Context Is the Real Bottleneck"
date: 2026-11-09T09:00:00+01:00
draft: true
description: "Running multiple coding agents in daily delivery work surfaces a different bottleneck than expected: not code generation, but context, fabrication, and knowing when parallelism stops paying off."
menu:
  sidebar:
    name: "Agentic Development in Practice"
    identifier: agentic-development-in-practice
    weight: 31
tags: ["ai", "claude-code", "agents", "developer-experience", "architecture"]
categories: ["backend"]
---

The expensive part of working with coding agents was never getting one to write code. It's making sure the fourth agent in a chain still knows what the first one found out, and it's catching the moment an agent states a precise, wrong fact with total confidence. I work on an event-sourced Kotlin and Spring Boot system running on AKS, and Claude Code has been part of daily delivery there for a while now. What follows is what actually holds up after using it for real work, not a pitch for the tooling itself.

## The cost is re-establishing context, not generating code

A fresh subagent with no memory of the codebase is expensive in a specific way: every question forces it to re-explore before it can answer. Ask it something about the event store schema, it greps, reads, builds a mental model, answers. Ask a second, related question in a new session, and it repeats all of that from zero. The second question should have been nearly free. Instead it costs almost as much as the first.

The fix that actually changed my workflow was switching from disposable subagents to persistent ones. I run long-lived expert agents in terminal panes, one per codebase, that keep their context across a whole day or longer. The agent that already knows how our aggregate boundaries are structured, which modules own which streams, and where the two remaining pieces of pre-refactor legacy code hide, answers a follow-up question in seconds instead of minutes. It doesn't need to relearn the codebase every time I switch tasks and come back an hour later.

This only matters once you're asking the same source more than once, which in delivery work is most of the time. A one-off question doesn't justify keeping an agent warm. A codebase you'll be in for the next three sprints does.

That's not the default recommendation, and for good reason: official guidance for subagents favors fresh, isolated contexts specifically to avoid pollution, because an agent running for hours can carry forward a wrong assumption from an early exploration and never revisit it. Warm saves the cost of re-exploring; fresh protects against baggage that's quietly gone stale. Which one wins depends on whether you're asking the same source more than once and whether what the agent already believes about the codebase is still true.

## Agents fabricate with total confidence

Left unchecked, an agent will invent a metric, a method name, or an incident with the same tone of certainty it uses for something it actually verified. It doesn't hedge more when it's guessing. That's the dangerous part: a fabricated API method reads exactly like a real one, right down to plausible parameter names.

The countermeasure that works is adversarial, not corrective. A second agent, given the explicit job of finding fabrications rather than continuing the work, catches things a self-review pass misses, because the agent that wrote the claim has no incentive to doubt itself. Paired with that: every claim needs a citation, a file path and line number, a log line, a source. If an agent can't point at where a fact came from, the fact doesn't survive.

This showed up clearly in a multi-stage research exercise I ran with roughly a dozen agents in parallel: first a wave collecting raw evidence, then several agents arguing opposing expert positions from that evidence, then a further round whose only job was to attack each resulting thesis. Several theses that looked solid after the argument stage didn't survive the adversarial pass, either falling outright or getting walked back to something narrower and better supported. That's the pass earning its keep.

## Don't let the reviewer see the plan

The most expensive mistake I've made with this setup wasn't a bad agent output. It was asking a review agent to check my own plan. Handed the plan up front, a reviewer tends to confirm it: the plan frames what "correct" looks like, and the reviewer reasons inside that frame instead of against it.

What works instead is withholding the plan entirely. Give the reviewer the same problem, let it solve it independently, and only then compare the two solutions. The disagreements are where the actual signal lives. Where both arrive at the same answer, that's confirmation, and it's worth much less than the first time you find out they disagree over an assumption you hadn't questioned.

## A precise brief is the actual work

Cheap models are genuinely useful for mechanical edits and wide fanout, but only if the brief they're given makes exploration unnecessary. A vague brief forces a cheap model to guess, and a cheap model guessing produces the wrong file touched, the wrong pattern copied, or nothing at all.

Compare these two:

```
Fix the retry logic in the payment adapter.
```

against:

```
File: src/main/kotlin/payments/adapter/PaymentGatewayAdapter.kt
Copy the retry pattern from src/main/kotlin/orders/adapter/InventoryAdapter.kt,
lines 42-58 (exponential backoff, max 3 attempts, retries only on
HttpTimeoutException). Apply the same shape to processPayment() at line 71.
Do not touch the idempotency key logic above it.
Assert: PaymentGatewayAdapterTest should show three retry attempts on a
simulated timeout and zero retries on a 4xx response.
```

The second version isn't longer because it's more polite. It's longer because it removes every decision the model would otherwise have to make on its own, and a cheap model making decisions on its own is exactly where things go wrong. Writing that brief takes real understanding of the problem: the exact file, the sibling pattern to copy, the assertion to check against. If you can't write that brief yet, you haven't understood the task well enough to delegate it, and the model isn't the one who should be figuring that out for you.

## Processes belong in skills, not prompts

A prompt gets typed once and evaporates. A skill is the same instructions saved somewhere they get reused without being retyped, and reused correctly, because they've been through the process of getting written down properly rather than improvised fresh in the moment.

I have a skill that starts a long build or test run in a neighbor terminal pane and watches for the result pattern, so I stop babysitting a spinner by hand. I have another that spins up a persistent expert agent scoped to a specific codebase, so I stop re-explaining project structure at the start of every session. And a third that escalates to a stronger model after two failed attempts at the same fix, with an explicit instruction to check the assumptions made so far before trying anything new.

None of these started as skills. They started as the same prompt, typed a second time, then a third, at which point retyping it stopped being defensible. The rule I've settled on: anything that came up twice gets written down. Not because writing it down is virtuous, but because the version living only in my head degrades a little each time I reconstruct it from memory, and the written version doesn't.

## Parallelism has a ceiling

More agents running at once feels like it should be strictly better, until the coordination cost shows up. Past a certain count, merging their outputs costs more than the parallel work saved, and results start contradicting each other with nobody assigned to reconcile the difference. Twelve agents producing twelve partial views is useful only if something downstream actually resolves the conflicts between them. Without that step, you've traded a slow single answer for a fast pile of disagreeing ones, which isn't a trade, it's just a different problem.

The adjudication step is the part that's easy to skip when you're excited about the fanout and easy to regret skipping afterward. Somebody, or some agent explicitly assigned the job, has to look at where the parallel branches disagree and decide, with reasons, which one holds. Skip that and parallelism stops being leverage and starts being noise with better formatting.

The tool isn't getting smarter here. The discipline is the same one that has always applied to delegating work to people who don't yet know what you know. Give them what they need to succeed. Don't ask them to grade their own homework. Know when adding more hands stops helping.
