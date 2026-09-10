---
title: "Running Self-Hosted Kubernetes for a Bootstrapped SaaS"
date: 2026-11-09T09:00:00+02:00
draft: false
description: Operators for Postgres, Kafka and MinIO, Traefik and cert-manager for ingress and TLS, and an honest cost comparison against managed cloud, what running your own cluster actually gets you and what it costs in attention.
menu:
  sidebar:
    name: "Self-Hosted Kubernetes for a Bootstrapped SaaS"
    identifier: self-hosted-kubernetes-bootstrap-saas
    weight: 19
tags: ["kubernetes", "self-hosted", "postgres-operator", "strimzi", "minio", "traefik", "cert-manager"]
categories: ["devops"]
---

Running your own Kubernetes cluster for a SaaS product without a platform team is a decision people either treat as obviously reckless or don't think about at all. On the side project I co-founded, we picked it deliberately, with a full accounting of what we were giving up, because the alternative, managed everything on a hyperscaler priced for a product with three paying customers, didn't make financial sense at our stage. Two years in, I'd make the same call again, with a couple of adjustments.

## The operator pattern is what makes this viable

Self-hosting Postgres, Kafka and object storage by hand-rolling StatefulSets is a bad idea: you'd be reimplementing failover, backup scheduling and credential rotation badly, in YAML, under time pressure during an incident. Operators exist specifically so you don't do that. We run:

- **A Postgres operator** for PostgreSQL: handles replication, automated failover, and scheduled base backups plus WAL archiving to object storage.
- **Strimzi** for Kafka: manages broker StatefulSets, topic and user reconciliation via CRDs, and TLS between broker and client.
- **MinIO Operator** for S3-compatible object storage: used both as the Postgres backup target and as application-level blob storage.

```yaml
apiVersion: postgresql.example.io/v1
kind: PostgresCluster
metadata:
  name: orders-db
spec:
  instances: 3
  postgresql:
    parameters:
      max_connections: "200"
      shared_buffers: "1GB"
  storage:
    size: 50Gi
    storageClass: local-path-retain
  backup:
    destination:
      path: s3://pg-backups/orders-db
      endpoint: https://minio.internal:9000
      credentialsSecretRef: minio-creds
    retentionPolicy: "30d"
```

The point of the CRD is that "3 instances, automated failover, nightly backups to MinIO with 30-day retention" is a declarative fact checked into Git, not a runbook. When a node holding a Postgres replica dies, the operator promotes another replica and reprovisions the missing one, and we find out from an alert firing on the *event*, not from a page asking someone to manually run `pg_ctl promote`.

## Ingress and TLS: Traefik and cert-manager

Traefik as the ingress controller was an easy choice mainly because its Kubernetes CRD-based `IngressRoute` configuration is more expressive than plain `Ingress` objects for things like path-based middleware chains (rate limiting, auth forwarding) without needing controller-specific annotation soup. cert-manager handles TLS issuance against Let's Encrypt with a `ClusterIssuer`, and the combination means TLS certificate expiry has not been an incident category for us since the first month of setup.

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            class: traefik
```

## The real cost comparison

The honest version of this comparison has to include labor, not just infrastructure line items, because labor is where self-hosting's real cost lives.

**Infrastructure, monthly, for our workload** (3-node cluster, roughly 200GB Postgres data, moderate Kafka throughput): a handful of dedicated servers at a hosting provider plus object storage for backups, all in for a low three-digit monthly bill. The equivalent managed stack (managed Kubernetes, managed Postgres, managed Kafka, managed object storage, sized to match) runs a small multiple of that, and managed Kafka is usually the line item that moves the comparison the most, since self-hosted Strimzi on existing nodes costs nothing extra beyond the compute it already needed.

That's a genuinely large gap, and at the revenue we were at when we made this decision, it was the difference between the infrastructure bill being a rounding error and it being a meaningful chunk of what we could otherwise spend on the second engineer.

**What that gap doesn't include**: the time spent keeping the cluster itself healthy. Kubernetes version upgrades, node OS patching, operator upgrades (Strimzi's Kafka version bumps in particular need to be sequenced carefully: broker protocol version, then client compatibility, then the actual binary upgrade), and the occasional afternoon lost to a CNI or storage-class quirk that a managed provider would have hidden. We budget roughly half a day a month to cluster maintenance in a quiet month, and it has occasionally eaten two full days in a bad one: underprovisioned local storage is the recurring offender, and it's taught us to size storage classes with real headroom, not the workload's steady-state number.

## What you give up

This is the part people gloss over. Self-hosting Kubernetes on your own servers means:

- **No managed control plane SLA.** If the control plane has a bad day, that's your bad day, at 2am, without a support ticket to escalate.
- **You own the upgrade path end to end.** A managed Postgres service handles minor version patching for you; a self-hosted operator will roll a minor version upgrade if you tell it to, but you're the one deciding when, and you're the one who reads the release notes for a behavioral change that might matter.
- **No cross-region managed failover.** We run a single region. A regional outage at our hosting provider is an outage for us, full stop: a trade-off that would be unacceptable for a service with an uptime SLA in the contract, and one we were explicit with early customers about not having.
- **Backups are your discipline, not a checkbox.** The operator automates the mechanics, but restore testing (actually spinning up a cluster from a backup and verifying the data) is still a task a human has to schedule and not skip. We test a restore quarterly, and the first run is always the one that surfaces an assumption about retention windows or timing you hadn't actually verified until you needed it. That's exactly the kind of gap a managed service's SLA would have made someone else's problem.

## The actual decision rule

Self-hosting made sense for us because we had the Kubernetes and operator experience already, from running production clusters in a day job, and because the infrastructure savings were large relative to our revenue at the time. If either of those weren't true (no in-house Kubernetes operations experience, or a cost delta too small to matter against engineering time spent maintaining the cluster), I'd take managed services without hesitation, and revisit the decision once the numbers or the team change. Self-hosted Kubernetes is not a badge of technical seriousness; it's a lever you pull when the trade genuinely favors you, and you should be able to state, in specific numbers, why it does.
