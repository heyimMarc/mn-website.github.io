---
title: "Running Kafka Yourself: What Strimzi Actually Buys You"
date: 2026-11-23T09:00:00+01:00
draft: true
description: What the Strimzi operator does for self-hosted Kafka on Kubernetes, where it still leaves you exposed, and when paying for managed Kafka is the right call.
menu:
  sidebar:
    name: "Kafka via Strimzi"
    identifier: kafka-strimzi-self-hosted-lessons
    weight: 21
tags: ["kafka", "kubernetes", "strimzi", "devops"]
categories: ["devops"]
---

Running Kafka on your own Kubernetes cluster sounds like a bad idea until you've priced out managed alternatives for a side project with irregular traffic and a budget that rounds to zero. That's roughly how I ended up running Kafka through Strimzi on a self-hosted cluster for a SaaS side project I co-founded. It works. It also taught me exactly how much of "just use Kafka" was actually "just use somebody else's ops team."

## What the operator gives you

Strimzi's pitch is that it turns Kafka administration into Kubernetes custom resources. Instead of SSHing into brokers and editing server.properties, you declare a `Kafka` resource with the number of brokers, storage class, and listener configuration, and the operator reconciles the StatefulSets, ConfigMaps, and Services to match. Topics become `KafkaTopic` resources. Users and their ACLs become `KafkaUser` resources. It's Kubernetes-native, GitOps-friendly, and it removes an entire category of manual, error-prone broker configuration.

A minimal cluster declaration looks roughly like this:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    version: 3.7.0
    replicas: 3
    listeners:
      - name: tls
        port: 9093
        type: internal
        tls: true
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      min.insync.replicas: 2
    storage:
      type: jbod
      volumes:
        - id: 0
          type: persistent-claim
          size: 100Gi
          class: fast-ssd
  zookeeper:
    replicas: 3
    storage:
      type: persistent-claim
      size: 20Gi
      class: fast-ssd
```

Topics and users get the same declarative treatment:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: orders-events
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 6
  replicas: 3
  config:
    retention.ms: 604800000
    cleanup.policy: delete
```

Check these into Git, let ArgoCD or Flux apply them, and topic sprawl stops being a tribal-knowledge problem. Nobody has to remember which broker to SSH into to check whether a topic exists: you grep the repo. That alone is worth the operator's learning curve.

The operator also handles rolling updates competently. Change a broker config that requires a restart, and Strimzi cycles brokers one at a time, waiting for the ISR to catch up before touching the next one. Watching that happen correctly, on a cluster you didn't hand-script the rollout logic for, is the moment the value of "Kafka as CRDs" clicks.

## Where it still bites

The operator abstracts configuration, not physics. Storage is the sharpest edge. Kafka brokers are stateful, and Strimzi provisions each broker's storage as a PersistentVolumeClaim. Resizing that storage later depends entirely on whether your storage class supports volume expansion. If it doesn't, you're looking at adding a broker with more storage and reassigning partitions rather than a quick `kubectl edit`. Plan retention and disk sizing conservatively from day one, because "just resize it" is not a given on self-hosted CSI drivers the way it might be on a cloud-managed disk.

Version upgrades are the other place the abstraction leaks. Strimzi handles the mechanics of a rolling upgrade, but it doesn't absolve you of reading the Kafka release notes. Upgrading across a Kafka version that changes the inter-broker protocol requires a two-phase rollout: bump the operator and images first while keeping `inter.broker.protocol.version` pinned to the old value, verify the cluster is healthy, then bump the protocol version in a second pass. Skip the two-phase approach and you can end up with a cluster that's technically running the new binaries but arguing with itself about message formats. The operator will let you do this wrong; it just won't stop you.

ZooKeeper-to-KRaft migration is its own project, not a config flag, even though newer Strimzi versions support it. If you're running an older cluster, budget real time for it rather than treating it as a version bump.

And then there's the mundane stuff nobody puts in the marketing material: cert rotation for internal TLS listeners, JVM heap tuning for brokers that are memory-starved because the node they landed on also runs three other workloads, and the fact that `KafkaUser` ACL changes take a moment to propagate through the User Operator reconciliation loop, which is invisible right up until a client gets an authorization error it shouldn't.

## The actual lesson

The honest failure mode with self-hosted Kafka isn't that it breaks constantly: it doesn't, once it's configured correctly. It's that the operational surface area you're responsible for is larger than the CRD abstraction suggests, and most of that surface area is invisible until the day it matters: an upgrade, a full disk, a network partition between brokers during a node drain. Strimzi removes the toil of day-to-day topic and user management. It does not remove the need to understand replication factors, ISR semantics, and what happens when `min.insync.replicas` can't be satisfied because a broker is down for maintenance you scheduled without checking quorum first.

If your Kafka usage is genuinely small (a handful of topics, moderate throughput, no compliance requirement forcing self-hosting), the calculus tips toward managed Kafka pretty quickly. The managed price tag covers someone else having already made the storage-class and upgrade-path mistakes so you don't have to. For a side project, I ran self-hosted because the cost of my own time investigating broker internals doubled as the cost of learning Kafka properly, and that trade was worth it. For a production system on someone else's revenue clock, I'd want a much stronger reason than "it's cheaper on paper" before repeating that choice: the paper doesn't count the hours spent reading KIP documents to understand why a rolling restart stalled on ISR shrinkage.

Strimzi is a solid operator. It just operates on top of a stubbornly stateful, unforgiving distributed system, and no CRD changes that.
