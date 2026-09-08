---
title: "Contract-First with OpenAPI 3 and JSON Schema"
date: 2026-09-28T09:00:00+02:00
draft: true
description: How treating OpenAPI and JSON Schema as the single source of truth, generating both API clients and event classes from them, keeps services from drifting apart, and the versioning discipline that makes it sustainable.
menu:
  sidebar:
    name: "Contract-First OpenAPI & JSON Schema"
    identifier: contract-first-openapi-json-schema
    weight: 13
tags: ["openapi", "json-schema", "api-design", "java", "kotlin", "contract-testing"]
categories: ["backend"]
---

The failure mode I have seen most often in service-to-service integration is not a bug in either service. It is two services that each independently, and correctly, implement their own understanding of a shared data structure, and those understandings quietly diverge over months, sometimes years, of parallel development. Nobody notices until a field that one team renamed shows up as `null` in the other team's consumer, in production, at a moment nobody chose. Both codebases are internally consistent. The contract between them just stopped existing somewhere along the way, because it was never a real artifact: it was a shared understanding, and shared understandings decay.

On the platform I work on, the contract is a file, not an understanding. OpenAPI 3 for HTTP APIs and JSON Schema for the domain events we exchange between services are the single source of truth, checked into a dedicated contracts repository, versioned, and reviewed like code, because they are code, in the sense that matters: they generate the code that actually runs.

## The contract comes first, literally

A new endpoint or a new domain event does not start life as a Java DTO. It starts as a schema:

```yaml
# contracts/events/device-recalibrated.v1.schema.yaml
$schema: "https://json-schema.org/draft/2020-12/schema"
$id: "https://schemas.platform.internal/events/device-recalibrated.v1.json"
title: DeviceRecalibratedV1
type: object
required: [deviceId, calibrationValue, unit, occurredAt]
properties:
  deviceId:
    type: string
    format: uuid
  calibrationValue:
    type: number
  unit:
    type: string
    enum: [KWH, M3, CUBIC_METER_PER_HOUR]
  occurredAt:
    type: string
    format: date-time
additionalProperties: false
```

`additionalProperties: false` is not decoration. It is the single line that turns "consumer silently ignores a field it does not expect" into "consumer fails validation loudly if the payload does not match what was agreed." We learned to insist on it after a producer once added a field, a consumer's lenient deserializer swallowed it without complaint, and a downstream billing calculation that should have used that new field kept using a stale default for longer than anyone likes to admit before someone noticed the numbers looked slightly off.

The REST side follows the same discipline in OpenAPI:

```yaml
paths:
  /devices/{deviceId}/calibrations:
    post:
      operationId: recalibrateDevice
      requestBody:
        content:
          application/json:
            schema:
              $ref: "./schemas/calibration-request.v1.schema.yaml"
      responses:
        "202":
          description: Calibration accepted
        "409":
          description: Device is decommissioned
          content:
            application/problem+json:
              schema:
                $ref: "./schemas/problem-detail.schema.yaml"
```

## Generating code from the contract, both directions

The reason this discipline holds under deadline pressure (nothing holds under deadline pressure unless it is also the path of least resistance) is that nobody hand-writes the DTOs or the event classes. The build generates them.

For REST clients, we use OpenAPI Generator wired into Maven:

```xml
<plugin>
    <groupId>org.openapitools</groupId>
    <artifactId>openapi-generator-maven-plugin</artifactId>
    <executions>
        <execution>
            <goals><goal>generate</goal></goals>
            <configuration>
                <inputSpec>${project.basedir}/../contracts/rest/metering-api.v2.yaml</inputSpec>
                <generatorName>java</generatorName>
                <library>native</library>
                <apiPackage>com.platform.metering.client.api</apiPackage>
                <modelPackage>com.platform.metering.client.model</modelPackage>
                <configOptions>
                    <useJakartaEe>true</useJakartaEe>
                    <serializationLibrary>jackson</serializationLibrary>
                </configOptions>
            </configuration>
        </execution>
    </executions>
</plugin>
```

For domain events, we generate Java records directly from the JSON Schema using jsonschema2pojo, configured for immutable records rather than mutable beans:

```xml
<plugin>
    <groupId>org.jsonschema2pojo</groupId>
    <artifactId>jsonschema2pojo-maven-plugin</artifactId>
    <configuration>
        <sourceDirectory>${project.basedir}/../contracts/events</sourceDirectory>
        <targetPackage>com.platform.metering.events</targetPackage>
        <generateBuilders>false</generateBuilders>
        <useJakartaValidation>true</useJakartaValidation>
        <includeAdditionalProperties>false</includeAdditionalProperties>
    </configuration>
</plugin>
```

A consumer service pulls the same schema files (via a shared contracts artifact published to our internal Maven repository) and generates the identical event class, field for field, type for type. It is structurally impossible for the producer's `DeviceRecalibratedV1` and the consumer's `DeviceRecalibratedV1` to drift, because they are not two hand-maintained classes that happen to agree: they are one generation step run twice against the same input.

## Versioning: the part that actually needs discipline

Generation solves drift within a version. It does not solve evolution across versions, and pretending schemas never change is how teams end up afraid to touch their own APIs. Our rule set is deliberately narrow:

- Additive, optional fields are a non-breaking change to the same version: a schema minor revision, no consumer action required, and `additionalProperties: false` gets relaxed temporarily during rollout via a documented exception, never permanently.
- Anything else (renaming a field, changing a type, adding a new required field, removing a field) is a new version: `device-recalibrated.v2.schema.yaml`, published alongside v1, not replacing it.
- Producers keep emitting the old version until every known consumer has confirmed migration to the new one, tracked in a consumer registry file in the contracts repo that each service's pipeline updates on deploy.
- A CI check in the contracts repository diffs every schema change against its previous version using `openapi-diff` and `json-schema-diff-validator`, and fails the merge request if a change classified as breaking lands under a version number that has already been published and consumed.

That last check is the one that has saved us the most grief. It is trivial to convince yourself a change is "just adding a field" when you are the one making it and have the full context in your head. The diff tool has no context and no opinion: it just tells you, correctly, that changing `unit` from a free-string to an enum is a breaking change regardless of how reasonable it felt while typing it.

## What this costs

Contract-first is slower at the start of a feature. You cannot start writing a handler until the schema exists, is reviewed, and generation has run, which means a genuinely new field requires a small PR against the contracts repo before the feature PR can even compile. Teams new to this occasionally experience that as friction, and I understand the instinct, coming from years of "define the DTO wherever, we'll sort out compatibility later."

But the friction is front-loaded and small, versus the alternative failure being back-loaded, silent and expensive. The API clients and event classes generated from contracts also mean a schema change that would break a consumer is caught at generation or CI time (a compile failure in a downstream service's next build) rather than as a production incident weeks after the change shipped and everyone has moved on to other work. I would rather argue with a teammate for ten minutes over whether a field rename needs a new version than debug a null-pointer exception in a billing job at 3 a.m. because someone's DTO quietly stopped matching someone else's.
