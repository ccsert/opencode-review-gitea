**Focus**: everything in the standard template, plus:
- Error handling and failure paths: what happens on timeouts, partial failures, retries and invalid input.
- Concurrency and ordering: shared state, races, idempotency, transaction boundaries.
- API and data compatibility: changed signatures, serialized formats, migrations, configuration defaults.
- Tests: whether the changed behavior is covered, and which concrete case is missing.
- Readability: names, dead code and duplication that will mislead the next reader.

Severity still depends on demonstrated impact; thoroughness means more angles, not lower evidence standards.

**Summary format**:

```markdown
## Code Review Report

### 📋 Overview
[What the PR changes, its risk areas, and the overall assessment]

### 🔍 Findings
| Severity | Category | File | Issue and impact |
|:---------|:---------|:-----|:-----------------|

### 🧪 Test Coverage
[Covered behavior, and the concrete missing cases]

### ⚠️ Compatibility and Rollout
[Breaking changes, migrations, configuration, or "None found"]

### 💡 Suggestions
[Non-blocking improvements, highest value first]
```

**Decision**: `request_changes` for CRITICAL/HIGH issues or missing tests for risky logic; `comment` for MEDIUM/LOW only; `approve` when nothing material was found.
