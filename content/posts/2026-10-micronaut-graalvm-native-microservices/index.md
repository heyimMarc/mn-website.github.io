---
title: "Micronaut + GraalVM Native Images: When It Pays Off"
date: 2026-10-26T09:00:00+02:00
draft: true
description: Build-time dependency injection and serialization make Micronaut a natural fit for GraalVM native-image, but reflection configuration and resource bundling still bite. Notes from running native microservices in production.
menu:
  sidebar:
    name: "Micronaut + GraalVM Native Images"
    identifier: micronaut-graalvm-native-microservices
    weight: 17
tags: ["micronaut", "graalvm", "native-image", "java", "microservices"]
categories: ["backend"]
---

A native-image binary that starts in tens of milliseconds instead of seconds, and holds a fraction of the JVM's resident memory, is a genuinely nice thing to have. Getting there without losing a day to a `ClassNotFoundException` that only shows up at runtime, on the native binary, in a container, is the less nice part. On the SaaS side project I co-founded, the microservices run on Micronaut with GraalVM native-image support, and the reason it works reliably is almost entirely because Micronaut was designed around avoiding reflection from day one: GraalVM support is a consequence of that design, not a bolt-on.

## Why build-time DI matters here

Spring's dependency injection resolves the object graph at runtime, using reflection to inspect classes, scan for annotations, and proxy beans. That's fine on the JVM, where the classpath and reflection metadata exist. Native-image works differently: the closed-world assumption means everything the binary might reflectively touch has to be known at build time, or explicitly declared in reflection config. Retrofitting that onto a runtime-reflection framework means generating and maintaining huge reachability metadata files, and it's fragile: a new annotation processor version or a library upgrade can silently break what was reachable.

Micronaut does dependency injection and AOP at compile time, via annotation processing that generates plain Java classes implementing the wiring, with no runtime classpath scanning and no proxies generated via reflection. A `@Singleton` service isn't found by scanning at startup; the compiler emits a `$Definition` and `$Intercepted` class alongside it during the build. By the time GraalVM's native-image tool runs, there's very little DI-related reflection left to configure, because there was never any DI-related reflection to begin with.

```java
@Singleton
public class InvoiceProjectionHandler {

    private final InvoiceReadRepository repository;

    public InvoiceProjectionHandler(InvoiceReadRepository repository) {
        this.repository = repository;
    }

    @KafkaListener(groupId = "invoice-projection")
    void onInvoiceIssued(InvoiceIssuedEvent event) {
        repository.upsert(InvoiceView.from(event));
    }
}
```

Nothing here is special-cased for native-image. It's ordinary constructor injection; Micronaut's annotation processor does the rest at compile time, and `native-image` sees a call graph it can actually analyze statically.

## Serialization is the other half

The other classic reflection sink is JSON (de)serialization: Jackson's default behavior inspects fields and getters via reflection at runtime. Micronaut Serde generates serializers and deserializers at compile time in the same way it generates DI wiring, driven by `@Serdeable` on the DTOs:

```java
@Serdeable
public record CreateOrderRequest(
    @NotBlank String customerId,
    @Positive BigDecimal amount,
    List<@Valid OrderLineRequest> lines
) {}
```

This pairs naturally with contract-first OpenAPI: the same generated request/response types used for the OpenAPI-driven controllers are `@Serdeable` records, so the type generation, the validation annotations, and the native-image compatibility all come from one source instead of three.

## Where reflection still finds you

Micronaut removes most reflection, not all of it. The places it still shows up, in order of how often they've cost me an afternoon:

1. **Third-party libraries that weren't written with native-image in mind.** Anything doing its own classpath scanning, dynamic proxying, or `Class.forName` on a computed string needs an explicit `reflect-config.json` entry, or, better, a `native-image.properties` file shipped by the library itself if it has a GraalVM reachability metadata entry upstream. Check the [GraalVM reachability metadata repository](https://github.com/oracle/graalvm-reachability-metadata) before writing your own config; a surprising number of common libraries already have entries.
2. **Resources that need to be on the classpath at runtime**: Kafka client configuration files, database driver SPI files under `META-INF/services`, i18n bundles. These need explicit `resource-config.json` entries or they simply aren't in the binary, and the failure mode is a `NoSuchFileException` at runtime that gives no hint the file was ever expected to exist.
3. **Reflective enum or record component access from generic frameworks**: most commonly hit with Micronaut Data's dynamic finder methods against edge-case query shapes, or with a validation library that inspects annotations on record components reflectively instead of through the compile-time model.

```json
{
  "resources": {
    "includes": [
      { "pattern": "\\Qapplication.yml\\E" },
      { "pattern": "\\Qdb/migration/.*\\E" }
    ]
  }
}
```

The hard lesson: the failures aren't compile errors, and they aren't even native-image *build* errors most of the time. The build succeeds, the binary starts, and then something explodes at 2am the first time a rarely-hit code path executes, because that's the first time the missing reflective access is exercised. The mitigation is boring but necessary: run the native binary through the same integration test suite as the JVM build in CI, not just a smoke test. A native-image build that passes `./gradlew test` on the JVM and skips the equivalent native test run is a build you haven't actually verified.

```yaml
# GitLab CI snippet
test-native:
  stage: test
  script:
    - ./gradlew nativeCompile
    - ./build/native/nativeCompile/orders-service &
    - ./gradlew nativeIntegrationTest -Dnative.binary.port=8080
```

## When native pays off, and when it doesn't

Native-image build time is real: a service that compiles quickly on the JVM can take several minutes longer to produce a native binary, and that cost is paid on every CI run, every dependency bump, every base-image patch. For a service you deploy a few times a day, that's a tax worth paying only if you get something back. What we get back:

- **Cold start**: an order of magnitude faster than the equivalent JVM startup. This matters for anything scaled to zero or handling bursty, infrequent traffic, like a Kafka consumer that spins up for a batch window or a webhook handler behind KEDA scale-to-zero.
- **Memory footprint**: noticeably smaller than the equivalent JVM heap-plus-metaspace footprint, which matters directly on a self-hosted cluster where you're paying for the physical nodes, not renting elastic capacity.
- **Density**: more instances per node at the same memory budget, which improves availability during a node drain without adding hardware.

Where it doesn't pay off: long-running, steady-throughput services where the JVM has time to warm up and where C2's runtime profile-guided optimization tends to outperform native-image's ahead-of-time compiled code on raw sustained throughput, particularly for CPU-heavy workloads like projection rebuilds. For those, we stay on the JVM and let Micronaut's compile-time DI benefit startup and memory anyway, without paying the native build-time tax or taking on reflection-configuration risk. Native-image is a tool for the class of service where restart frequency and density matter more than peak throughput, not a default you flip on for everything because it's available.
