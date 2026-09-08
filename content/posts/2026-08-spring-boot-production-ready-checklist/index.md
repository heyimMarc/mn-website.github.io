---
title: "Spring Boot Production-Ready Checklist (2026)"
date: 2026-08-17T10:00:00+02:00
draft: false
description: The checklist I walk through before a Spring Boot service goes to production, covering observability, resilience, security, containerisation and Kubernetes readiness, with the settings that actually matter.
menu:
  sidebar:
    name: "Spring Boot Production-Ready Checklist"
    identifier: spring-boot-production-checklist
    weight: 10
tags: ["spring-boot", "java", "kotlin", "microservices", "kubernetes", "production"]
categories: ["backend"]
---

Shipping a Spring Boot service is easy. Keeping it fast, secure and operable at three in the morning is the hard part. This is the checklist I walk through before a rollout, condensed from services I have taken to production on Kubernetes over the last few years, currently on Spring Boot 4 and Java 25.

It is deliberately not a list of everything you *could* do. It is the set of things whose absence has cost me, or a team I worked with, an incident.

## Observability: can you answer "what is it doing right now?"

The first question after a deployment is never "is the code correct?" It is "is it healthy?". Three things answer that.

**Actuator, but not wide open.** Expose health, info and Prometheus, nothing else, and keep the management port separate from the business port so an ingress misconfiguration cannot leak internals:

```yaml
management:
  server:
    port: 8081
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  endpoint:
    health:
      probes:
        enabled: true
      show-details: when-authorized
  metrics:
    tags:
      application: ${spring.application.name}
```

`health.probes.enabled` gives you `/actuator/health/liveness` and `/actuator/health/readiness`, exactly what Kubernetes needs, and semantically different from the aggregate health endpoint. Do not point a liveness probe at `/actuator/health`: a temporarily unreachable database will mark the aggregate health as DOWN, Kubernetes will restart the pod, and restarting will not bring the database back. You have turned a degradation into a restart loop.

**Metrics that describe user pain, not JVM trivia.** Heap and thread counts are useful during an investigation, but alerts belong on RED metrics: request rate, error rate, duration. Micrometer gives you `http.server.requests` out of the box; the work is in tagging it usefully and keeping cardinality bounded. A tag with a user ID or a raw path containing an ID will multiply your time series until your Prometheus falls over. Use templated paths (`/orders/{id}`, not `/orders/4711`).

**Correlation across services.** Structured JSON logs plus a trace ID that survives every hop. With Micrometer Tracing and OpenTelemetry this is mostly configuration, but it only works if propagation survives your asynchronous boundaries: thread pools, message listeners, scheduled jobs. Test it: send one request through the whole chain and confirm you can find every log line for it by trace ID. In one project this took an afternoon and has saved days since.

## Resilience: what happens when the other side is slow?

Almost every production incident I have debugged came down to a call that was allowed to take too long.

**Every outbound call gets a timeout.** Not "most". Every one: HTTP clients, database pools, message brokers, cache lookups. Default timeouts in many clients are infinite, and an infinite timeout under load turns into thread exhaustion, then a failing readiness probe, then a restart, then the same thing on the next pod.

**Retries only where they are safe.** Retrying a non-idempotent POST turns one duplicate into three. Retry idempotent reads with jittered backoff; make writes idempotent with a business key before you retry them at all.

**Circuit breakers around genuinely unreliable dependencies.** With Resilience4j the declarative form is enough for most cases:

```kotlin
@CircuitBreaker(name = "billing", fallbackMethod = "billingUnavailable")
@Retry(name = "billing")
fun fetchInvoice(id: InvoiceId): Invoice =
    billingClient.getInvoice(id.value)

@Suppress("unused")
private fun billingUnavailable(id: InvoiceId, ex: Exception): Invoice {
    log.warn("billing unavailable, serving cached invoice for {}", id, ex)
    return invoiceCache.get(id) ?: throw ServiceDegradedException(ex)
}
```

