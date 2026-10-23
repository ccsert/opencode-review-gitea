---
name: review-java
description: Review checklist for Java and Kotlin changes (.java, .kt, .kts, pom.xml, build.gradle), including Spring, JPA/Hibernate, concurrency and resource handling.
---

# Java / Kotlin Review Checklist

## Correctness
- `==` on strings or boxed numbers; `equals` without `hashCode`; mutable fields used in `hashCode`.
- `Optional.get()` without a presence check; Kotlin `!!` on values that the diff shows can be null; platform types from Java treated as non-null.
- Integer overflow in arithmetic on IDs, sizes or money; `double` for currency (use `BigDecimal` with explicit rounding).
- Resources not closed: streams, JDBC connections, `ResultSet` without try-with-resources / `use {}`.
- Exceptions caught and ignored; `InterruptedException` swallowed without restoring the interrupt flag.

## Concurrency
- Shared mutable state in singletons (Spring beans are singletons by default), non-thread-safe `SimpleDateFormat`, `HashMap` across threads.
- Double-checked locking without `volatile`; `synchronized` on a non-final or boxed object.
- Kotlin coroutines: blocking calls on `Dispatchers.Main/Default`, `GlobalScope`, unhandled exceptions in `launch`.

## Spring and JPA
- New controllers or endpoints missing security annotations used by their neighbors; `@Transactional` on private methods or self-invocation (not proxied).
- Lazy loading in loops (N+1) or outside a transaction (`LazyInitializationException`); `findAll()` without pagination on large tables.
- Entities exposed directly as request bodies (mass assignment) or responses (data leakage).
- JPQL/SQL built by concatenation; `@Query` with string interpolation.

## Build
- Dependency versions changed without lockfile/BOM updates; SNAPSHOT dependencies in release builds.

## Do not report
- Style rules enforced by the project's formatter or Checkstyle/ktlint configuration.
