---
title: "AWS Cost Optimization for Microservices: ECS vs EKS vs Lambda"
date: 2026-08-17T10:10:00+02:00
draft: false
description: How to pick between ECS, EKS and Lambda for Java microservices, decided by traffic profile, latency requirements and team capacity, with the cost levers that actually move the bill.
menu:
  sidebar:
    name: "ECS vs EKS vs Lambda"
    identifier: aws-runtime-choice
    weight: 10
tags: ["aws", "java", "microservices", "cost-optimization", "ecs", "eks", "lambda"]
categories: ["cloud"]
---

The runtime question usually arrives disguised as a cost question: "our AWS bill is too high, should we move to serverless?" Almost always the honest answer is that the runtime is not the biggest line on the invoice. But the runtime decision does determine which levers you get to pull later, so it is worth making deliberately.

This is the decision framework I use for Java services, and the levers that have moved real bills.

## Start with the traffic profile

Everything else follows from this, so measure it before you argue about it.

**Steady traffic**: a service that handles a comparable load around the clock. Committed capacity is cheap here; per-request pricing is not. Reserved capacity and Savings Plans are the single largest lever, worth 30 to 50 percent against on-demand.

**Spiky traffic**: quiet most of the day, sharp peaks. Whatever you provision for the peak is idle the rest of the time. Either the platform scales to zero, or you are paying for air.

**Bursty and asynchronous**: queues, scheduled jobs, event pipelines. These have no latency requirement worth defending, which makes them the best serverless candidates and the best spot-instance candidates.

Most systems have all three, and the mistake is picking one runtime for all of them. A steady API on committed compute plus event processing on Lambda is a perfectly reasonable architecture, and usually cheaper than forcing either style onto the other.

## ECS on Fargate: the low-effort default

You hand AWS a container and a task definition, and you are done. No control plane to run, no nodes to patch, no cluster upgrade weekends.

Fargate's per-vCPU-hour price is higher than raw EC2, which is the argument people lead with, and it is the wrong comparison. The right one includes the engineer time that EC2 capacity management consumes. For a team without dedicated platform people, Fargate is usually the cheaper option once salaries are in the picture.

Levers that matter here:

- **Right-size the task.** Fargate charges for what you request, not what you use. A 2 vCPU / 4 GB task running at 12 percent CPU is money on fire. Check the actual utilisation before you renew.
- **Fargate Spot for anything interruptible**: batch, queue consumers, non-critical workers. Roughly 70 percent off, in exchange for a two-minute termination notice your application has to handle gracefully.
- **Compute Savings Plans** cover Fargate too, and apply across the account. If your baseline is predictable, this is the least-effort discount available.

Choose ECS when the workload is a handful of long-running services, the team is small, and nobody wants to become a Kubernetes operator.

## EKS: flexibility, at the price of a platform

Kubernetes gives you a portable, extremely well-supported ecosystem: GitOps, service mesh, progressive delivery, autoscaling on custom metrics, one deployment model across teams. The cost is the platform itself: cluster upgrades, node lifecycle, add-on compatibility, and the on-call that comes with it.

The financial break-even arrives earlier than people expect, and it is not about the control plane fee. It is about density: many small services packed onto shared nodes cost far less than the same services as individually provisioned Fargate tasks. Below roughly a dozen services, that packing advantage rarely repays the operational overhead. Above it, the picture flips.

Levers that matter here:

- **Karpenter for node provisioning.** Choosing instance types per pending workload and consolidating underused nodes routinely takes 20 to 40 percent off a naively configured cluster.
- **Spot node pools with on-demand fallback** for stateless workloads.
- **Requests that reflect reality.** Kubernetes bin-packs on requests, so inflated requests waste capacity invisibly. This is the most common source of overspend I see in clusters, and the easiest to fix: compare requests against observed usage, adjust, repeat quarterly.
- **Cost visibility per namespace or team**, with something like OpenCost. Nobody optimises a bill they cannot attribute.

Choose EKS when you run many services, need the ecosystem, and have (or want to build) the capacity to run a platform.

## Lambda: excellent, within its shape

Pay per request and per millisecond, scale to zero, no infrastructure. For spiky, event-driven and asynchronous workloads it is often dramatically cheaper than anything you can provision yourself.

The Java caveat is cold starts. A Spring Boot application on Lambda without preparation can spend seconds initialising, which is fine for a queue consumer and unacceptable for a synchronous API. Three ways out, in order of effort:

1. **SnapStart**: a snapshot of the initialised JVM is restored on invocation. It removes most of the initialisation cost with a configuration change and no code rewrite, which makes it the first thing to try.
2. **A leaner framework**: Micronaut or Quarkus start faster than a full Spring context, at the price of a rewrite.
3. **GraalVM native image**: the fastest starts and the lowest memory, with a build pipeline and reflection configuration to maintain.

Also worth knowing: Lambda's cost curve crosses the container curve at surprisingly modest sustained traffic. A function invoked continuously is not cheap: it is a container with worse ergonomics and a per-request markup. Lambda earns its keep on the gaps between the peaks, not on the peaks.

Choose Lambda for event processing, glue between services, scheduled work, and APIs whose traffic is genuinely intermittent.

## The decision matrix

| | ECS/Fargate | EKS | Lambda |
|---|---|---|---|
| Traffic profile | steady to moderate | steady, many services | spiky, event-driven |
| Latency floor | container-level | container-level | cold starts unless mitigated |
| Ops effort | low | high | very low |
| Scales to zero | no | no (nodes) | yes |
| Best discount lever | Savings Plans, Spot | Karpenter, Spot, right-sizing | none needed (usage-based) |
| Fits a team of | 1–5 engineers | platform capacity available | any, for the right workload |

## The levers nobody looks at first

Once the runtime is settled, the largest savings usually sit somewhere else entirely:

- **Data transfer.** NAT gateway processing charges and cross-AZ traffic are the classic silent line items. A chatty service pair spread across availability zones can cost more in transfer than in compute. VPC endpoints for S3 and DynamoDB remove a surprising amount of NAT traffic.
- **Observability.** Log and metric ingestion at full fidelity can rival the compute bill. Sample traces, set retention deliberately, and drop debug logs at the source rather than storing and ignoring them.
- **Databases.** Managed database instances are frequently the largest single item and are usually sized for a peak that happened once. Right-size, and buy reserved capacity for the baseline.
- **Idle non-production environments.** Development and staging running 24/7 for a team that works 40 hours a week is roughly a 75 percent waste on those environments. A scheduled shutdown is an afternoon of work.

## How I would decide

Start with the traffic profile, not with the technology. Put the steady core on committed container capacity, the event-driven parts on Lambda, and anything interruptible on Spot. Pick EKS only if the number of services or the ecosystem requirements justify running a platform, and if you do, treat right-sizing and node consolidation as recurring work, not a one-off project.

Then instrument the bill the way you instrument the application. Cost is a non-functional requirement, and the teams that keep it under control are simply the ones who can see it.
