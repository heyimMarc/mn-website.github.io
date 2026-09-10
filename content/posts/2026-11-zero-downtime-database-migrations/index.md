---
title: "Zero-Downtime Schema Migrations: The Expand/Contract Pattern in Practice"
date: 2026-12-07T09:00:00+01:00
draft: false
description: How to run backwards-compatible schema migrations with Flyway using expand/contract, and why event-sourced systems make the problem both easier and harder.
menu:
  sidebar:
    name: "Zero-Downtime Migrations"
    identifier: zero-downtime-database-migrations
    weight: 23
tags: ["postgresql", "flyway", "migrations", "backend"]
categories: ["backend"]
---

Every zero-downtime migration horror story starts the same way: someone deployed a schema change and an application change in the same release, and for the duration of the rollout there was a window where old application instances ran against the new schema, or new instances ran against the old one. Rolling deploys guarantee this window exists. The only question is whether your schema change survives it.

The expand/contract pattern is the answer, and it's less exotic than it sounds. You split every schema change that isn't purely additive into three separate deploys: expand the schema to support both old and new shapes, migrate the application to use the new shape while the schema still supports the old one, then contract the schema by dropping what's no longer needed. Each of the three steps is independently safe to roll forward or back.

## Renaming a column, the boring but correct way

Take the classic case: renaming `customer_email` to `contact_email`. The tempting one-step migration is a `RENAME COLUMN`. Don't. The instant that migration runs, every application instance still running the previous release starts failing on every query that references `customer_email`, and with a rolling deploy that's not a hypothetical: it's guaranteed for however long the rollout takes.

Expand phase (add the new column, backfill it, keep both in sync):

```sql
-- V10__add_contact_email.sql
ALTER TABLE customers ADD COLUMN contact_email VARCHAR(255);
UPDATE customers SET contact_email = customer_email WHERE contact_email IS NULL;

CREATE OR REPLACE FUNCTION sync_contact_email() RETURNS TRIGGER AS $$
BEGIN
  NEW.contact_email := NEW.customer_email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_contact_email
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION sync_contact_email();
```

Deploy the application change that reads and writes `contact_email` instead of `customer_email`. Old instances keep working because `customer_email` still exists and the trigger keeps it populated for any code path you missed. Once the rollout completes and you're confident nothing references the old column (grep the codebase, check any raw SQL reports or BI queries someone built against it), contract:

```sql
-- V11__drop_customer_email.sql
DROP TRIGGER trg_sync_contact_email ON customers;
DROP FUNCTION sync_contact_email();
ALTER TABLE customers DROP COLUMN customer_email;
```

Three migrations for what looks like a one-line rename, and at no point does a running application instance query a column that doesn't exist. It's more Flyway files than a rename deserves, and that's exactly the point: the ceremony is the safety.

## Adding a NOT NULL constraint without locking the table

The same pattern applies to constraints. `ALTER TABLE x ADD COLUMN y NOT NULL DEFAULT 'foo'` looks harmless, but on older Postgres versions (and on very large tables even on newer ones where the default requires a rewrite), it can take an access-exclusive lock for the duration of a full table rewrite. Expand with a nullable column and a `CHECK` constraint added `NOT VALID`:

```sql
ALTER TABLE orders ADD COLUMN status VARCHAR(20);
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IS NOT NULL) NOT VALID;
```

`NOT VALID` means the constraint applies to new and updated rows immediately without scanning the whole table, and without holding a long lock. Backfill in batches, then validate separately:

```sql
ALTER TABLE orders VALIDATE CONSTRAINT orders_status_check;
```

`VALIDATE CONSTRAINT` takes a much lighter lock than the full rewrite would, because it only needs to confirm existing rows satisfy the constraint, not rebuild the table.

## Flyway's role, and its limits

Flyway is good at exactly one thing: making sure migrations run in order, exactly once, and that the applied state is recorded so you know what's been run where. It has no opinion on whether a migration is backwards-compatible: that discipline is entirely on the person writing the migration file. I've used Liquibase on other projects, and the tooling difference doesn't matter much here; the expand/contract discipline is a practice, not a Flyway feature, and it transfers unchanged.

One thing that does matter across both tools: never let a migration tool run `DROP` or destructive `ALTER` statements automatically as part of a routine deploy pipeline without a human reviewing the specific SQL. Migration file review deserves the same scrutiny as the application code it supports, arguably more, because a bad migration doesn't roll back the way a bad application deploy does.

## Event stores: easier and harder at once

Event-sourced systems have a strange relationship with this problem. On one hand, the event store itself is close to immutable: you're appending events, not updating rows in place, so most of the classic "in-place schema change under load" problems don't apply to the event table at all. You're not renaming columns on a table that fifty code paths mutate concurrently; you're appending to a log.

On the other hand, the event store must never break, which raises the stakes on the migrations that do touch it. Adding a new event type is trivial: it's just a new discriminator value and a new deserialization case, fully additive. But changing the shape of an existing event (adding a field that old events don't have, renaming a property in the payload) means your deserialization code has to handle every historical version of that event forever, because you cannot migrate history the way you'd migrate a mutable table. There's no `UPDATE` that rewrites years of stored events without risking the one thing the event store exists to guarantee: that replaying it reproduces the same state it always has.

The read-model projections built from those events are a different story again: they're regular tables, rebuildable from the event stream, and you can apply expand/contract to them freely, or in the extreme case just drop a projection table and replay it from scratch. That replayability is the actual advantage event sourcing gives you for migrations: worst case, you nuke a projection and rebuild it, something you'd never dare do with a system-of-record table holding the only copy of the truth. It doesn't make schema changes to the event payloads themselves any less permanent: if anything it raises the bar for getting the event schema right up front, because "we'll just migrate it later" isn't a backstop that exists for the append log the way it does for everything downstream of it.
