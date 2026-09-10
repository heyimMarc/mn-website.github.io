---
title: "Enforcing Hexagonal Architecture at Build Time with jMolecules and ArchUnit"
date: 2026-12-21T09:00:00+01:00
draft: false
description: Why we stopped relying on review comments to keep a hexagonal, DDD-aligned architecture intact and started failing the pipeline instead, covering jMolecules annotations, ArchUnit rules, and the violations that would otherwise have slipped through.
menu:
  sidebar:
    name: "Enforcing Hexagonal Architecture"
    identifier: ddd-architecture-enforcement-jmolecules-archunit
    weight: 18
tags: ["ddd", "hexagonal-architecture", "archunit", "jmolecules", "java", "clean-architecture"]
categories: ["backend"]
---

Architecture diagrams age badly. We drew one for our event-sourced property and metering platform in the first sprint: domain core in the middle, ports around it, adapters on the outside, dependencies pointing inward. Months later, with the codebase now built by more hands than started it, I went looking for a service that still matched the diagram and found a repository interface with a Spring `@Transactional` annotation sitting inside the domain module, and a domain entity that imported a JPA class because someone needed a quick fix under deadline pressure. Nobody had done anything wrong in isolation. Each PR was small, reviewed, and reasonable-looking on its own. The architecture eroded one reasonable-looking PR at a time, which is exactly how architecture always erodes.

Review comments do not scale as an enforcement mechanism. A reviewer catching an architectural violation depends on them noticing it, having the context to recognize it as a violation, and being willing to hold up the PR over something that "still works." Compilers and build pipelines have none of those failure modes. So we moved architecture enforcement out of code review and into the CI pipeline, where a violation is not a suggestion, it is a red pipeline.

## jMolecules: making the architecture visible in code

jMolecules gives you annotations to express DDD and hexagonal building blocks explicitly, rather than relying on package naming conventions that everyone interprets slightly differently:

```java
@AggregateRoot
public class MeteringDevice {

    @Identity
    private final DeviceId id;
    private DeviceStatus status;
    private final List<DomainEvent> uncommittedEvents = new ArrayList<>();

    public void recalibrate(CalibrationReading reading) {
        if (status == DeviceStatus.DECOMMISSIONED) {
            throw new DeviceDecommissionedException(id);
        }
        apply(new DeviceRecalibrated(id, reading, Instant.now()));
    }
}
```

```java
@ValueObject
public record CalibrationReading(BigDecimal value, MeasurementUnit unit) {}
```

```java
public interface MeteringDeviceRepository extends Repository<MeteringDevice, DeviceId> {
    Optional<MeteringDevice> findById(DeviceId id);
    void save(MeteringDevice device);
}
```

None of these annotations do anything at runtime. That is the point: jMolecules is a set of markers, not a framework. It costs nothing in production and gives ArchUnit something precise to check instead of guessing from package names.

## ArchUnit: turning the diagram into a test

The rules live in a dedicated `architecture` test module that every service includes. A representative slice:

```java
@AnalyzeClasses(packages = "com.platform.metering")
class HexagonalArchitectureTest {

    @ArchTest
    static final ArchRule domain_must_not_depend_on_spring =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage(
                "org.springframework..", "jakarta.persistence..");

    @ArchTest
    static final ArchRule domain_must_not_depend_on_adapters =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAPackage("..adapter..");

    @ArchTest
    static final ArchRule building_blocks_are_properly_annotated =
        JMoleculesDddRules.all();

    @ArchTest
    static final ArchRule application_services_orchestrate_only_through_ports =
        classes().that().resideInAPackage("..application..")
            .should().onlyDependOnClassesThat()
            .resideInAnyPackage("..application..", "..domain..", "java..", "..port..");

    @ArchTest
    static final ArchRule onion_architecture_is_respected =
        onionArchitecture()
            .domainModels("..domain.model..")
            .domainServices("..domain.service..")
            .applicationServices("..application..")
            .adapter("rest", "..adapter.in.rest..")
            .adapter("messaging", "..adapter.in.messaging..")
            .adapter("persistence", "..adapter.out.persistence..")
            .adapter("sap", "..adapter.out.sap..");
}
```

The last rule uses ArchUnit's own `onionArchitecture()` builder (`com.tngtech.archunit.library.Architectures`), which understands ports-and-adapters layering natively and turns a whole category of "adapter code leaking into the core" mistakes into a one-line declaration. jMolecules' own `JMoleculesDddRules` handles the DDD-annotation checks above it. We layer our own rules, like the Spring-in-domain check, on top of both for cases specific to how our team tends to cut corners.

## Why the pipeline, not the review

We ran these same rules as a Sonar custom rule set for a while, surfaced as warnings in the PR view. Warnings get dismissed under deadline pressure ("I'll fix it in a follow-up"), and follow-ups that fix architecture debt with no functional payoff are the first thing that gets deprioritized when the sprint gets busy. The moment we wired the ArchUnit module into the same Maven build that produces the deployable artifact, and made a failing architecture test fail the GitLab CI pipeline exactly like a failing unit test does, the conversation changed. It stopped being "please reconsider this" and became "the build is red, you cannot merge." That is not a subtle difference in outcome.

```yaml
verify:
  stage: test
  script:
    - mvn -B verify -pl architecture,domain,application,adapter-rest,adapter-persistence
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

The `architecture` module runs in the same `verify` phase as every other test suite, with the same non-negotiable exit code semantics. No separate "architecture gate" stage that people learn to route around by targeting a narrower Maven reactor build locally.

## The violation that justified the whole exercise

Not long after we turned the rules on, a new team member, reasonably enough given that no annotation told them otherwise, added a field of type `EntityManager` to a domain aggregate to make a "quick" existence check convenient. The `domain_must_not_depend_on_spring`-equivalent JPA rule failed the pipeline within minutes of the push, with an ArchUnit failure message naming the exact class and the exact dependency. No reviewer needed to catch it, no architecture discussion needed to happen in a PR thread days later after the code had already been built on top of. The fix was a short conversation and a rewritten method that asked the repository port instead. Compare that to the alternative timeline: the code merges, more features get built assuming the aggregate can talk to persistence directly, and much later someone tries to extract that aggregate into its own service and discovers the domain model is not portable at all. I have lived that second timeline on a previous project. It is not a fun refactor.

## Where this does not help

ArchUnit checks structure, not judgment. It will not tell you that an aggregate boundary is drawn in the wrong place, that a bounded context should be split in two, or that a domain event is missing a field the business actually needs. Those are still design conversations that belong in review and in modeling sessions with domain experts. What the pipeline buys us is a guarantee that whatever boundaries we did agree on stay intact by construction, so review time goes to the decisions that actually need human judgment instead of re-litigating a layering violation for the fourth time this quarter.

The annotations and rules together cost us maybe half a day to set up per service, reusing a shared `architecture-test-starter` module across the platform. Measured against the incident I described above from a previous job, and the slow, silent erosion I watched happen to our own diagram before we did this, that is one of the best half-days I have spent on any of these services.

A minimal working setup (hexagonal domain, jMolecules annotations, the full ArchUnit rule suite including a deliberately failing example) is on GitHub: [ddd-jmolecules-archunit-demo](https://github.com/heyimMarc/ddd-jmolecules-archunit-demo).
