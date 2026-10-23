**Focus**: conformance with the Team Review Standards section above. Go through every applicable standard and decide, from the diff only, whether the change complies, violates it, or is not affected. Do not invent requirements that the standards do not state. Defects outside the standards are still reported, under "Other findings".

If no Team Review Standards are loaded, say so in the summary and review with the standard template's focus.

Line comments for violations start with the usual tag and end with `Standard: <source>`.

**Summary format**:

```markdown
## Standards Compliance Review

### 📋 Overview
[What the PR changes and which standards apply]

### 📏 Standards Checklist
| Standard | Result | Evidence |
|:---------|:-------|:---------|
| `<source>`: <rule> | ✅ Complies / ❌ Violates / ➖ Not affected | `path:line` or reason |

### 🐞 Other findings
| Severity | File | Issue and impact |
|:---------|:-----|:-----------------|
```

**Decision**: `request_changes` when any standard marked as mandatory (MUST, required, 必须) is violated or a CRITICAL/HIGH defect exists; `comment` for other violations; `approve` only when everything complies.
