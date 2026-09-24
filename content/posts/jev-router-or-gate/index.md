---
title: "Jev and the Line Between a Router and a Gate"
date: 2026-10-05T09:00:00+02:00
draft: true
description: "A model that returns typed decisions instead of prose changes where AI can sit inside a backend. The useful question is not how fast it is, but which jobs a calibrated probability is actually allowed to do."
menu:
  sidebar:
    name: "Router or Gate"
    identifier: jev-router-or-gate
    weight: 35
tags: ["ai", "architecture", "event-sourcing", "java", "backend"]
categories: ["backend"]
---

TypeSafe AI put Jev into early access on 15 September, and within a week the number everyone was repeating was 193 times faster. That is the least interesting thing about it. Speed is a reason to use something you already decided you want. The question worth asking first is what a model that refuses to write text is allowed to do inside a system, and that one is architectural.

## What it actually does

Jev answers three kinds of question and nothing else. Choice picks one option from a list you define. Score rates something against a rubric of two to ten levels. Noul returns a probability between zero and one that a statement you supply is true. You send a state, text or JSON, together with a map of questions, and every question comes back answered in the same call, each with its probability and, for Choice and Score, a confidence value.

There is no prose. There is no reasoning trace. The output is meant to be consumed by the next line of code rather than read by a person.

Under the hood it is a transformer trained exclusively on synthetic data, using a method TypeSafe calls Reinforcement Learning for Calibrated Decisions. What that means in practice has not been published: no paper, no weights, no architecture details. Pricing is 0.042 dollars per million input tokens with output tokens free, which puts a classification call somewhere in the range of rounding error.

The limits matter more than the pitch. Jev cannot generate code, refactor anything, summarise a document or explain its own answer. In a review context that last one bites. You get a number telling you something is probably wrong, and nothing telling you what. For ranking work that is enough. For diagnosing it is useless, and the difference between those two jobs is most of this post.

<!--
TODO before publishing: the measurement section goes here.

Run https://github.com/heyimMarc/jev-calibration-probe against my own repos and
report the real numbers: accuracy at 0.5, expected calibration error, the
reliability table, and the per-mutation-kind breakdown. The interesting claim to
test is calibration, because nobody has published an independent number for it.
Write whatever comes out, including a boring result.

Do not publish this post with this block still in it.
-->

## The distinction the hype skips

In an earlier post I argued that the checks worth putting in a harness are the ones that are cheaper to satisfy honestly than to fake. ArchUnit rules that fail the build when a domain class reaches for Spring. A contract-first API where a drifted response shape does not compile. Testcontainers running against a real Postgres so a mock cannot quietly agree with the code that produced it. None of those are clever. All of them are binary.

A probability is the opposite kind of thing. "0.83, this change looks like it weakens the test suite" is not a verdict, it is a lead. Wire it into a merge gate and you have built something that blocks correct work some of the time and waves through broken work the rest of the time, with a threshold nobody can defend. Worse, the threshold becomes a negotiation. Somebody will want it at 0.9 after a bad week, and at that point the gate is a mood.

So the line I would draw is this. A router may be probabilistic. A gate may not.

Routing is a decision about where work goes, and being wrong costs you a detour. Gating is a decision about whether work proceeds, and being wrong costs you either a broken main branch or an engineer who learns to ignore the check. The same number that is perfectly good for the first job is disqualifying for the second, and no amount of accuracy changes that, because the problem is not the error rate. The problem is that a gate has to be something you can argue with deterministically at three in the morning.

This is also why calibration is the only number I care about. If a model tells me 0.9 and is right nine times out of ten, I can build a queue that puts the worst changes in front of a human first, and I can reason about how much review capacity that queue needs. If 0.9 means "fairly sure" in some unspecified way, I have a score, not a probability, and everything downstream is vibes with decimal places.

## Where it fits in ordinary backend work

Once you stop looking for a gate, the fits are easy to find. Every one of these is a place where I have watched teams write increasingly elaborate rules to avoid asking a model anything.

Mapping free text onto a domain enum is the obvious one. Work orders arriving over a message bus, tickets from an external system, SAP fields that were typed by a human in 2014: the usual answer is a regex ladder, a lookup table and a queue of unmatched cases somebody clears on Fridays. Choice is exactly that shape, and the confidence value gives you a principled way to decide what still goes to the Friday queue.

Triaging a failing CI run is another. Real regression or flake is a judgement people make on gut feel and then act on by rerunning the job. A Score with a calibrated confidence turns that into something you can measure and improve, and the cost of being wrong is one extra rerun.

Prefiltering before an expensive call is the one with the clearest economics. If a cheap typed decision can answer "is this request even in scope" for a fraction of a cent, the frontier model only sees the requests that need it. The asymmetry in price is large enough that this pays for itself at fairly modest volume.

And ranking review findings, which is where I started. Not deciding what merges, just deciding what a human looks at first.

## The part nobody is writing about

Here is where it gets specific to the systems I work on, and where I think the real operational cost hides.

I build event-sourced systems. The event store is the system of record, and the ability to replay it is the whole point: it is how you rebuild a projection, how you answer an audit question, how you fix a bug in a read model without losing history.

Now put a model inside that. If you classify during event processing and store only the result of the classification in a projection, a replay after a model update gives you different answers than the original run. Your audit history quietly stops being a history. It becomes a re-derivation that happens to agree with the past most of the time.

The fix is not subtle once you see it. The decision has to be stored as an event, not recomputed. Something like `WorkOrderClassified(category, confidence, model, askedAt)`, written once, replayed forever. And this is the first time I have seen a model output that can reasonably go in an event at all. A typed value with a probability is a fact. A paragraph of generated prose is not: it is too long, too unstable across versions, and impossible to assert against in a test.

Which means the model version becomes part of your schema. It needs to be recorded alongside the decision, it needs a migration story when TypeSafe ships a new one, and "we upgraded the model" becomes a change with the same blast radius as a database migration rather than a config tweak. I have not seen anyone write about that yet, and it is going to be somebody's incident.

## What would have to be true

The interesting bet here is not about one company. It is that AI stops being a single large thing you talk to and turns into typed components you compose, which is the direction every other part of software has taken. If that holds, the value ends up in plumbing that no user ever sees: decisions inside the request path, with a latency budget, that never render a word of text.

Four things have to hold for that bet to pay off, and I would rather write them down as a checklist than pretend to forecast.

Calibration has to survive independent measurement, by people who did not build the model and did not design the evaluation.

The model has to stay stable across versions, or the replay problem above turns every upgrade into a data migration.

The price has to stay where it is. The whole case for a decision layer rests on being able to call it carelessly.

And reproducibility needs an answer. Pinned versions, or recorded decisions, or both.

## The case against

It would be dishonest to write all that without the obvious objection, which is that none of this needs a separate company.

Structured outputs and constrained decoding already exist at the large providers. Token probabilities are already exposed. What Jev is selling is not a capability the incumbents lack, it is a latency and cost profile, plus a calibration claim that is currently unverified. That is a thin moat. The plausible ending is that typed, calibrated decisions become a cheap mode on models that already do everything else, and a company with 40 million dollars of seed money and a 200 million dollar valuation gets acquired for the team.

I would still build with it, carefully, in the places described above, because the architectural idea is right whether or not this particular implementation of it survives. Separating the fast typed decision from the slow generative one is good design on its own terms. It was good design before anyone shipped a model specifically for it.

Just keep it out of your gates.
