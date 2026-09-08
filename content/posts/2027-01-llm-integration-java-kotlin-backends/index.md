---
title: "LLM Features in a Java Backend That Survive Production"
date: 2027-01-04T09:00:00+01:00
draft: true
description: Timeouts, retries, schema validation, quotas, and a kill switch, treating the Anthropic API as just another unreliable upstream in a Java/Kotlin backend.
menu:
  sidebar:
    name: "LLM in Java Backends"
    identifier: llm-integration-java-kotlin-backends
    weight: 27
tags: ["java", "kotlin", "llm", "anthropic", "backend", "api-design"]
categories: ["backend"]
---

I added two LLM features to a Java/Micronaut SaaS I co-founded on the side: importing unstructured CV PDFs into a structured candidate profile, and generating role descriptions from a handful of input fields. Neither is exotic as a feature. What took the actual engineering time was making both behave like production dependencies instead of demo code, because that is exactly what an LLM API call is: a network call to a system you don't control, with latency and failure modes that are worse than your database's, and a cost per call that a bug can turn into a bill.

The instinct when you first wire up the Anthropic SDK is to treat it like a library call. It isn't. It's an HTTP request to someone else's infrastructure, and every rule you already apply to calling a flaky third-party REST API applies here too, plus a few extra ones because the response is only as trustworthy as the prompt that produced it.

## Start with the client, not the prompt

Before writing a single prompt, I set up the client the way I'd set up any external HTTP client: explicit timeouts, bounded retries, and a clear boundary between "the SDK retried transient errors" and "my code decides what happens on a permanent one."

```java
AnthropicClient client = AnthropicOkHttpClient.builder()
    .apiKey(apiKeyProvider.get())
    .timeout(Duration.ofSeconds(30))
    .maxRetries(2)
    .build();
```

The SDK already retries 429s and 5xx responses with backoff, which covers the "Anthropic is briefly overloaded" case. What it doesn't cover is your own application-level judgment calls: should a CV import that fails after all retries queue for a background retry, or fail the user-facing request immediately with a clear error? For CV import I chose the latter: the user is watching a progress bar, and a silent retry queue is worse UX than "try again in a minute." For role-description generation, which runs as a background job, I let it re-queue once and then give up and notify.

Catching a single broad exception type throws away information you'll want later:

```java
try {
    Message response = client.messages().create(params);
} catch (RateLimitException e) {
    // back off, or let the job queue retry
} catch (NotFoundException e) {
    // model id typo, config error: do not retry, page someone
} catch (AnthropicServiceException e) {
    e.errorType().ifPresent(type -> log.warn("Anthropic error: {}", type));
} catch (AnthropicIoException e) {
    // network failure before any response: treat as transient
}
```

That distinction, retryable network/5xx/429 versus a 400 that means your code is wrong, is the same triage you'd apply to any HTTP client. The only Anthropic-specific wrinkle is that a 400 here often means the request shape drifted from what the model expects, not that the caller sent bad data, so it deserves a page rather than a silent retry.

## Don't trust free-text JSON

The CV import feature asks the model to turn a wall of PDF text into a structured profile: name, contact details, work history, skills. The tempting shortcut is to ask for "JSON only" in the prompt and parse the response text. Don't. Even a well-behaved model will occasionally wrap the JSON in a sentence, use a slightly different key name, or emit a number as a string. None of that is a hallucination in the interesting sense: it's just free text pretending to be a contract.

The fix is to stop treating the schema as a suggestion and make it a request parameter. The Java SDK derives a JSON schema from a plain record and gives you a typed result back instead of a string to parse yourself:

```java
record WorkHistoryEntry(String employer, String title, String startDate, String endDate) {}
record CandidateProfile(String fullName, String email, List<WorkHistoryEntry> workHistory, List<String> skills) {}

StructuredMessageCreateParams<CandidateProfile> params = MessageCreateParams.builder()
    .model("claude-sonnet-5")
    .maxTokens(4096L)
    .outputConfig(CandidateProfile.class)
    .addUserMessage("Extract a candidate profile from this CV text:\n\n" + cvText)
    .build();

CandidateProfile profile = client.messages().create(params).content().stream()
    .flatMap(cb -> cb.text().stream())
    .findFirst()
    .map(typed -> typed.text())
    .orElseThrow();
```

This doesn't make the extraction perfect (a CV with a genuinely ambiguous date range is still ambiguous after this), but it eliminates an entire category of bugs where the model's output almost matches your contract. Almost-matching JSON is worse than obviously broken JSON, because it passes code review and fails in production three weeks later on one specific résumé format nobody tested. I learned to distrust "it worked on my test PDFs" for exactly this reason: the failure mode isn't the model refusing, it's the model succeeding at a slightly different task than the one you asked for.

For the role-description generator, which produces free-form prose rather than structured data, schema validation doesn't apply the same way: there I validate length bounds and check for a minimum set of required sections before showing the draft to a user, and reject-and-regenerate once if those checks fail.

## Quotas are a product decision, not an infrastructure afterthought

Anthropic's rate limits protect Anthropic's infrastructure. They say nothing about how much of *your* API budget one customer account should be allowed to spend. Without an application-level quota, a single account running CV imports in a loop, intentionally or through a client bug, can consume a meaningful share of your daily spend before anyone notices.

I keep this dead simple: a per-account, per-day counter in the same database as everything else, checked before the call goes out.

```java
if (usageRepository.countToday(accountId, Feature.CV_IMPORT) >= plan.dailyImportLimit()) {
    throw new QuotaExceededException(accountId, Feature.CV_IMPORT);
}
```

It's not clever, and it doesn't need to be. It runs in the same transaction as everything else, it's trivial to reason about, and it gives you a lever to adjust per plan tier without touching the LLM integration code at all. The alternative, relying on Anthropic's account-wide rate limit as your only backstop, means one noisy tenant degrades service for everyone else on the same API key, which is a much worse incident than a single tenant hitting their own quota.

## The feature has to be optional

The most valuable line of code in either feature isn't the prompt: it's the one that makes the feature quietly disappear when there's no API key configured, rather than throwing a 500 from somewhere deep in a service class.

```java
if (!aiProperties.isEnabled() || apiKeyProvider.get().isBlank()) {
    throw new HttpStatusException(HttpStatus.SERVICE_UNAVAILABLE,
        "AI-assisted import is not available");
}
```

This sounds trivial until you consider what it buys you: local development without an API key doesn't break, a cost incident can be mitigated by flipping one flag instead of a deploy, and the rest of the application has zero implicit dependency on an external LLM being reachable. The core product, the SaaS itself, works with or without Claude. The AI features are additive, not load-bearing, and the code should say so explicitly rather than let a `NullPointerException` on a missing key say it implicitly at 2am.

## What actually mattered

The prompts for both features are a few dozen lines each and haven't changed much since the first working version: prompt engineering turned out to be the smallest part of the work. Almost everything else went into the boring envelope around the model call, the part that never shows up in a demo. When I later added a third LLM feature to the same codebase, it took about a day instead of a redesign, which is the real test of whether the first two were built correctly.
