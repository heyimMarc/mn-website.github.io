---
title: "Skills as Institutional Memory"
date: 2026-11-23T09:00:00+01:00
draft: true
description: "A skill without a precise trigger condition is a prompt nobody reruns. What makes agent skills stick is the same discipline good runbooks and onboarding docs need on a team, except with agents you find out in hours instead of months."
menu:
  sidebar:
    name: "Skills as Institutional Memory"
    identifier: skills-as-institutional-memory
    weight: 32
tags: ["ai", "claude-code", "agents", "developer-experience", "team"]
categories: ["backend"]
---

Ask a contractor rotating off a project what the deploy runbook assumes, and you'll get a shrug, because nobody wrote it down, they just knew it. Ask an AI agent the same question and you get a confident, wrong answer, because it never knew it in the first place and has no memory of the last time it found out. I've hit this exact gap from two different directions: building a rotating group of contractors into a fixed team of six engineers in Poland and handing the project to them, and running Claude Code daily against an event-sourced Kotlin and Spring Boot system on AKS. Different timelines, same failure mode. What isn't written down doesn't survive the handoff.

## Write down what came up twice

The rule I use now is blunt: anything that comes up a second time gets written down, no exception weighed against how busy the week is. This isn't about tidiness. A fact that lives only in your head degrades a little every time you reconstruct it, because memory reconstructs rather than replays, and the version you retype on the third occasion quietly drops the caveat that mattered on the first. A written version doesn't decay that way. It sits there exactly as precise as the day someone got it right, and the next person, human or agent, inherits the precise version instead of the eroded one.

With a team, that decay takes months to surface. Someone forgets why a particular service still writes to two topics instead of one, a new hire asks, gets half an answer, and the half-answer becomes the team's new understanding. With an agent, the same decay takes hours. Ask a fresh Claude Code session the same question you asked yesterday's session and you can get a different answer, delivered with identical confidence. Uncomfortable. Also useful: it makes visible in an afternoon a problem that took a team quarters to even notice it had.

## A trigger condition, not a wish list

A skill is not a prompt you saved to paste again. The difference is what it states about when it applies. A prompt says what to do. A skill also has to say when, precisely enough that it fires without you having to remember you needed it.

Compare a skill described roughly as "helps you debug failing tests" to one that says: after two consecutive failed attempts at fixing the same error, hand the problem to a stronger model, with the explicit instruction to first re-check the assumptions the failed attempts made rather than just try harder along the same path. The first is a wish, and it sits unused, because nothing about it tells the harness or the model when to reach for it. The second fires on a countable condition, two failures on the same error, and it carries a specific instruction, check assumptions before retrying, which is the part that actually stops the third attempt from repeating the first two.

I run a version of that escalation skill, plus three others built the same way. A build watcher starts a long Gradle run in a neighbor terminal pane and polls for the completion pattern instead of me babysitting a spinner, triggered whenever a run would otherwise take longer than I'd wait for it. A repo-onboarding skill spins up one persistent expert agent per unfamiliar codebase, explores it once, and answers every later question against that exploration instead of repeating it, triggered on the first real question about a codebase I haven't already opened an expert for. A second-opinion skill triggers specifically before a risky diff, a migration, a production config change, a deletion, and hands the problem to a fresh agent that hasn't seen my plan, so it solves it independently and the comparison is a real disagreement rather than a confirmation. What ties the four together is a condition paired with an action, never just a saved prompt.

## Skills rot the way code does

Once you have a handful of these, they start needing the discipline you'd apply to code, not to notes. They go stale when the system they describe changes underneath them. They contradict each other when two skills claim the same trigger with different instructions, and nobody notices until an agent picks the wrong one. And a fair number of them, honestly, shouldn't exist. A rule written after one mild annoyance instead of a real, repeated incident is weight without value, one more thing to check against without adding a real safeguard.

I keep project-wide convention files, essentially a CLAUDE.md per repository, holding the rules that apply in every session on that codebase: how we name event types, which module owns which aggregate, what never gets touched without a second look. Those age the same way a runbook ages after the system it describes gets refactored around it. The fix isn't different from fixing stale documentation on a team: delete what no longer applies, and don't add a line unless something actually went wrong that the line would have caught.

## What the handover in Poland already taught me

Before any of this, I built a delivery team out of a rotating set of contractors and turned it into a fixed group of six engineers in Poland, then handed the project over. The central question the whole time wasn't whether the code was good. It was what had to be written down for someone to keep going without me standing next to them. Architecture decisions that lived only in my head were useless to the team the moment I stopped being reachable. The ones that made it into a document, even a rough one, survived.

Claude Code asks the same question at a much higher frequency, with the added twist that the agent forgets by default, every session, unless something outside the conversation carries the knowledge forward for it. A team member forgets slowly, over months, and mostly keeps the shape of things even as the details blur. An agent forgets completely, immediately, between one session and the next. The gap between what's written down and what survives the handover, small enough to hide with a team, is impossible to hide with an agent. Agent work turns into an unplanned audit of how much a team actually documented versus how much lived in one person's head the whole time. Most of what I found living only in my head wasn't dramatic. It was the kind of thing nobody thinks to write down until they're asked to leave it behind.

## The list that's too long to read

None of this scales by adding more rules. A CLAUDE.md with thirty entries gets skimmed the way a wiki page with thirty bullet points gets skimmed by someone on their first day: badly, or not at all. Every rule added past a certain point doesn't add safety, it dilutes the ones that matter, because a rule that matters and a rule that's merely nice to have read identically in a flat list. The discipline that keeps a skill or a convention file useful is closer to editing than to writing: what's stale gets cut, what's redundant gets merged, and what never had a real incident behind it doesn't get added in the first place.

That part doesn't get easier with practice. Writing the rule down the second time something comes up is the cheap half. Deciding, months later, whether it still earns its place on the list, is the half that actually keeps the list worth reading.
