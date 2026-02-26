# Security Hardening + Feature Completeness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the platform for production-readiness (encrypt secrets, fix auth, validate AI output) while completing key missing features (GitHub provider, review retry, fetch timeouts).

**Architecture:** Two parallel tracks — Security (Tasks 1–6) and Features (Tasks 7–11). Security tasks are ordered by dependency (crypto utilities first, then consumers). Feature tasks are independent and can be done in any order after Security Track is complete.

**Tech Stack:** Node.js 22, TypeScript, Hono, Drizzle ORM + PGlite, Mastra Agent, jose (JWT), node:crypto (AES-256-GCM)

---

## Track A: Security Hardening

### Task 1: Create Crypto Utility Module

**Files:**

- Create: `packages/server/src/utils/crypto.ts`
- Test: `packages/server/src/utils/__tests__/crypto.test.ts`

This module provides AES-256-GCM encrypt/decrypt functions used by all routes that store secrets. The encryption key comes from env `ENCRYPTION_KEY` (32-byte hex string).

**Step 1: Write failing tests**

```typescript
// packages/server/src/utils/__tests__/crypto.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt, generateEncryptionKey } from "../crypto";

describe("crypto utils", () => {
  beforeAll(() => {
    // Set test encryption key (32 bytes = 64 hex chars)
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });

  it("encrypts and decrypts a string roundtrip", () => {
    const plaintext = "ghp_abc123secrettoken";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":"); // iv:authTag:ciphertext format
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const plaintext = "same-input";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    parts[2] = "tampered" + parts[2];
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("throws if ENCRYPTION_KEY is not set", () => {
    const original = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY");
    process.env.ENCRYPTION_KEY = original;
  });

  it("generateEncryptionKey returns 64-char hex string", () => {
    const key = generateEncryptionKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/utils/__tests__/crypto.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/server/src/utils/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY environment variable must be a 64-character hex string (32 bytes). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns format: `iv:authTag:ciphertext` (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt ciphertext produced by encrypt().
 */
export function decrypt(encryptedText: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertext] = encryptedText.split(":");

  if (!ivHex || !authTagHex || !ciphertext) {
    throw new Error(
      "Invalid encrypted text format. Expected iv:authTag:ciphertext",
    );
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Check if a string looks like it was encrypted by our encrypt().
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  return (
    parts.length === 3 &&
    parts[0].length === IV_LENGTH * 2 &&
    parts[1].length === AUTH_TAG_LENGTH * 2
  );
}

/**
 * Generate a random encryption key (for setup/docs).
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/server/src/utils/__tests__/crypto.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add packages/server/src/utils/
git commit -m "feat(server): add AES-256-GCM crypto utility for secret encryption"
```

---

### Task 2: Encrypt Tokens in Platform Credentials Routes

**Files:**

- Modify: `packages/server/src/routes/platforms.ts` — encrypt `accessToken` on write, decrypt on read
- Test: Verify manually or with integration test that round-trip works

**Step 1: Update platform routes to encrypt/decrypt**

In `packages/server/src/routes/platforms.ts`:

On **POST /platforms** (create): Encrypt `accessToken` before DB insert:

```typescript
import { encrypt, decrypt, isEncrypted } from "../utils/crypto";

// In the create handler, before db.insert:
const encryptedToken = encrypt(body.accessToken);
// Insert with encryptedToken instead of body.accessToken
```

On **GET /platforms** and **GET /platforms/:id**: Decrypt `accessToken` before returning:

```typescript
// After fetching from DB:
const decryptedPlatforms = platforms.map((p) => ({
  ...p,
  accessToken: isEncrypted(p.accessToken)
    ? decrypt(p.accessToken)
    : p.accessToken,
}));
```

On **PUT /platforms/:id**: If `accessToken` is updated, encrypt the new value.

**Step 2: Run build to verify no type errors**

