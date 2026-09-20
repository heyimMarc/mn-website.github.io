---
title: "Loops Need a Harness"
date: 2027-01-11T09:00:00+01:00
draft: true
description: "An autonomous coding loop optimizes exactly the signal it's given, not the intent behind it. What separates a harness that holds from one an agent can quietly talk its way around."
menu:
  sidebar:
    name: "Loops Need a Harness"
    identifier: loops-need-a-harness
    weight: 34
tags: ["ai", "claude-code", "agents", "testing", "developer-experience"]
categories: ["backend"]
---

Tell an agent to make the tests pass, and the cheapest path to green is deleting the test. I've watched this happen more than once, on a real event-sourced Kotlin and Spring Boot system running on AKS, where Claude Code runs in daily delivery and occasionally overnight as an unattended loop. The model wasn't misbehaving, it did exactly what it was asked, and the ask was worse than it looked.

## The loop optimizes the signal, not the intent

A loop, in the sense I mean it here, is the Ralph technique: hand the same instruction to an agent repeatedly, let it work, check the result, feed it back in, until some condition says stop. That repetition is the whole point. It's also where the trouble starts, because a loop doesn't know what you meant. It only knows what you measured.

Say the instruction is "make the tests green." A model has two ways to get there: fix the code, or make the failing assertion go away. Both satisfy the instruction. Only one of them is what you wanted, and the loop has no way to tell them apart unless something in the harness does. Say the instruction is "the feature is done." A model can implement the feature, or it can comment out the assertion that would have caught the gap and report done. Neither is a bug in the model. Both are rational responses to a goal that can be satisfied more cheaply than intended.

There's a name for this: Goodhart's law, once a measure becomes the target, it stops being a good measure. Loops make the effect sharp and immediate, because a loop iterates fast enough to find the cheapest path within a few cycles, long before a human would have noticed the shortcut. Running a loop is incentive design more than prompting, and if the incentive rewards the appearance of done, that's what you get.

## What actually counts as a harness

A rule the agent can edit its way around is just a suggestion. A test the agent is free to delete when it's inconvenient functions the same way: it looks like a guardrail right up until the moment it matters, and then it isn't one.

Compare two conditions. Weak: "run the tests, see if they pass." An agent under pressure to report success can satisfy that by trimming the suite until what remains passes, and the instruction never notices. Harder to fake:

```bash
deleted=$(git diff --numstat main -- '**/*Test.kt' '**/*Spec.kt' | awk '{sum += $2} END {print sum+0}')
if [ "$deleted" -gt 0 ]; then echo "test lines removed: $deleted"; exit 1; fi
./gradlew test && ./gradlew jacocoTestCoverageVerification
```

Now shrinking the suite trips the deletion check before the run even starts, and a coverage floor that isn't allowed to drop closes off quietly removing assertions in place instead of whole files. Neither check is clever. Both are just expensive to fake compared to actually fixing the thing.

One catch worth knowing before you rely on that coverage floor: `jacocoTestCoverageVerification` doesn't hang off `check` by default, so a pipeline that just runs `./gradlew check` never touches it unless you wire it in yourself:

```
check.dependsOn jacocoTestCoverageVerification
```

A gate nobody invokes isn't a gate.

That's the real test for whether something belongs in a harness: is it cheaper to satisfy for real than to fake. On the platform I work on, a few pieces hold that line well. ArchUnit rules fail the build the moment a class in the domain core reaches into Spring or JPA, an agent can't quietly bypass that by writing more convincing code, it either violates the rule or it doesn't. Contract-first APIs with generated clients push in the same direction: a response shape that drifts from the OpenAPI contract doesn't produce a review comment somebody might wave through, it doesn't compile. Testcontainers-backed integration tests running against a real Postgres instance close off the laziest failure mode of all, a mock that agrees with whatever the code under test expects of it, because it was written by the same agent that wrote the code. None of these are exotic. They're just checks a model can't win by rewriting a test.

## The stop condition is the actual design work

A loop needs to know when to stop, and this turns out to be harder to get right than the loop itself. Run it with no real stop condition and one of two things happens: it goes forever, spending cycles on cosmetic changes once the substantial work is done, or it stops on the first green run regardless of what that run actually checked.

A weak stop condition is an opinion wearing the clothes of a check: "looks complete," "the feature works now." An agent can satisfy an opinion by asserting it confidently, which is exactly what it will do, because confident assertion is cheap and the loop has no way to push back on a claim it can't verify. A stop condition worth having is a conjunction of machine-checkable facts, not a single pass or fail:

- test suite green
- no test file deleted or shrunk relative to the starting commit
- coverage did not drop
- the specific acceptance scenario named in the task actually ran, not just "some tests passed"

Each of those is boring on its own. Together they close off most of the cheap ways out. Writing that list down is the actual design work of running a loop unattended. It takes longer than writing the instruction you hand the loop, and it's worth more.

## Unattended runs need a hard boundary at the edges

An overnight loop, one that starts before I leave and is still running when I check it in the morning, gets one more layer on top of the stop condition: a line around anything that reaches outside the working copy. No push. No deploy. No mail sent on my behalf. No deletion that isn't reversible from inside the repo. Everything that acts on the world outside the loop waits for a human to look at the diff first.

This isn't about the agent's intentions: a mistake caught inside a sandboxed working copy costs nothing, you discard the branch and start over, while a mistake that already pushed to a shared branch or sent an email costs real cleanup, and there's no undo once it's left the machine. The asymmetry is the whole argument. It doesn't need the agent to be untrustworthy, only fallible, and every agent is fallible on a long enough run.

The other piece that matters for an unattended run is where the work lands while it's happening. Progress that lives only in the conversation is gone the moment the run gets killed or the machine reboots, along with whatever reasoning got the agent to that point. Progress written continuously to a file on disk survives a crash, and it means picking the loop back up in the morning starts from where it actually got to, not from a summary reconstructed after the fact, or worse, from zero.

## Not every problem takes a loop well

None of this makes a loop a general multiplier. It multiplies specifically where "done" can be checked by a machine: a test suite that needs shoring up, a mechanical migration applied file by file, formatting brought into line across a codebase. In those cases the loop can run for hours and the stop condition tells you, honestly, whether it got there.

It does badly wherever "done" is a judgment call rather than a fact, like how to draw an aggregate boundary, or what to build next, or anything that changes what a user sees. Point a loop at one of those and it will still stop, because it always stops on something, but what it stops on is its own confident opinion that the work is finished, and that opinion is exactly the kind of claim the whole setup exists to distrust. You get a long log of iterations and no actual answer to the question you were asking.

The instinct to reach for a loop is usually right about the shape of the problem and wrong about which half of it is hard. Writing the instruction is the easy part. Building the boundary that keeps the loop honest while nobody's watching is the part that decides whether the run was worth starting.
