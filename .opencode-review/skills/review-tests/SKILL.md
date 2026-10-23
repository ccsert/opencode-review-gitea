---
name: review-tests
description: Review checklist for test changes and test coverage of changed behavior. Use when the diff adds or modifies tests (test/, tests/, __tests__/, *_test.go, *.test.ts, *.spec.*, test_*.py) or changes logic that existing tests should cover.
---

# Test Review Checklist

## Coverage of the change
- New branches, error paths or edge cases in the diff (empty input, boundaries, invalid data, concurrency) with no test exercising them. Name the specific missing case, not "add more tests".
- Bug fixes without a regression test that fails before the fix.

## Test quality
- Assertions that cannot fail: no assertion, asserting a mock returns what it was told to return, `expect(x).toBeTruthy()` on objects that are always truthy.
- Tests that pass for the wrong reason: exceptions caught by the test itself, async tests that do not await, snapshot updates that accept a regression.
- Over-mocking: the unit under test mocked away, or mocks diverging from the real interface shown in the diff.
- Shared mutable fixtures between tests; order-dependent tests; reliance on wall-clock time, randomness or network without control.
- Skipped or focused tests committed (`.skip`, `.only`, `t.Skip`, `@Disabled`, `xit`, `fit`).

## Do not report
- Coverage percentage targets; tests for trivial getters or generated code.