Run: `pnpm run build --filter @opencode-review/server`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/server/src/routes/platforms.ts
git commit -m "feat(server): encrypt platform access tokens at rest (AES-256-GCM)"
```

---

### Task 3: Encrypt AI Provider API Keys

**Files:**

- Modify: `packages/server/src/routes/ai-providers.ts` — encrypt `apiKey` on write, decrypt on read
- Modify: `packages/server/src/routes/webhooks.ts` — decrypt `apiKey` when creating ReviewEngine

**Step 1: Update ai-providers routes**

Same pattern as Task 2: encrypt on POST/PUT, decrypt on GET.

In `packages/server/src/routes/ai-providers.ts`:

```typescript
import { encrypt, decrypt, isEncrypted } from "../utils/crypto";

// POST handler — encrypt before insert:
const encryptedApiKey = body.apiKey ? encrypt(body.apiKey) : null;

// GET handler — decrypt before returning:
const decryptedProvider = {
  ...provider,
  apiKey:
    provider.apiKey && isEncrypted(provider.apiKey)
      ? decrypt(provider.apiKey)
      : provider.apiKey,
};
```

**Step 2: Update webhooks.ts to decrypt when building ReviewEngine**

In `getReviewEngineForUser()`:

```typescript
import { decrypt, isEncrypted } from "../utils/crypto";

// After fetching aiProvider, decrypt the key:
const apiKey =
  aiProvider.apiKey && isEncrypted(aiProvider.apiKey)
    ? decrypt(aiProvider.apiKey)
    : aiProvider.apiKey || "";
```

**Step 3: Run build**

Run: `pnpm run build --filter @opencode-review/server`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/server/src/routes/ai-providers.ts packages/server/src/routes/webhooks.ts
git commit -m "feat(server): encrypt AI provider API keys at rest"
```

---

### Task 4: Encrypt Repository Access Tokens

**Files:**

- Modify: `packages/server/src/routes/repos.ts` — encrypt `accessToken` on write, decrypt on read and when creating provider

**Step 1: Update repos routes**

Same pattern: encrypt on POST/PUT, decrypt on GET and when `accessToken` is used to create a provider instance.

**Step 2: Run build**

Run: `pnpm run build --filter @opencode-review/server`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/server/src/routes/repos.ts
git commit -m "feat(server): encrypt repository access tokens at rest"
```

---

### Task 5: Require Critical Secrets at Startup + Fix Password Hashing

**Files:**

- Modify: `packages/server/src/index.ts` — add startup validation for required env vars
- Modify: `packages/server/src/middleware/auth.ts` — remove hardcoded JWT fallback, fail if missing
- Modify: `packages/server/src/routes/auth.ts` — remove default ADMIN_SECRET
- Modify: `packages/server/src/db/client.ts` — stop logging admin password to console; use a proper hash for seed password
- Modify: `docker/.env.example` — add `ENCRYPTION_KEY` variable documentation

**Step 1: Add startup env validation in index.ts**

At the top of the startup flow (before `initDatabase`), add:

```typescript
// Validate required environment variables
const requiredEnvVars = ["JWT_SECRET"] as const;
const missing = requiredEnvVars.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(
    `❌ Missing required environment variables: ${missing.join(", ")}`,
  );
  console.error("See docker/.env.example for configuration reference.");
  process.exit(1);
}

// Warn about optional-but-important vars
if (!process.env.ENCRYPTION_KEY) {
  console.warn(
    "⚠️  ENCRYPTION_KEY not set — stored tokens/API keys will NOT be encrypted.",
  );
  console.warn(
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}
```

**Step 2: Remove hardcoded JWT_SECRET fallback**

In `packages/server/src/middleware/auth.ts`, change:

```typescript
// Before:
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "opencode-review-secret-change-in-production",
);
// After:
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
```

The startup validation in index.ts ensures JWT_SECRET exists before this code runs.

**Step 3: Remove default ADMIN_SECRET in auth.ts login route**

In `packages/server/src/routes/auth.ts`, the login handler uses:

```typescript
const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin";
```

Change to:

```typescript
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  return c.json(
    {
      success: false,
      error: { code: "SERVER_ERROR", message: "ADMIN_SECRET not configured" },
    },
    500,
  );
}
```

**Step 4: Fix seed password logging**

In `packages/server/src/db/client.ts` `seedDatabase()`:

- Do NOT log the password to console
- Log only: `"Default admin user created. Set ADMIN_PASSWORD env var to configure."`

**Step 5: Update docker/.env.example**

Add:

```env
# Encryption key for storing tokens/API keys at rest (32 bytes, hex-encoded)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=
```

**Step 6: Run build**

Run: `pnpm run build`
Expected: Build succeeds (all 3 packages)

**Step 7: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/middleware/auth.ts packages/server/src/routes/auth.ts packages/server/src/db/client.ts docker/.env.example
git commit -m "security(server): require JWT_SECRET at startup, remove hardcoded defaults, stop logging admin password"
```

