---
title: "Testing Event-Sourced Services: The Pyramid, Testcontainers, and What Not to Test"
date: 2026-10-19T09:00:00+02:00
draft: false
description: How we test an event-sourced platform without drowning in brittle tests, covering the shape of the pyramid, Testcontainers for the real event store, Cucumber and REST Assured for end-to-end business processes, and the tests we deliberately do not write.
menu:
  sidebar:
    name: "Testing Event-Sourced Services"
    identifier: testing-event-sourced-services
    weight: 16
tags: ["testing", "event-sourcing", "junit5", "testcontainers", "cucumber", "java"]
categories: ["backend"]
---

Event sourcing changes what a test needs to assert. In a CRUD service, a test typically checks the state of a row after an operation. In an event-sourced service, the interesting assertion is usually about the event that got produced (its type, its payload, its causal metadata) because the event is the actual output of the domain, and the row is just one of possibly several downstream projections of it. Get that mental shift wrong and you end up writing tests that assert on read-model tables that happen to be a proxy for the real behavior, and those tests break every time a projection is refactored even though the domain behavior did not change.

## The shape of the pyramid, adjusted for the domain

We still run a conventional pyramid (many unit tests, fewer integration tests, a handful of end-to-end tests), but the boundaries between the layers shifted compared to a typical CRUD service.

**Unit tests** operate purely on aggregates, with no infrastructure at all. Given a sequence of events, apply a command, assert on the events produced:

```java
@Test
void recalibratingDecommissionedDeviceIsRejected() {
    MeteringDevice device = MeteringDevice.rehydrate(List.of(
        new DeviceInstalled(deviceId, unitId, Instant.now()),
        new DeviceDecommissioned(deviceId, Instant.now())
    ));

    assertThatThrownBy(() -> device.recalibrate(new CalibrationReading(TEN, KWH)))
        .isInstanceOf(DeviceDecommissionedException.class);
}

@Test
void recalibrationProducesExpectedEvent() {
    MeteringDevice device = MeteringDevice.rehydrate(List.of(
        new DeviceInstalled(deviceId, unitId, Instant.now())
    ));

    device.recalibrate(new CalibrationReading(TEN, KWH));

    assertThat(device.uncommittedEvents())
        .singleElement()
        .isInstanceOf(DeviceRecalibrated.class)
        .extracting("calibrationValue")
        .isEqualTo(TEN);
}
```

This is the given-when-then structure most event-sourcing tutorials show, and it earns its reputation: no database, no Spring context, runs in milliseconds, and reads as documentation of the business rule. This layer is where most of our test count lives, and it is the layer where Mockito is mostly unnecessary; aggregates in our domain do not depend on collaborators, by design.

**Integration tests** are where Testcontainers earns its keep. We do not mock the event store's persistence behavior, because the entire value of the store is its concurrency and constraint semantics, which an in-memory fake cannot faithfully reproduce:

```java
@Testcontainers
class PostgresEventStoreIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17")
        .withDatabaseName("eventstore_test");

    @Test
    void concurrentAppendsToSameStreamOnlyOneSucceeds() throws Exception {
        UUID streamId = UUID.randomUUID();
        eventStore.append(streamId, 0, new DeviceInstalled(streamId, unitId, Instant.now()));

        var attempt1 = CompletableFuture.runAsync(() ->
            eventStore.append(streamId, 1, someEvent()));
        var attempt2 = CompletableFuture.runAsync(() ->
            eventStore.append(streamId, 1, someOtherEvent()));

        var results = allOf(attempt1, attempt2).handle((r, ex) -> ex);
        assertThat(eventStore.readStream(streamId)).hasSize(2);
    }
}
```

That test exists because of a real bug: an early version of our optimistic concurrency handling used `SELECT MAX(stream_version)` followed by a separate INSERT instead of relying on the unique constraint at insert time: a textbook race condition that unit tests against a fake store never exercised, because the fake did not model the race at all. Testcontainers running actual PostgreSQL is what makes that class of regression visible in CI now, instead of only in production (more on how we found out the hard way, below). WireMock plays the equivalent role for our SAP OData and SOAP adapters, stubbing exact response shapes, including the malformed and null-heavy ones we now know SAP produces in production, so the Anti-Corruption Layer's defensive parsing is exercised against realistic wire payloads rather than idealized ones.

