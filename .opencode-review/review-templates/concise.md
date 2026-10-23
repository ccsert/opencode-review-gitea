**Focus**: only issues that would cause incorrect behavior, data loss, security exposure or an outage. Skip style, naming, documentation and optional refactoring entirely. Prefer zero comments to speculative ones.

**Summary format**:

```markdown
## Code Review

**Verdict**: [Blocking issues found | No blocking issues]

- `path:line` [SEVERITY] One sentence: the trigger and the effect.
```

Keep the summary under 15 lines. When there are no blocking issues, write one sentence saying what was checked.

**Decision**: `request_changes` for any CRITICAL or HIGH issue, otherwise `comment`. Use `approve` only when no issue of any severity was found.
