---
title: "A Legacy Modernization Playbook That Respects the Legacy"
date: 2027-01-18T09:00:00+01:00
draft: true
description: Strangler fig with a real service layer, an anti-corruption layer against SAP and legacy work orders, and when event sourcing is worth the cost.
menu:
  sidebar:
    name: "Modernization Playbook"
    identifier: legacy-modernization-playbook
    weight: 29
tags: ["architecture", "legacy-modernization", "strangler-fig", "event-sourcing", "domain-driven-design"]
categories: ["architecture"]
---

Every modernization project I've worked on started with someone wanting to rewrite the legacy system, and none of them ended with a rewrite. What they ended with (the ones that shipped, anyway) was a service layer in front of the legacy application that let new consumers integrate against a modern API while the legacy system kept doing what it had done for years underneath. The rewrite fantasy is seductive because the legacy code is usually genuinely bad. It's also almost always the wrong first move, because a full rewrite defers every bit of value to a "big bang" cutover date that keeps slipping, while the business keeps needing new integrations built against the old system in the meantime.

## Strangler fig starts with a wrapper, not a replacement

The pattern that actually works is the strangler fig: put a service layer in front of the legacy system that exposes a clean, modern API, and route new consumers through it. The legacy system doesn't know or care that it has a new front door: the service layer translates. Nothing about the legacy internals changes on day one. What changes is that anyone building something new is now insulated from having to speak the legacy system's dialect.

```java
@Controller("/api/work-orders")
public class WorkOrderController {

    private final LegacyWorkOrderGateway legacyGateway;

    @Get("/{id}")
    public WorkOrderDto get(String id) {
        LegacyWorkOrderRecord raw = legacyGateway.fetch(id);
        return WorkOrderMapper.toModernDto(raw);
    }
}
```

The `WorkOrderMapper` is doing unglamorous but essential work: translating field names, status codes, and unit conventions from a system designed for a mainframe operator in the 1990s into something a modern client can consume without knowing that history exists. This is the whole trick of the strangler fig: the translation lives in one place, at the boundary, instead of being copy-pasted into every new consumer that has to deal with the legacy quirks directly.

Slicing the migration matters here as much as the pattern itself. The projects that delivered value early picked one bounded capability (read-only work order lookup, say), stood up the service layer for just that, and shipped it before touching anything else. The projects that stalled tried to design the complete target API surface up front, which meant nothing shipped until the whole design was agreed, and the legacy system kept being the only way to get anything done in the meantime.

## An anti-corruption layer is the same idea turned inward

Where the service layer protects new consumers from the legacy system's shape, an anti-corruption layer (ACL) protects your new domain model from the legacy system's shape when you're integrating in the other direction: pulling data or events from something like SAP or a legacy work-order system into a domain you're actively trying to keep clean.

The instinct to avoid is letting the external system's vocabulary leak into your domain model because it's faster to just reuse the field names you already have in an XML payload or an IDoc. It is faster, for about two sprints, and then your domain model has three different status enums because SAP's status codes don't map cleanly onto any single concept your business actually reasons about.

```java
public class SapWorkOrderAdapter {

    public DomainWorkOrder translate(SapIDoc idoc) {
        return new DomainWorkOrder(
            WorkOrderId.of(idoc.getOrderNumber()),
            mapStatus(idoc.getStatusCode()),
            mapPriority(idoc.getPriorityFlag())
        );
    }

    private WorkOrderStatus mapStatus(String sapStatusCode) {
        return switch (sapStatusCode) {
            case "I0001", "I0002" -> WorkOrderStatus.OPEN;
            case "I0045" -> WorkOrderStatus.IN_PROGRESS;
            case "I0100", "I0101" -> WorkOrderStatus.CLOSED;
            default -> throw new UnmappedSapStatusException(sapStatusCode);
        };
    }
}
```

The `UnmappedSapStatusException` at the bottom is the actual point of the exercise. An ACL that silently defaults unknown codes to something reasonable-looking will hide a legacy system change until it causes a business-logic bug three layers away, in code that has no idea an external system's enum grew a new value. Fail loudly at the boundary, where the person on call has a chance of connecting the failure to its actual cause.

## Event sourcing pays for itself sometimes, not always

I've built one greenfield replacement for a legacy process using event sourcing, and I'd make the same choice again for that specific case, though I'd hesitate hard before reaching for it generally. The case where it earned its cost had two things going for it: the business genuinely needed an audit trail of every state transition for compliance reasons, and the domain had enough conditional workflow logic that a naive CRUD model would have needed a parallel audit-log table anyway, hand-maintained and inevitably out of sync with the actual state.

Event sourcing made the audit trail the source of truth instead of a side effect somebody has to remember to write. It also made certain kinds of "what actually happened here" support questions trivial to answer, because the event stream *is* the answer. That's a genuine, durable advantage in the right domain.

It is overkill everywhere else. If nobody's asking "what was the state of this record last Tuesday and how did it get there," you're paying the complexity cost of event sourcing: the projections, the eventual consistency, the replay logic, the steeper onboarding curve for every new engineer, for a benefit nobody needs. The honest failure mode of event sourcing on a project isn't that it doesn't work; it's that a team adopts it because it's the more interesting architecture, applies it to a domain that's genuinely just a CRUD resource with a status field, and spends the next year explaining eventual consistency edge cases to confused stakeholders who just wanted to update a record and see the update.

The test I use now: does someone outside engineering actually need history, not just current state? If yes, and the workflow has real branching complexity, event sourcing is a legitimate tool. If the honest answer is "it would be nice to have," a `updated_at` column and a simple audit table cost a fraction of the complexity and cover the same actual business need.

## Slices that ship, not a plan that's complete

What connects strangler fig, ACL, and selective event sourcing is that each one lets you deliver value in slices instead of waiting for a single cutover. A service layer in front of one bounded legacy capability ships in weeks and immediately unblocks new integration work. An ACL around one external system's data shape ships before you've decided what to do with the rest of the legacy estate. Even event sourcing, when it's the right call, gets adopted for the one workflow that needs it rather than as a blanket architectural mandate for a whole system.

The legacy system, meanwhile, keeps running, and that's the actual strategy, not a compromise anyone's making reluctantly. The parts of the old system nobody's touched in years are probably fine as they are. What matters is that it stops being the only way to get new work done, one slice at a time, until there's less of it left to strangle.
