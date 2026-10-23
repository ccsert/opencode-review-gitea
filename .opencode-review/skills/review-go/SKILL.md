---
name: review-go
description: Review checklist for Go changes (.go, go.mod), including goroutines, channels, context handling, HTTP servers and database access.
---

# Go Review Checklist

## Errors
- Errors ignored (`_ =`, unchecked returns from `Close`, `Write`, `Scan`, `rows.Err()`), or logged and then execution continues with zero values.
- Error wrapping: `%w` lost by `%v`, `errors.Is/As` comparisons broken by string matching.
- `defer` inside loops holding resources until the function returns.

## Concurrency
- Goroutines without a termination path (leaks on context cancellation, blocked sends on unbuffered channels).
- Data races: maps or slices written from multiple goroutines without a mutex; loop variables captured by goroutines (before Go 1.22 semantics, check go.mod).
- `sync.WaitGroup.Add` called inside the goroutine; mutex copied by value; `Unlock` missing on an early return.
- Closing a channel from the receiver side or closing twice.

## Context and HTTP
- `context.Background()` where the request context should propagate; contexts not cancelled (`cancel` not deferred).
- HTTP clients without timeouts; response bodies not closed; `http.DefaultClient` used for external calls.
- Handlers writing headers after the body; missing `return` after `http.Error`.

## Data
- `nil` map writes; slices aliased after `append` and mutated by callers.
- SQL built with `fmt.Sprintf`; `rows` not closed; transactions without rollback on error paths.
- Integer overflow in conversions (`int64` → `int32`), unchecked type assertions (`v.(T)` without `, ok`) on external data.

## Modules
- `replace` directives committed for local paths; major version bumps without import path changes.

## Do not report
- Formatting that `gofmt` handles; naming already consistent with the surrounding package.
