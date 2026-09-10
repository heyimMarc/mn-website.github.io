---
title: "Production Readiness on Kubernetes Beyond 'It Deploys'"
date: 2027-03-15T09:00:00+01:00
draft: false
description: Probes done right, resource limits that reflect reality, PodDisruptionBudgets, alerting on symptoms not causes, and wiring Actuator into Prometheus.
menu:
  sidebar:
    name: "K8s Production Readiness"
    identifier: production-readiness-observability-kubernetes
    weight: 24
tags: ["kubernetes", "observability", "prometheus", "spring-boot", "sre"]
categories: ["devops"]
---

A Kubernetes deployment that starts and serves traffic is not the same thing as a Kubernetes deployment that's production ready. The gap between those two is where I've spent most of my time running clusters: migrating workloads off Docker Swarm, moving on-prem services into Azure, and cleaning up manifests that "worked" in the sense that the pod showed Running and nobody had looked closer. Most of what separates a deployment that survives a bad afternoon from one that turns a bad afternoon into an outage is a handful of fields that are easy to leave at their defaults, because the defaults are lenient enough to look fine in a demo.

## Three probes, three different jobs

The most common mistake is treating liveness and readiness as the same concept, or worse, only configuring one of them. They answer different questions, and conflating them causes two distinct classes of incidents.

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  initialDelaySeconds: 0
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 5
  failureThreshold: 30
```

Liveness answers "is this process wedged and should Kubernetes kill it." Readiness answers "should this pod currently receive traffic." A Spring Boot service warming up a connection pool or loading a cache is alive (the process is fine) but not ready, and if you only configure a liveness probe, traffic hits the pod before it can actually serve requests correctly, which shows up as a burst of errors right after every rollout that nobody can explain because the pod status said Running the whole time.

The startup probe exists for the opposite problem: a service with a genuinely slow boot (JVM warm-up, schema migrations, cache population) will get killed by the liveness probe's `failureThreshold` before it ever finishes starting, causing a crash loop that looks like the application is broken when it's actually just slow to start. The startup probe gives it a longer runway before liveness checks even begin, without weakening liveness detection once the service is actually running. Spring Boot Actuator's liveness and readiness groups map onto this almost exactly, which is one of the more pleasant "the framework already solved this" moments: `management.endpoint.health.probes.enabled=true` and the two groups exist without extra code.

## Requests and limits describe intent, not hope

Resource requests and limits get treated as a formality: copy whatever the last service used, bump it if pods get OOMKilled, move on. That approach produces two failure modes that look unrelated but share a cause: nodes that are simultaneously over-committed on CPU and full of idle memory headroom.

The request is what the scheduler uses to place the pod and what Kubernetes guarantees the pod will get. The limit is a hard ceiling: for memory, exceeding it gets the container killed; for CPU, exceeding it gets the container throttled, not killed, which is why CPU-limited services degrade quietly (higher latency) rather than crash, and why that degradation is so easy to miss until someone checks `container_cpu_cfs_throttled_periods_total`.

```yaml
resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    memory: 512Mi
```

Leaving CPU limits unset entirely and letting only the request govern scheduling is a defensible default for latency-sensitive services: a CPU limit only protects against one runaway container by punishing every container on that node with throttling, which for most workloads is a worse outcome than letting a temporary spike borrow spare cycles. Memory doesn't get the same treatment: an unbounded memory limit lets one leaking or spiking pod take down every other pod on the node when the kernel's OOM killer starts picking targets, so memory limits stay tight and get set close to the actual working-set size, established by watching the service under real load rather than guessed from JVM heap flags.

The lesson that took an actual incident to land: setting `requests` far below what a service actually uses "to help the scheduler pack more pods per node" is a bet that not all of those pods will need their real resources at the same time. That bet loses precisely when it matters most: during a traffic spike, when every pod on the node wants more CPU simultaneously, and the ones with generous limits but stingy requests get throttled hardest exactly when they can least afford it.

## PodDisruptionBudgets protect against your own automation

A PodDisruptionBudget (PDB) doesn't protect against a hardware failure: Kubernetes can't negotiate with a dead node. What it protects against is your own cluster's routine maintenance: node upgrades, cluster autoscaler consolidation, anything that does a voluntary, coordinated eviction. Without a PDB, nothing stops a rolling node upgrade from draining every replica of a service within the same maintenance window.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: orders-api-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: orders-api
```

For a service running two or three replicas, `minAvailable: 1` is the difference between a node drain being invisible to users and a node drain being a full outage for the minutes it takes the rescheduled pods to become ready. It costs one YAML file and is one of the highest ratio of protection to effort available on the whole platform, which is exactly why it's the thing most often missing: nothing breaks in normal operation without it, so it never demands attention until a maintenance window makes it demand attention all at once.

## Alert on symptoms, not on causes

The single highest-leverage change I've made to an alerting setup was deleting alerts that fired on causes and replacing them with alerts that fire on symptoms. A "pod restarted" alert or a "CPU above 80%" alert fires constantly, correlates loosely with actual user impact, and trains whoever's on call to ignore pages, which is the real danger, because the ignoring generalizes to the pages that matter too.

Symptom-based alerts ask the question users actually care about: is the service serving requests correctly and quickly.

```yaml
- alert: HighErrorRate
  expr: |
    sum(rate(http_server_requests_seconds_count{status=~"5..", job="orders-api"}[5m]))
    /
    sum(rate(http_server_requests_seconds_count{job="orders-api"}[5m]))
    > 0.05
  for: 5m
  labels:
    severity: page
```

A pod restarting on its own and recovering within seconds is a cause that resolved itself: worth recording, not worth waking someone up for. A sustained elevated error rate or p99 latency crossing an SLO threshold is a symptom that means users are actually affected, and that's the bar for a page. Everything below that bar goes to a dashboard, not a phone.

## Wiring it together

None of the alerting or the probes work without exposing the right metrics in the first place, and for a Spring Boot service that's a small, well-trodden path: Actuator plus Micrometer's Prometheus registry.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, prometheus, metrics
  endpoint:
    health:
      probes:
        enabled: true
  metrics:
    tags:
      application: orders-api
```

That's the entire application-side configuration for a Prometheus scrape target with request-rate, latency, and JVM metrics out of the box, plus health groups the liveness and readiness probes above can point straight at. The Grafana dashboards on top of it are the visible part. The actual production-readiness work happens upstream of the dashboard, in decisions that never show up as a single line in a diff: which probe answers which question, whether a limit reflects real usage or just makes the YAML shorter, whether a maintenance window can quietly take out every replica at once. A service that deploys cleanly and skips all of that will run fine right up until the first bad day, and the first bad day is not when any of it can be added fast enough to matter.