---

### Task 6: Add Missing DB Index on api_keys.key_hash

**Files:**

- Modify: `packages/server/src/db/schema/index.ts` — add index definition
- Modify: `packages/server/src/db/client.ts` — add migration SQL

**Step 1: Add index to Drizzle schema**

In `packages/server/src/db/schema/index.ts`, change the `apiKeys` table definition to include an index function:

```typescript
export const apiKeys = pgTable(
  "api_keys",
  {
    // ... existing columns
  },
  (table) => ({
    userIdx: index("idx_api_keys_user_id").on(table.userId),
    keyHashIdx: index("idx_api_keys_key_hash").on(table.keyHash),
  }),
);
```

Note: Currently `apiKeys` doesn't have an index function parameter — the `userIdx` was added via raw SQL migration. We need to add the table's index callback.

**Step 2: Add migration SQL**

In `packages/server/src/db/client.ts` `runMigrations()`, add to the incremental migrations:

```sql
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
```

**Step 3: Run build**

Run: `pnpm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/server/src/db/schema/index.ts packages/server/src/db/client.ts
git commit -m "perf(server): add index on api_keys.key_hash for auth lookup performance"
```

---

## Track B: Feature Completeness

### Task 7: Add Runtime Zod Validation for AI Output

**Files:**

- Modify: `packages/core/src/review/engine.ts` — add `reviewResultSchema.parse()` after agent response

**Step 1: Add Zod validation after agent.generate()**

In `packages/core/src/review/engine.ts`, change:

```typescript
// Before (line ~139):
const output = result.object as ReviewOutput;

// After:
const parsed = reviewResultSchema.safeParse(result.object);
if (!parsed.success) {
  if (this.config.debug) {
    console.error(
      "[ReviewEngine] AI output validation failed:",
      parsed.error.format(),
    );
  }
  return {
    success: false,
    error: `AI output validation failed: ${parsed.error.message}`,
    durationMs: Date.now() - startTime,
  };
}
const output: ReviewOutput = parsed.data;
```

**Step 2: Run build**

