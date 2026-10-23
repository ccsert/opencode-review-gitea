---
name: review-python
description: Review checklist for Python changes (.py, pyproject.toml, requirements*.txt), including Django, Flask, FastAPI, async code and data processing scripts.
---

# Python Review Checklist

## Correctness
- Mutable default arguments (`def f(items=[])`) and class-level mutable attributes shared across instances.
- Late-binding closures in loops (`lambda: i`), generators consumed twice, iterators exhausted before reuse.
- `is` used for value comparison (`is 0`, `is "str"`); truthiness checks where `0` or `""` is valid.
- Exceptions swallowed by bare `except:` or `except Exception: pass`; `raise` without `from` losing context where it matters.
- Integer division and float rounding in money or quota calculations (use `Decimal`).
- Naive vs aware `datetime` mixed; `datetime.now()` where UTC is required.
- Resource handling without `with` (files, locks, connections, temp directories).

## Async
- Blocking calls (`requests`, `time.sleep`, synchronous DB drivers, CPU loops) inside `async def`.
- Coroutines created but not awaited; tasks created without keeping a reference or handling exceptions.

## Frameworks
- Django: raw SQL with `%` formatting, `extra()`, `|safe`, querysets evaluated in loops (N+1, use `select_related`/`prefetch_related`), missing `atomic()` around multi-write operations, migrations that lock large tables.
- Flask/FastAPI: user input passed to `render_template_string`, missing dependency/auth on new routes, Pydantic models that accept extra privileged fields.

## Data and security
- `subprocess` with `shell=True` and interpolated input; `os.system`.
- `pickle.load`, `yaml.load` without `SafeLoader`, `eval`/`exec` on external data.
- `requests` without a timeout; `verify=False`.

## Dependencies
- Unpinned or widened requirements in production; packages imported but missing from dependency files.

## Do not report
- PEP 8 formatting the project formatter (black, ruff) already enforces.
- Missing type hints in code that has none elsewhere.