The fallback is the interesting part. "Return a cached value and mark the response as stale" is a product decision, not a technical one: have that conversation before the incident, not during it.

## Security: the boring items that get skipped

- **Secrets never in the image and never in the repository.** Mounted from the platform's secret store, rotated without a rebuild.
- **Least privilege for the service account**, both in Kubernetes and towards the database. A service that only reads does not need a writing database user.
- **Pinned base images and a dependency scan in the pipeline.** An SBOM you generate but never look at is decoration; wire the scan into the merge request so someone has to acknowledge a new critical CVE.
- **Actuator and Swagger UI off, or behind auth, in production.** The number of publicly reachable `/actuator/env` endpoints on the internet is a good argument for a separate management port.

## Configuration and testing

Externalise configuration per environment and keep the differences small: the more the environments diverge, the less your staging test proves. Feature flags are worth it for risky changes, because "turn it off" is a much faster remedy than "roll back the deployment".

For tests, the pyramid still holds: many fast unit tests, a solid layer of integration tests against real infrastructure via Testcontainers, and a thin end-to-end layer. Testcontainers is what makes the middle layer honest: an integration test against an in-memory database proves your code works against an in-memory database.

Contract tests earn their keep as soon as two teams share an API. Generating clients and events from an OpenAPI or JSON Schema contract is even better: the contract becomes the single source of truth, and a breaking change fails the build instead of surfacing in production.

## Containerisation

A layered image keeps rebuilds cheap and pulls fast:

```dockerfile
FROM eclipse-temurin:25-jdk AS builder
WORKDIR /app
COPY target/*.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --destination extracted

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=builder /app/extracted/dependencies/ ./
COPY --from=builder /app/extracted/spring-boot-loader/ ./
COPY --from=builder /app/extracted/snapshot-dependencies/ ./
COPY --from=builder /app/extracted/application/ ./
USER 1000:1000
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "org.springframework.boot.loader.launch.JarLauncher"]
```

Two details that bite people: run as a non-root user (many clusters enforce it and your pod simply will not start), and set `MaxRAMPercentage` instead of a fixed `-Xmx`. The JVM is container-aware, but the default heap fraction plus metaspace, thread stacks and native memory will still walk you into an OOMKill if the container limit is tight.

## Kubernetes readiness

Three probes, three different jobs:

- **Startup probe** buys a slow-starting application time without making the liveness probe lenient forever. This is the one people forget, and then they set an enormous `initialDelaySeconds` on liveness, which means a genuinely hung pod also takes minutes to be noticed.
- **Readiness probe** controls traffic. It should go DOWN when a critical dependency is gone, so the pod leaves the load balancer instead of serving errors.
- **Liveness probe** should only fail when a restart actually helps. Deadlock, yes. Database outage, no.

Add graceful shutdown, or every deployment drops in-flight requests:

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Set requests and limits from observed traffic, not from a guess. And if you autoscale, scale on something that reflects user experience (request rate or queue depth) rather than CPU alone. A service waiting on I/O has low CPU while its latency goes through the roof.

## Delivery

Build once, promote the same artefact through the environments. Sign the image, keep the pipeline cache warm, and make the quality gates blocking: a linter, formatter or coverage threshold that only warns will be ignored within a week.

For anything user-facing, progressive delivery is worth the setup: shift a small share of traffic, watch the error rate and latency against a threshold, roll back automatically if it degrades. The value is not the fancy rollout, it is that the rollback is a tested, boring path rather than an improvisation.

## The final gate

Before I call something production-ready, I want three questions answered:

1. **Who gets paged, and what do they do?** An SLO without an owner and a runbook is a wish.
2. **What happens if the most important dependency disappears for ten minutes?** Ideally you have tried it in staging rather than reasoned about it.
3. **What does this cost per month, and at what traffic does that change?** Cost is a non-functional requirement like any other, and it is much cheaper to answer before the rollout.

None of this is exotic. It is the difference between a service that runs and a service you can operate.
