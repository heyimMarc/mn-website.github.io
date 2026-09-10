---
title: "CQRS Read Models on PostgreSQL"
date: 2026-11-23T09:00:00+02:00
draft: false
description: Building projections from an event stream, rebuilding them without downtime, living with eventual consistency in the UI, and knowing when a plain SQL view is enough and CQRS is overkill.
menu:
  sidebar:
    name: "CQRS Read Models on PostgreSQL"
    identifier: cqrs-read-models-postgresql
    weight: 21
tags: ["cqrs", "event-sourcing", "postgresql", "read-models", "projections"]
categories: ["backend"]
---

The event-sourced write side answers "what happened and in what order." Almost nobody wants to query that directly for anything a UI needs to render, and trying to is how you end up replaying an aggregate's entire event history to answer "list open orders for this customer" on every page load. That's what read models are for. On the platform I work on, the write side is event-sourced on PostgreSQL, and the read side is a set of purpose-built projections (plain tables, kept current by consumers of the same event stream) that exist purely to answer specific queries fast.

## A projection is a consumer, not a view

The instinct coming from a normalized-schema background is to reach for a SQL view or materialized view over the event table. That works for genuinely simple cases, and I'll get to when it's the right call. For anything with real query shape requirements, a projection is better modeled as an ordinary event consumer that maintains its own table:

```java
@Singleton
public class OpenOrdersProjection {

    private final JdbcOperations jdbc;

    @EventListener
    void on(OrderPlaced event) {
        jdbc.update("""
            INSERT INTO read_open_orders (order_id, customer_id, status, placed_at, total)
            VALUES (?, ?, 'OPEN', ?, ?)
            """, event.orderId(), event.customerId(), event.occurredAt(), event.total());
    }

    @EventListener
    void on(OrderShipped event) {
        jdbc.update("""
            DELETE FROM read_open_orders WHERE order_id = ?
            """, event.orderId());
    }

    @EventListener
    void on(OrderCancelled event) {
        jdbc.update("""
            DELETE FROM read_open_orders WHERE order_id = ?
            """, event.orderId());
    }
}
```

`read_open_orders` is a normal table with normal indexes, tuned for exactly the query the UI issues: "open orders for customer X, newest first." No join against the event store at read time, no replay, no ORM mapping layer translating events into a domain object just to throw it away after rendering a list row. The query that hits this table at request time is as boring as SQL gets, which is the entire point: all the complexity moves to write time, where it happens once per event, not to read time, where it would happen once per request.

## Rebuilding without taking anything down

Projections get rebuilt more often than people expect going in: a new column the UI needs, a bug in the projection logic, a new read model entirely for a feature that didn't exist when the event stream started. Because the projection is fully derived from the event log, rebuilding it is mechanically simple: replay the stream from the beginning into a fresh table, then cut over. The part that takes care is doing that without a downtime window or an inconsistent read during the switch.

The pattern that's worked reliably is blue-green at the table level:

```sql
CREATE TABLE read_open_orders_v2 (LIKE read_open_orders INCLUDING ALL);
```

1. Create the new table (or new version of the schema) alongside the old one.
2. Start a rebuild consumer that replays the full event stream from offset zero into the new table, tagged with a distinct consumer group so it doesn't interfere with the live projection still serving reads from the old table.
3. Once the rebuild consumer catches up to the current stream position, keep both consumers running briefly, both processing new events, so the new table stays current with the old one.
4. Atomically swap: `ALTER TABLE read_open_orders RENAME TO read_open_orders_old; ALTER TABLE read_open_orders_v2 RENAME TO read_open_orders;` inside a single transaction.
5. Drop the old table and retire the old consumer once you're confident nothing is still reading from it.

Step 3 is not optional, and "once the rebuild catches up" needs a real definition, not an eyeballed one. A dashboard's lag metric has a polling interval, and "lag looks like zero on the dashboard" is not the same fact as "the offsets actually match right now": treating the former as good enough to trigger a cutover is a reliable way to drop events in the gap between polls. The rebuild consumer and the live consumer both need to keep processing until the rebuild consumer's committed offset matches the live consumer's committed offset *exactly*, checked by query, not by watching a graph, and only then should the swap happen.

## Eventual consistency is a UI decision, not just an infrastructure fact

Projections are eventually consistent with the write side by design: there's a gap, usually milliseconds, occasionally longer under load, between an event being appended and a projection reflecting it. That gap is a fact of the architecture, but *what to do about it* is a UI and API design decision that has to be made deliberately, not discovered by a confused user filing a bug report.

The pattern that's worked for us: commands return the resulting event's stream position (or a monotonic version number) in their response, and if the UI navigates immediately to a view backed by a projection that might not have caught up yet, it can pass that position along and the read API can wait, briefly and with a short timeout, for the projection to reach at least that position before responding.

```java
@Get("/orders/{orderId}")
HttpResponse<OrderView> getOrder(String orderId,
                                   @QueryValue Optional<Long> minVersion) {
    if (minVersion.isPresent()) {
        projectionTracker.awaitVersion("read_open_orders", minVersion.get(),
            Duration.ofMillis(500));
    }
    return HttpResponse.ok(readRepository.findById(orderId));
}
```

This isn't strong consistency: after 500ms it gives up and returns whatever it has, which is the right trade-off for a UI, not a financial ledger. It just closes the specific, common gap where a user submits a form and is immediately redirected to a page that hasn't caught up yet, which is the eventual-consistency failure mode that actually generates support tickets. For everything else (a dashboard, a list view opened independently of any recent action), plain eventual consistency with a short-lived stale read is fine and nobody notices.

## When a plain SQL view is enough

CQRS read models earn their complexity when the query shape genuinely diverges from the write model, when you need denormalization across aggregates for a single view, or when read volume is high enough that avoiding a join or an event replay at request time actually matters. A lot of internal tooling and low-traffic admin screens don't meet that bar. For those, a materialized view over the event store, refreshed on a schedule or on demand, is the right amount of engineering:

```sql
CREATE MATERIALIZED VIEW admin_order_summary AS
SELECT customer_id, count(*) AS total_orders, sum(total) AS lifetime_value
FROM events
WHERE event_type = 'OrderPlaced'
GROUP BY customer_id;

REFRESH MATERIALIZED VIEW CONCURRENTLY admin_order_summary;
```

No consumer to run, no rebuild procedure to script, no eventual-consistency story to explain to a stakeholder: just a `REFRESH` on a cron schedule, acceptable for a screen three internal users check twice a day. The mistake to avoid is applying the full projection-as-consumer machinery to every read path by default because it's the pattern you know. Match the mechanism to the query's actual latency and freshness requirements, and reserve the event-consumer projection pattern for the read paths where the added operational complexity is actually buying you something, usually customer-facing, high-traffic, or genuinely shaped differently from the write model. Everywhere else, a view is not a compromise; it's the correct amount of architecture.
