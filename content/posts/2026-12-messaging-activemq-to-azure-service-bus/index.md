---
title: "From ActiveMQ to Azure Service Bus: What Maps and What Doesn't"
date: 2026-12-14T09:00:00+01:00
draft: false
description: A practitioner's comparison of JMS/ActiveMQ and Azure Service Bus, where the concepts translate cleanly, and where transactions and redelivery semantics quietly diverge.
menu:
  sidebar:
    name: "ActiveMQ to Service Bus"
    identifier: messaging-activemq-to-azure-service-bus
    weight: 24
tags: ["azure", "service-bus", "jms", "activemq", "backend"]
categories: ["backend"]
---

Moving a messaging-dependent system from on-premise JMS/ActiveMQ to Azure Service Bus feels, for the first week, like a straightforward vocabulary swap: queues for queues, topics for topics. Then you hit a production incident involving a redelivered message that shouldn't have been redelivered, and you realize the vocabulary swap was hiding a semantics swap underneath it.

## What maps cleanly

The basic messaging model translates well. A JMS queue and a Service Bus queue both give you point-to-point delivery with a single consumer (or competing consumers) draining messages. JMS topics with durable subscribers map onto Service Bus topics with subscriptions reasonably directly: each subscription gets its own copy of every message published to the topic, filtered by SQL-like subscription rules if you want, which is a closer analog to JMS message selectors than I expected going in.

Dead-letter handling is another place the concepts line up. Both platforms have the idea of a message that's failed processing too many times getting shunted to a separate destination for inspection rather than looping forever. The configuration surface differs (Service Bus has `MaxDeliveryCount` as a queue-level property, ActiveMQ typically wires this through redelivery policies and dead-letter strategy), but the operational pattern of "have someone or something watch the DLQ" is identical.

Message properties and headers map fine too. Service Bus's `ApplicationProperties` dictionary plays the same role as JMS custom properties, and if you're using a message envelope pattern (wrapping your domain payload in a type with metadata like correlation ID, message type, and schema version), that pattern is untouched by the platform swap. If anything, this is where I'd tell anyone starting a migration to invest first: an envelope and an abstraction layer around the messaging client, so the domain code sends and receives your envelope type and doesn't know or care whether the underlying SDK is `javax.jms` or `azure-messaging-servicebus`.

## Where it does not

Transactions are the first real crack. JMS gives you session-level transactions where you can receive a message, do database work, and commit or roll back the receive along with the database transaction: genuine two-phase-commit-adjacent behavior when your broker and resource manager cooperate, or at minimum a local transaction that ties message acknowledgment to your unit of work. Service Bus supports transactions too, but they're scoped differently: a Service Bus transaction can group multiple operations against the *same* entity or entities within the same transfer scope, but it does not give you a JTA-style distributed transaction spanning your database and the message broker the way some JMS setups did. If your ActiveMQ-era code relied on "the message only gets acknowledged if the database commit succeeds, atomically, via the transaction manager," you need to re-architect that as an outbox pattern on Service Bus: write the outgoing message intent to your own database table in the same local transaction as your business change, then have a separate process reliably publish from the outbox. It's more moving parts, but it's also a pattern that ages better regardless of broker, because it doesn't depend on distributed transaction coordination working correctly under failure, which is a bug class that's hard to test and easy to get subtly wrong.

Redelivery semantics are the second, subtler crack, and the one that actually caused confusion on a migration I worked. JMS redelivery is typically session- and consumer-scoped: if a consumer crashes without acknowledging, the broker redelivers, and depending on configuration you get a `JMSRedelivered` flag and a redelivery count you can inspect. Service Bus's model is lock-based: when a consumer receives a message in `PeekLock` mode, the message is invisible to other consumers for a lock duration, and if the consumer doesn't complete, abandon, or renew the lock within that window, the message becomes visible again and delivery count increments. The practical trap is lock duration versus processing time. A message handler that legitimately takes longer than the configured lock duration (because it's calling a slow downstream API, say) will have its lock expire mid-processing, and the message becomes available to another consumer while the first one is still working on it. You now have two consumers processing the same logical message concurrently, which your JMS-era idempotency assumptions may not have been built to handle because ActiveMQ's default configurations made this scenario rarer in practice.

```csharp
// Renewing the lock explicitly for long-running handlers
await using var receiver = client.CreateReceiver(queueName);
var message = await receiver.ReceiveMessageAsync();

using var cts = new CancellationTokenSource();
var renewalTask = RenewLockPeriodically(receiver, message, cts.Token);

try
{
    await ProcessLongRunningWork(message);
    await receiver.CompleteMessageAsync(message);
}
finally
{
    cts.Cancel();
}
```

The fix is either renewing the lock proactively for long handlers, as above, or (better) making handlers idempotent regardless of transport, which you should be doing anyway. The classic failure mode here isn't a Service Bus bug, it's an implicit assumption from the old platform ("redelivery is rare enough that at-least-once is basically at-most-once in practice") getting exposed the moment the underlying delivery mechanics change shape.

## The abstraction layer that actually helped

The thing that made this migration tolerable was resisting the urge to let Service Bus SDK types leak into domain code. A thin interface (`MessagePublisher.publish(Envelope)` and `MessageConsumer.subscribe(handler)`) with a JMS-backed implementation and later a Service-Bus-backed implementation meant the migration was contained to the infrastructure layer. The domain and application layers never imported `azure-messaging-servicebus` directly. This isn't a novel idea, it's just ports-and-adapters applied to messaging instead of to the database, but it's the single decision that turned "migrate the messaging platform" from a rewrite into a swap of one adapter for another, with the transaction and redelivery differences surfaced explicitly in the new adapter's contract rather than scattered across every consumer that happened to touch a queue.

If there's one thing worth doing before touching the SDK calls themselves, it's writing down (explicitly, in a doc, not just in your head) every place the old code relied on JMS transactional or redelivery behavior that isn't guaranteed by the interface you're about to swap in. Those assumptions are invisible until the new platform's honest differences make them visible in production.
