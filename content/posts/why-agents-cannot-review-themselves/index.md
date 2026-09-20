---
title: "Why Agents Cannot Review Themselves"
date: 2026-12-14T09:00:00+01:00
draft: true
description: "A review agent that already knows the proposed solution judges inside that solution's frame instead of against it. What actually forces an independent opinion, and where a test should have replaced the review in the first place."
menu:
  sidebar:
    name: "Why Agents Cannot Review Themselves"
    identifier: why-agents-cannot-review-themselves
    weight: 33
tags: ["ai", "claude-code", "agents", "code-review", "architecture"]
categories: ["backend"]
---

A review agent that has read the proposed solution before forming its own opinion will confirm that solution almost every time, and the confirmation is worth almost nothing. I run Claude Code daily on an event-sourced Kotlin and Spring Boot platform on AKS, and I've watched this happen often enough that I stopped treating it as a prompting problem. It isn't one. It's structural, and it applies to human reviewers too, just less severely, because an agent trained to be cooperative has even less appetite for telling you your plan is wrong.

## The frame problem

Here's the mechanism. Show a reviewer a plan, and the plan does two things at once: it proposes an answer, and it quietly defines what "correct" means for the rest of the conversation. Every subsequent judgment happens inside that frame. Is the error handling adequate, given this approach? Is the naming consistent? Does it handle the edge case this design was built around? Every one of those questions accepts the frame and searches for flaws inside it. Nobody asks the one question that actually matters: is this the right frame at all, or would a different shape of solution have made half these edge cases disappear on their own?

I ran into this doing something as ordinary as asking a fresh agent to check a plan I'd already written for a saga-style compensation flow. Handed the plan, it found two real issues: a missing idempotency key and a race in the retry path. Both fixes. Neither one questioned whether saga-style compensation was the right approach for that flow in the first place, and in hindsight it wasn't, a simpler two-phase confirmation would have avoided the retry race entirely rather than patching around it. The agent wasn't being lazy. It was doing exactly what I asked: review this plan. I just hadn't asked the question that would have surfaced the actual problem.

Human reviewers do the same thing, and I've watched it from the other side too, having built a six-person team from scratch and eventually handed that project over. A reviewer who sat in the design meeting where the approach got picked is reviewing a decision they already own a piece of. Disagreeing with it means disagreeing with themselves. The bias is real in people; it's just louder in agents, because agents have no social cost for staying agreeable and no memory of feeling embarrassed the last time they missed something.

## What doesn't need an opinion at all

Before getting to what actually counters the bias: where review shouldn't be involved in the first place matters just as much. On the same platform, we don't rely on a reviewer, human or agent, to catch a class in the domain core that reaches into Spring or JPA. That's an ArchUnit rule that fails the build. We don't rely on a reviewer to notice that an adapter hand-rolled a request DTO instead of using the client generated from the OpenAPI contract, either; that's the same kind of rule:

```kotlin
@ArchTest
val payment_adapter_must_use_generated_client: ArchRule =
    classes().that().resideInAPackage("..adapter.out.payment..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage(
            "..adapter.out.payment..",
            "..generated.client.payment..",
            "kotlin..", "java.."
        )
```

Pair that with contract-first OpenAPI, where the client types are generated from the same spec the provider is built against, and a deviation from the contract doesn't produce a review comment. It produces a compile error. Nobody has to hold an opinion about whether the field name matches; the field either exists on the generated type or the build is red. The same goes for behavior: a test in the JUnit and Mockito layer, a WireMock stub standing in for a downstream service, a Testcontainers-backed integration test against a real Postgres instance, a Cucumber scenario walked through REST Assured against the running service. None of that is a judgment call for a reviewer to render. It's a pass or fail a machine produces on its own, and it produces the same answer regardless of who wrote the code or how convincingly they argued for it.

Review, agent or human, is for the part that's left over once all of that is in place: whether the aggregate boundary is drawn in a sensible spot, whether a service is doing too much, whether a decision that's technically correct today will be expensive to walk back in eight months. None of that compiles into a rule. That's exactly why it's the part where the framing bias does the most damage, because it's the part where there's no test to fall back on when the opinion turns out to be wrong.

## Solve it twice, then compare

For that leftover category, the fix isn't a cleverer prompt asking the agent to "consider alternative approaches" or "be critical." I tried variations of that for a while and got critical-sounding agreement back, which is worse than plain agreement because it reads like independent thought. The fix is withholding the plan. Give a second agent the same problem statement I gave the first one, none of the design discussion, none of the draft, and let it produce its own solution from scratch. Only then put the two side by side.

Where they land on the same design, that's weak evidence the design is fine; both agents may simply have inherited the same blind spot from similar training. Where they diverge is the useful part. One agent modeling a cancellation window as a scheduled compensating event and the other modeling it as a guard clause on the read side is a real signal, because it means there were two defensible ways to read the requirement and I'd only considered one of them going in. The disagreement doesn't need to be resolved by picking a winner outright. It needs to be resolved by asking why they diverged, which is usually where the actual requirement was underspecified.

## Show the diff, not the author

The second technique is cheaper and fits changes that don't warrant a full second implementation. Take the diff, strip the commit message, strip any comment explaining the reasoning, and hand it to an agent with no indication of who wrote it or why. Then don't ask "is this good." Ask "what breaks in production." Those two prompts pull completely different behavior out of the same model. "Is this good" invites a scan for style and a polite nod. "What breaks in production" invites a search for the request that arrives while a retry is in flight, or the migration running against a table that's still receiving writes. Maybe it's the event schema an older consumer can't parse. That kind of search doesn't leave much room for a polite nod, and a reviewer hunting for a specific failure doesn't have anything to be agreeable about.

## Where the economics don't work

None of this is free, and I'd rather say that plainly than let it sound like a default. A second independent implementation costs roughly as much as the first one did, and reconciling the two costs a further pass on top of that. For a routine change, that's not worth it, the review-as-gate that most teams already run is enough, and the compile-and-test gates handle the part that shouldn't be a matter of opinion regardless. This is worth the extra cost specifically where a wrong call is expensive to undo: a data migration, a change to how events are shaped once other services depend on reading them, anything that deletes state, anything that changes what "correct" means for a downstream consumer months after the fact.

What I've stopped doing is asking a reviewer, agent or otherwise, to bless a plan it already helped shape. If it saw the plan, it isn't reviewing the plan anymore. It's agreeing with itself, and there's a name for evidence that only ever confirms what you already believed: not evidence at all.