Run: `pnpm run build --filter @opencode-review/core`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/core/src/review/engine.ts
git commit -m "fix(core): validate AI output with Zod schema instead of unsafe cast"
```

---

### Task 8: Add Fetch Timeout to BaseProvider

**Files:**

- Modify: `packages/core/src/providers/base.ts` — add AbortController with configurable timeout

**Step 1: Add timeout to BaseProvider.fetch()**

```typescript
// In base.ts, modify the fetch method:
protected async fetch<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = 30_000
): Promise<T> {
  const url = `${this.baseUrl}${endpoint}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      throw new Error(
        `${this.name} API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`
      )
    }

    return response.json()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${this.name} API request timed out after ${timeoutMs}ms: ${endpoint}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
```

Also add a larger timeout for diff fetching — override in subclass calls:

```typescript
// In GiteaProvider.getPullRequestDiff and GitLabProvider.getPullRequestDiff:
// Pass timeoutMs: 60_000 for diff fetches (can be large)
```

**Step 2: Verify existing callers are unaffected (timeoutMs is optional with default)**

Run: `pnpm run build --filter @opencode-review/core`
Expected: Build succeeds — no breaking changes

**Step 3: Commit**

```bash
git add packages/core/src/providers/base.ts
git commit -m "fix(core): add fetch timeout to BaseProvider to prevent hung requests"
```

---

### Task 9: Implement GitHub Provider

**Files:**

- Create: `packages/core/src/providers/github.ts`
- Modify: `packages/core/src/providers/index.ts` — register GitHub provider
- Test: `packages/core/src/providers/__tests__/github.test.ts`

**Reference:** Follow the same pattern as `GiteaProvider` (556 lines) and `GitLabProvider` (779 lines). The `GitProvider` interface from `types.ts` defines all required methods. GitHub REST API v3 is the target.

**Step 1: Create GitHubProvider skeleton implementing GitProvider**

```typescript
// packages/core/src/providers/github.ts
import { BaseProvider } from "./base";
import type {
  ProviderType,
  ListRepositoriesParams,
  ListRepositoriesResponse,
  Organization,
  CreateWebhookRequest,
  Webhook,
} from "./types";
import type {
  Repository,
  PullRequest,
  ChangedFile,
  CreateReviewRequest,
  Review,
  Comment,
  LineCommentRequest,
  User,
} from "../types";
import type { WebhookEvent } from "../events/types";

export class GitHubProvider extends BaseProvider {
  readonly name: ProviderType = "github";

  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  // ... implement all GitProvider interface methods
  // Key differences from Gitea:
  // - API base: /repos/{owner}/{repo}
  // - Diff endpoint: GET /repos/{owner}/{repo}/pulls/{number} with Accept: application/vnd.github.diff
  // - Review endpoint: POST /repos/{owner}/{repo}/pulls/{number}/reviews
  // - Webhook signature: X-Hub-Signature-256 header with sha256=HMAC
}
```

**Step 2: Implement all required methods**

Required methods from `GitProvider` interface:

1. `listUserRepositories` — `GET /user/repos`
2. `listUserOrganizations` — `GET /user/orgs`
3. `listOrganizationRepositories` — `GET /orgs/{org}/repos`
4. `getRepository` — `GET /repos/{owner}/{repo}`
5. `getPullRequest` — `GET /repos/{owner}/{repo}/pulls/{number}`
6. `getPullRequestDiff` — `GET /repos/{owner}/{repo}/pulls/{number}` with `Accept: application/vnd.github.diff`
7. `getPullRequestFiles` — `GET /repos/{owner}/{repo}/pulls/{number}/files`
8. `createReview` — `POST /repos/{owner}/{repo}/pulls/{number}/reviews`
9. `createComment` — `POST /repos/{owner}/{repo}/issues/{number}/comments`
10. `createLineComment` — `POST /repos/{owner}/{repo}/pulls/{number}/comments`
11. `verifyWebhookSignature` — HMAC-SHA256 with `sha256=` prefix (use `verifyHmacSha256` from BaseProvider)
12. `parseWebhookEvent` — Parse `X-GitHub-Event` header + payload
13. `createWebhook` — `POST /repos/{owner}/{repo}/hooks`
14. `deleteWebhook` — `DELETE /repos/{owner}/{repo}/hooks/{hook_id}`
15. `listWebhooks` — `GET /repos/{owner}/{repo}/hooks`

**Step 3: Register in providers/index.ts**

```typescript
import { GitHubProvider } from './github'
export { GitHubProvider } from './github'

// In createProvider:
case 'github':
  return new GitHubProvider(config.baseUrl, config.token)

// In createProviderFromEnv:
if (env.GITHUB_SERVER_URL && env.GITHUB_TOKEN) {
  if (env.GITHUB_SERVER_URL.includes('github.com')) {
    return new GitHubProvider('https://api.github.com', env.GITHUB_TOKEN)
  }
  // Might be Gitea with GitHub-style vars
  return new GiteaProvider(env.GITHUB_SERVER_URL, env.GITHUB_TOKEN)
}

// In getSupportedProviders:
return ['gitea', 'github', 'gitlab']
```

**Step 4: Run build**

Run: `pnpm run build --filter @opencode-review/core`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/core/src/providers/github.ts packages/core/src/providers/index.ts
git commit -m "feat(core): implement GitHub provider with full GitProvider interface"
```

---

### Task 10: Implement Review Retry Trigger

**Files:**

- Modify: `packages/server/src/routes/reviews.ts` — implement the retry logic that actually triggers review execution
- Reference: `packages/server/src/routes/webhooks.ts` — `executeReviewAsync` function for review execution pattern

**Step 1: Import and call executeReviewAsync in retry handler**

The retry handler at `POST /reviews/:id/retry` currently resets the DB status but doesn't trigger the engine. We need to:

1. Look up the repository and its platform credential / AI provider
2. Call the same review execution flow as webhooks.ts

The cleanest approach is to extract `executeReviewAsync` into a shared module, or import it from webhooks. Since `executeReviewAsync` is defined inside `webhooks.ts`, we should extract it:

Create: `packages/server/src/services/review-executor.ts` — extract `executeReviewAsync` and `getReviewEngineForUser` from webhooks.ts

```typescript
// packages/server/src/services/review-executor.ts
// Extract the review execution logic from webhooks.ts into a reusable service
// This includes: getReviewEngineForUser, getDefaultReviewEngine, executeReviewAsync
```

Then in `reviews.ts` retry handler:

```typescript
import { executeReviewForRetry } from "../services/review-executor";

// After resetting the review status:
// Fire and forget the retry execution
executeReviewForRetry(review.id, repo).catch((err) => {
  console.error(`[Review Retry] Failed for review ${id}:`, err);
});
```

**Step 2: Run build**

Run: `pnpm run build --filter @opencode-review/server`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/server/src/services/review-executor.ts packages/server/src/routes/reviews.ts packages/server/src/routes/webhooks.ts
git commit -m "feat(server): implement review retry by extracting review executor service"
```

---

### Task 11: Add Pagination to Repository Listing

**Files:**

- Modify: `packages/server/src/routes/repos.ts` — add query params for page/limit/filters

**Step 1: Add Zod schema for query params**

```typescript
const listReposQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  provider: z.enum(["gitea", "github", "gitlab"]).optional(),
  enabled: z.enum(["true", "false"]).optional(),
  search: z.string().optional(),
});
```

**Step 2: Update GET /repositories handler**

Replace the existing handler with paginated query (same pattern as `reviews.ts` list endpoint).

**Step 3: Run build**

Run: `pnpm run build --filter @opencode-review/server`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/server/src/routes/repos.ts
git commit -m "feat(server): add pagination and filtering to repository listing"
```

---

## Track C: Documentation & Cleanup

### Task 12: Update README.md

**Files:**

- Modify: `README.md` (root)

**Step 1: Update the following sections:**

- Change "Bun" references to "Node.js + pnpm"
- Change web status from "Coming soon" to "✅ Complete"
- Update Roadmap to reflect completed items
- Update Development section commands (`pnpm install`, `pnpm run dev`, etc.)
- Add `ENCRYPTION_KEY` to env var table
- Remove `ADMIN_SECRET` default value mention, note it's required

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README to reflect Node/pnpm migration and completed features"
```

---

## Setup: Test Infrastructure (Run First)

Before Task 1, set up Vitest for the server package:

**Files:**

- Modify: `packages/server/package.json` — add vitest dev dependency
- Create: `packages/server/vitest.config.ts`

```bash
# Install vitest in server package
pnpm add -D vitest --filter @opencode-review/server
```

```typescript
// packages/server/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

```bash
git add packages/server/package.json packages/server/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(server): add vitest test infrastructure"
```

---

## Execution Order

```
Setup (vitest) → Task 1 (crypto) → Tasks 2-4 (encrypt tokens, parallel) → Task 5 (startup validation) → Task 6 (DB index)
                                                                            ↓
                                                          Tasks 7-11 (features, parallel-safe)
                                                                            ↓
                                                              Task 12 (README update)
```

Total: ~12 tasks, estimated 3-4 implementation sessions.
