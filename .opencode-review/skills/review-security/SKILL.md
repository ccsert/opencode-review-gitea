---
name: review-security
description: Security review checklist for a PR diff. Use when the diff touches authentication, authorization, sessions, tokens, passwords, cryptography, user input parsing, SQL or shell construction, file paths, URLs fetched by the server, deserialization, secrets, CORS, or CI workflows.
---

# Security Review Checklist

Report a security finding only with a concrete path: **attacker-controlled input → code in the diff → sink → capability gained**. Name each step with `path:line`. "Could be unsafe" without an input is not a finding.

## Injection
- SQL built by string concatenation or interpolation with request data. Parameterized queries, ORM query builders and constant identifiers are safe.
- Shell commands with `shell=True`, `exec`, backticks or `sh -c` that include input. Argument arrays without a shell are safe.
- Template rendering with autoescape disabled, `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `|safe`.
- Paths joined from input without normalization and a base-directory check (`../` traversal, absolute paths, symlinks).
- Regular expressions compiled from input (ReDoS) or applied to unbounded input with nested quantifiers.

## Authentication and authorization
- New endpoints or handlers without the auth middleware/decorator that their neighbors use.
- Object access by ID without an ownership or tenant check (IDOR).
- Mass assignment: request bodies bound directly to models that contain role, owner, price or `isAdmin` fields.
- Debug flags, test bypasses or environment toggles that skip checks in production.
- Token comparison with `==` instead of a constant-time comparison; JWT `alg: none`, missing expiry or audience checks.

## Secrets and data exposure
- Credentials, keys or tokens committed in code, fixtures or configuration.
- Secrets, passwords, tokens or personal data written to logs, error messages or API responses.
- Stack traces or internal errors returned to clients.

## Server-side requests and deserialization
- Server fetching a URL derived from input without an allowlist (SSRF to metadata services, localhost, internal hosts).
- `pickle`, `yaml.load` without SafeLoader, Java native serialization, `BinaryFormatter`, or `eval` on untrusted data.

## Cryptography
- MD5/SHA1 for passwords or signatures; passwords hashed without a slow KDF (bcrypt, scrypt, argon2, PBKDF2).
- Hard-coded IVs or keys, ECB mode, `Math.random()`/`random` for tokens.
- TLS verification disabled (`verify=False`, `InsecureSkipVerify`, `rejectUnauthorized: false`).

## CI and supply chain
- Workflows that run untrusted PR code with secrets, `pull_request_target` checkouts of the PR head, or interpolating `${{ github.event.* }}` text directly into `run:` scripts.
- New dependencies from unusual registries, unpinned install scripts (`curl | sh`), or loosened lockfile integrity.

## Do not report
- Missing rate limiting, CSP or headers when the diff does not touch them.
- Theoretical issues in test-only code that never handles real input.
- Internal values (constants, config read at startup) treated as attacker input.