## BDD with Cucumber and REST Assured for the business process view

Unit and integration tests verify components. Neither verifies that a business process ("a work order arrives, a device gets recalibrated, the read model reflects it, a downstream notification fires") actually holds end to end, across the event store, projections, and API surface together. That is what our Cucumber and REST Assured suite is for, written in collaboration with the business analysts who actually understand the metering domain, not retrofitted by engineers after the fact:

```gherkin
Feature: Device recalibration

  Scenario: A valid work order recalibrates an active device
    Given a metering device "DEV-4471" installed on unit "UNIT-9002"
    When a recalibration work order for "DEV-4471" arrives with reading "128.4 kWh"
    Then the device "DEV-4471" has a recorded calibration of "128.4 kWh"
    And the calibration history for unit "UNIT-9002" contains 1 entry
```

```java
@When("a recalibration work order for {string} arrives with reading {string}")
public void recalibrationWorkOrderArrives(String deviceId, String reading) {
    serviceBusTestClient.send("legacy-work-orders", legacyWorkOrderFixture(deviceId, reading));
    await().atMost(5, SECONDS).until(() -> workOrderWasProcessed(deviceId));
}

@Then("the device {string} has a recorded calibration of {string}")
public void deviceHasCalibration(String deviceId, String expectedReading) {
    RestAssured.given()
        .when().get("/devices/{id}/calibrations/latest", deviceId)
        .then().statusCode(200)
        .body("value", equalTo(parseValue(expectedReading)))
        .body("unit", equalTo(parseUnit(expectedReading)));
}
```

These scenarios run against the full service (Testcontainers Postgres, an in-memory or containerized Service Bus emulator, the actual REST layer), and they are deliberately few in number, one or two per business process, covering the happy path and the one or two failure paths that matter commercially (decommissioned device, malformed work order). We resisted the temptation, early on, to write a Cucumber scenario for every validation rule; that just gives you slow, brittle unit tests wearing a business-readable costume.

## What we deliberately do not test

This is the part of the testing strategy I actually get asked about most, because the instinct on an event-sourced system is to over-test the mechanics.

We do not write end-to-end tests asserting on read-model table contents directly. Read models are disposable projections that get rebuilt by replaying events; testing their exact table schema in a Cucumber scenario means every projection refactor breaks business-readable tests that have nothing to do with the business rule they claim to verify. We assert through the API, which is the actual contract, and let the API test be agnostic to how the read model is stored underneath.

We do not unit test jMolecules-annotated structure or ArchUnit-covered layering rules with ordinary tests: that would duplicate what the architecture test suite already guarantees, for no additional signal.

We do not write integration tests for individual JSON Schema-generated event classes checking that field types match the schema. Contract-first generation makes that class of bug structurally impossible; a test for it would just be testing the code generator, which is someone else's job to test, not ours.

And we do not snapshot-test full event streams as golden files. Early on someone tried this (serialize the entire event sequence produced by a scenario and diff it against a stored golden file), and it produced the worst kind of flaky, high-maintenance test: any additive, backward-compatible field on any event, anywhere in the sequence, broke the golden file, so people started updating golden files without reading the diff. We deleted that suite. Assert on the specific events and specific fields a scenario cares about, nothing more.

## The one incident that reshaped this

Before we had the Testcontainers-based event store tests, we ran integration tests against an embedded H2 database configured in PostgreSQL compatibility mode, on the theory that it was "close enough" and much faster to start. It was close enough for schema, and not close enough for concurrency: H2's locking behavior under our optimistic-append pattern did not reproduce the race condition described above at all, so that suite was green while the actual bug shipped to production and caused a duplicate device-status event during a load spike. We now treat "close enough" database substitutes as a liability for anything testing concurrency or constraint behavior, and pay the extra few seconds of container startup gladly. The pyramid should be shaped by what actually needs verifying under realistic conditions, not by what is fastest to start.

The four Testcontainers patterns from this post live as a runnable project on GitHub: [testcontainers-quickstart](https://github.com/heyimMarc/testcontainers-quickstart).
