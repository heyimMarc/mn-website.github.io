---
title: "BDD That Product Owners Actually Read"
date: 2026-12-28T09:00:00+01:00
draft: true
description: Gherkin discipline for Cucumber suites that stay readable by non-engineers, how to avoid scenario explosion, and the difference between BDD as communication and BDD as test automation theater.
menu:
  sidebar:
    name: "BDD for Product Owners"
    identifier: bdd-cucumber-product-owners
    weight: 26
tags: ["bdd", "cucumber", "testing", "backend"]
categories: ["backend"]
---

Most Cucumber suites I've seen fail at the one thing Cucumber exists for: being readable by someone who isn't an engineer. The Gherkin is technically valid, the steps execute, the suite passes in CI, and not a single product owner has opened one of those feature files in months because reading them requires reverse-engineering what the step definitions actually do. That's BDD as test automation theater: Given/When/Then syntax wrapped around what is, underneath, ordinary integration test code, with none of the communication benefit BDD is supposed to provide.

The version that actually works, where a product owner reads a scenario and either nods or catches a mistake, requires discipline that has nothing to do with the tooling and everything to do with what you choose to write down.

## The discipline is in the Gherkin, not the framework

A scenario that leaks implementation detail reads like this:

```gherkin
Scenario: Route unavailable status
  Given a POST request to "/api/v2/routes" with body '{"tripId": "T-123"}'
  When the response status is 202
  And the database table "routes" has a row with status "PENDING"
  Then a GET to "/api/v2/routes/T-123" returns status "PENDING"
```

That's an HTTP test wearing a Gherkin costume. No product owner reads that and evaluates whether it reflects the business rule correctly, because it's written at the level of endpoints and status codes, not behavior. The same scenario, written for a human first:

```gherkin
Scenario: Requesting a route before it has been computed
  Given a trip has just been created
  When the customer requests the route for that trip
  Then the customer sees the route as "being calculated"
  And they are not shown an error
```

Both versions can drive the same REST Assured calls underneath. The difference is entirely in what the Gherkin exposes. The second version is something a product owner can read, disagree with, or (the actually valuable outcome) correct, because they might know that "being calculated" isn't the wording customer support wants, or that there's a business rule about how long that state should be allowed to persist before it's treated as an error, which the engineer writing the scenario didn't know to ask about.

Step definitions carry the plumbing:

```java
@When("the customer requests the route for that trip")
public void customerRequestsRoute() {
    response = given()
        .pathParam("tripId", context.currentTripId())
        .when()
        .get("/api/v2/routes/{tripId}");
}

@Then("the customer sees the route as {string}")
public void routeShowsStatus(String expectedStatus) {
    response.then().body("status", equalTo(mapToApiStatus(expectedStatus)));
}
```

The mapping between human-readable status text and the API's actual enum value lives in the step definition, not in the feature file, which is exactly where it belongs: the feature file describes behavior, the step definition describes mechanics.

## Scenario explosion is a modeling failure, not a testing failure

The other common failure is scenario explosion: a feature file with forty scenarios covering every permutation of trip type, customer tier, and route status, because someone treated Gherkin as a place to enumerate test cases rather than describe behavior. This usually means the underlying business rule wasn't understood well enough to state generally, so it got covered by brute-forcing every combination instead.

Scenario Outlines help with the mechanical repetition, but they don't fix the deeper problem if the outline itself is enumerating accidental complexity:

```gherkin
Scenario Outline: Route recalculation triggers on trip changes
  Given a trip with a computed route
  When the <change> occurs
  Then the route is marked for recalculation

  Examples:
    | change              |
    | destination changes |
    | departure time changes |
    | vehicle type changes |
```

That's a legitimate use of an outline: one behavior, several triggers, no reason to write three nearly-identical scenarios by hand. The failure mode is reaching for an outline, or worse, a hand-written scenario per case, for things that aren't actually variations of one behavior but entirely separate business rules wearing the same template. If a product owner can't tell you in one sentence what a Scenario Outline as a whole is testing, it's usually covering more than one rule and should split.

The other lever against explosion is being deliberate about what deserves a Gherkin scenario at all versus a plain unit or integration test. Edge cases around malformed input, null handling, and exhaustive boundary conditions belong in JUnit 5, not Gherkin: nobody outside engineering needs to review that an empty string is rejected, and dragging every technical edge case into feature files is how a fifteen-scenario suite that a product owner could realistically review becomes a two-hundred-scenario suite that nobody reads end to end, including the engineers who wrote it. The Testcontainers-backed integration tests underneath handle technical correctness; the Gherkin layer exists specifically for the scenarios where product judgment matters.

## Getting product owners to actually engage

None of this matters if product owners never open the file, and getting them to isn't automatic just because the prose is readable. What worked was treating scenario review as part of the definition of done for a feature, not an afterthought: the product owner reads and signs off on scenarios before implementation starts, not after, which turns Gherkin into a specification tool that shapes the work instead of a test artifact that documents work already finished. Scenarios reviewed after the code is written get rubber-stamped, because by then everyone's incentive is to ship, not to relitigate behavior. Reviewed beforehand, they catch the gap between what was asked for and what was understood while that gap still costs an edit to a text file instead of a rewrite of the implementation.

The honest tell for whether a BDD suite is working as communication rather than as automation theater: does a product owner ever request a change to a scenario's wording or logic without being prompted. If the answer is no, the scenarios are being read by machines and by nobody else, and the Given/When/Then syntax is pure overhead: the exact scenario the BDD tooling exists to prevent, quietly happening anyway underneath syntax that only looks like it's serving its purpose.
