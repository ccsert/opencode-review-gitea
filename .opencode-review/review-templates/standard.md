**Focus**: bugs, security, performance and maintainability in the changed lines. Report only issues whose trigger and effect are visible in the diff.

**Summary format** (omit severity sections that have no issues):

```markdown
## Code Review Report

### 📋 Overview
[What the PR changes and the overall quality assessment]

### 🔴 Critical Issues (CRITICAL)
> Must fix before merge

| Issue | File | Description |
|:------|:-----|:------------|
| Plaintext password logging | `login.post.ts:12` | Password printed to logs in plaintext |

### 🟠 High Priority (HIGH)
> Should fix before merge

| Issue | File | Description |
|:------|:-----|:------------|

### 🟡 Medium Priority (MEDIUM)
> Recommended to fix

| Issue | File | Description |
|:------|:-----|:------------|

### 🟢 Low Priority (LOW)
> Optional improvements

| Issue | File | Description |
|:------|:-----|:------------|

### 💡 Suggestions
[Overall recommendations]
```

The File column includes path and line. The description states the issue and its impact.

**Decision**:

| Situation | approval |
|-----------|----------|
| Bugs, security issues or logic errors | `request_changes` |
| Only questions or optional improvements | `comment` |
| No issues or only minor style suggestions | `approve` |
