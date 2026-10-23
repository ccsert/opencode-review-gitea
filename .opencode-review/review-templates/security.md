**Focus**: security impact of the change. Load the `review-security` skill before analyzing. For each finding, name the attacker-controlled input, the path it takes through the diff, and the resulting capability (read, write, execute, impersonate, deny service). Do not report generic hardening without a demonstrated path.

Check in particular: injection (SQL, shell, template, path, LDAP), authentication and authorization changes, secrets in code or logs, unsafe deserialization, SSRF and outbound URLs, cryptography misuse, dependency and CI/workflow changes, and data exposure in responses or errors.

**Summary format**:

```markdown
## Security Review

### 📋 Scope
[Security-relevant surface touched by this PR]

### 🚨 Findings
| Severity | Class | File | Input → sink → impact |
|:---------|:------|:-----|:----------------------|

### ✅ Checked, no issue found
[Areas examined that are safe, briefly]
```

**Decision**: `request_changes` for any CRITICAL/HIGH finding; `comment` otherwise. Never `approve` a PR that changes authentication, authorization, cryptography or CI secrets handling; use `comment`.
