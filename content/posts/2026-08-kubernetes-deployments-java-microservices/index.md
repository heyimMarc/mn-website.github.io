---
title: "Kubernetes Deployments for Java Microservices: Rolling, Blue/Green, and Canary"
date: 2026-08-17T10:05:00+02:00
draft: false
description: When to use rolling updates, blue/green or canary for Java services on Kubernetes, with the JVM-specific pitfalls around probes, CPU throttling and connection draining.
menu:
  sidebar:
    name: "Kubernetes Deployment Strategies"
    identifier: kubernetes-deployment-strategies
    weight: 10
tags: ["kubernetes", "java", "microservices", "devops", "argo-rollouts", "deployments"]
categories: ["devops"]
---

Not every change carries the same risk. A copy fix and a rewrite of the pricing logic do not need the same rollout mechanics, and treating them the same means you either move too slowly or find out about a regression from your users.

This is how I pick between rolling updates, blue/green and canary for Java services, and the JVM-specific details that make all three behave differently than the tutorials suggest.

## The baseline every strategy depends on

None of the strategies work if the pod lifecycle is wrong. Get these three right first, otherwise you are just choosing between different ways of dropping requests.

**Probes with distinct jobs.** A Spring Boot service on a cold JVM can take 20 to 40 seconds before it serves its first request, and that is before any warm-up. A startup probe covers exactly that window without making the liveness probe permanently forgiving:

```yaml
startupProbe:
  httpGet: { path: /actuator/health/readiness, port: 8081 }
  periodSeconds: 5
  failureThreshold: 24        # up to 2 minutes to start
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8081 }
  periodSeconds: 5
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 8081 }
  periodSeconds: 10
  failureThreshold: 3
```

The classic mistake is pointing liveness at the aggregate health endpoint. A database blip then marks the pod as dead, Kubernetes restarts it, the restart does not fix the database, and now the outage includes a restart storm. Liveness should only fail when a restart is the remedy.

**Graceful shutdown, end to end.** When Kubernetes terminates a pod, two things happen in parallel: the endpoint is removed from the service, and SIGTERM is sent. The propagation is not instant, so a container that exits immediately will drop requests that were routed a moment ago. Give the JVM a shutdown grace period and let Spring Boot drain:

```yaml
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
server:
  shutdown: graceful
```

```yaml
terminationGracePeriodSeconds: 45
lifecycle:
  preStop:
    exec: { command: ["sh", "-c", "sleep 5"] }
```

The `preStop` sleep looks like a hack and is one, but it buys the time the endpoint removal needs to reach every node. Without it you will see a handful of 502s on every single deployment: small enough to ignore, constant enough to erode trust in the platform.

**CPU limits and the JVM.** A tight CPU limit hurts a JVM more than most runtimes because start-up is the most CPU-hungry phase: class loading and JIT compilation. A service limited to 500 millicores may take three times longer to become ready, which then interacts badly with your probe thresholds. Either give the JVM headroom during start-up or accept longer startup probe windows, but decide it consciously.

## Rolling update: the default, and usually right

Kubernetes replaces pods gradually. No extra infrastructure, no extra cost, and for the large majority of changes it is the correct answer.

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

`maxUnavailable: 0` costs one extra pod's worth of capacity during the rollout and is worth it: capacity never dips below the current replica count.

What rolling updates do not give you: both versions serve traffic simultaneously, and you cannot control who sees which. That is fine for a compatible change and unacceptable for one that is not. Which leads to the rule that matters more than the strategy: **make every change backwards compatible for one release**. Add a column before you write to it, write to both old and new fields before you read the new one, remove the old path in a later release. This is what makes rolling updates safe, and it is also what makes the other two strategies work at all.

Watch out for: sticky sessions (the reason to keep services stateless), connection draining (see above), and cache warm-up: a fresh pod with a cold cache can be an order of magnitude slower, which a rolling update happily sends full traffic to the moment readiness turns green.

## Blue/green: when the cutover must be atomic

Two complete environments, traffic switched in one step, the old version kept running for a while as the rollback path.

Use it when a partial state is genuinely unacceptable: a schema migration that cannot be made compatible, a coordinated change across several services, a release with a regulatory sign-off. The cost is real: double the resources during the switch, plus the discipline to keep both environments identical, or you are testing something you will not ship.

The database is where blue/green usually gets uncomfortable. If both versions share a schema (and they normally do), the "atomic" cutover applies only to the application, not the data. Dual-write and read-old-write-both patterns solve this, at the price of code you must remember to remove.

## Canary: when you want production to tell you

A small share of real traffic goes to the new version, metrics decide whether it grows or gets rolled back. With Argo Rollouts this is declarative:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: pricing-service
spec:
  replicas: 6
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: { duration: 5m }
        - analysis:
            templates: [{ templateName: error-rate-and-latency }]
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100
```

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: error-rate-and-latency
spec:
  metrics:
    - name: error-rate
      interval: 1m
      failureLimit: 0
      successCondition: result[0] < 0.01
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_server_requests_seconds_count{app="pricing-service",status=~"5.."}[2m]))
            /
            sum(rate(http_server_requests_seconds_count{app="pricing-service"}[2m]))
```

Two conditions have to hold for this to be worth the machinery. You need **enough traffic**: at ten percent of a low-traffic service, an analysis window of five minutes may contain a dozen requests, and a single error flips the ratio. And you need **metrics that actually catch the failure mode you fear**. Error rate and latency catch crashes and slowdowns. They do not catch a service that returns wrong prices with a cheerful 200. If that is the risk, the canary needs a business metric, or it is theatre.

For JVM services, one more caveat: a freshly started canary pod is slower than the warmed-up stable pods for the first minutes, because the JIT has not settled. Compare it against a baseline pod of the same age, or start the analysis after a warm-up pause, otherwise you will roll back perfectly good releases because of the JIT.

## Choosing, in practice

| | Rolling | Blue/Green | Canary |
|---|---|---|---|
| Extra cost | none | double, briefly | small |
| Rollback speed | one rollout | instant | automatic |
| Risk visible before full traffic | no | no | yes |
| Needs compatible changes | yes | partly | yes |
| Setup effort | none | medium | high |

My default: rolling updates for almost everything, blue/green when a cutover has to be atomic, canary for the handful of services where a regression is expensive and the traffic is high enough for the metrics to mean something.

And whichever you pick, rehearse the rollback. The strategy that saves you is not the one that deploys elegantly, it is the one whose rollback path someone has walked before the day it is needed.
