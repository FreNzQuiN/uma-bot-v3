# Security Audit Findings

## Summary
3 findings: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW

## Findings

### [MEDIUM] API authentication bypassed when API_TOKEN env var is unset
- File: `src/api/server.ts:123`
- What: When `API_TOKEN` is not set, the bearer token check at line 123 is skipped entirely — all API endpoints respond without authentication.
- Why: If the bind address were ever changed from `127.0.0.1` (currently hardcoded at line 85), the API would be fully open to the network. Even on localhost, any local process or browser tab could call `/health`, `/reports/*`, `/members/*`, `/groups`, `/chats`, and `/snapshots` without credentials. The `API_TOKEN` being optional is documented, but there's no warning or startup log when auth is disabled.
- How: Log a warning at startup when `API_TOKEN` is not set: `log.warn('API', 'No API_TOKEN set — API endpoints are unauthenticated. This is acceptable for localhost-only use.').` Optionally add a config field to explicitly opt into no-auth mode, so the absence of a token is an intentional choice rather than an accidental omission.
- Confidence: HIGH

### [LOW] Bearer token comparison uses non-constant-time operator
- File: `src/api/server.ts:125`
- What: The bearer token check uses JavaScript's `!==` operator (`authHeader !== \`Bearer ${this.apiToken}\``), which short-circuits on the first mismatched character.
- Why: A theoretical timing side-channel could reveal how many characters of the token match before a mismatch. Practical exploitation is negligible because: (1) the API binds to localhost only, (2) an attacker with local access already has process-level access, and (3) network jitter dominates comparison time. Still, it's a best-practice gap.
- How: Use a constant-time string comparison. Node.js 20+ has `crypto.timingSafeEqual`; for Node 18 compatibility, use a constant-time comparison helper:
  ```typescript
  import crypto from 'crypto';
  function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
  // Then:
  const expected = `Bearer ${this.apiToken}`;
  if (!authHeader || authHeader.length !== expected.length || !safeEqual(authHeader, expected)) {
    ...
  }
  ```
- Confidence: HIGH

### [LOW] Admin /setreq command saves config to disk without Zod validation
- File: `src/whatsapp/admin.ts:40-49`
- What: `handleSetReq` manually constructs the updated config object and calls `saveConfig(updated)` directly, bypassing Zod validation. If a future change introduces a type mismatch or an invalid value slips through, it writes directly to `config.yaml`.
- Why: On next hot-reload (5s polling), `loadConfig()` calls `validateConfig()` which would reject the invalid value and keep the old in-memory config. However, the corrupted value persists on disk until manually fixed. Currently the risk is minimal because `parseInt(args[1], 10)` with the `isNaN(value) || value < 0` check at line 36 covers the basic cases, and the Zod schema has wide ranges.
- How: Run `validateConfig(updated)` before `saveConfig(updated)` to catch any issues early, or refactor to use `updateConfig(current, updates)` from `config.ts` which applies deep merge + Zod re-validation.
- Confidence: HIGH

## Positive Observations

### [POSITIVE] Consistent parameterized SQL queries across all database operations
- File: `src/db/database.ts` (all methods), `src/db/mysql-database.ts` (all methods)
- What: Every SQL query in both SQLite and MySQL adapters uses parameterized placeholders (`?`), never string interpolation. The dynamic placeholder generation in `getExistingAlertKeys` correctly builds `?` placeholders matching the array length.
- Why: This is the primary defense against SQL injection (CWE-89). The consistent application across 40+ query sites with no exceptions means the attack surface for injection is effectively zero.

### [POSITIVE] API server bound to 127.0.0.1 — no remote access possible
- File: `src/api/server.ts:85`
- What: The HTTP server binds to `127.0.0.1` only, with the comment "Bind to localhost only (security requirement from spec)." The bind address is not configurable.
- Why: This is a strong network-level control that makes all API security concerns (auth, rate limiting, information disclosure) localhost-scoped. An attacker on another machine cannot reach the API at all, regardless of authentication or input validation.

### [POSITIVE] Snapshot file paths validated with strict regex before filesystem operations
- File: `src/data/snapshot.ts:23`
- What: `buildSnapshotPath` validates the `dataDay` parameter against `/^\d{4}-\d{2}-\d{2}$/` before constructing the path. All callers pass data from internal computation (WIB date helpers), not user input.
- Why: This prevents path traversal (CWE-22) by rejecting any input that doesn't match the strict date format. The regex ensures only numeric year/month/day components, making directory traversal sequences like `../` impossible.

### [POSITIVE] WhatsApp command input sanitized before logging
- File: `src/whatsapp/dispatch.ts:117`
- What: User-controlled message content has newlines replaced (`replace(/[\r\n]/g, ' ')`) before being logged, and message content is truncated (`slice(0, 80)`). Chat JIDs have digits replaced with `***` in debug logs.
- Why: Prevents log injection (CWE-117) where crafted messages could inject fake log entries. Also prevents excessive log storage from large messages.

### [POSITIVE] Config validated with Zod schema at load time with strict type checking
- File: `src/config.ts:22-135`
- What: Complete Zod schema with type constraints, regex patterns, range limits, and defaults for every config field. Invalid configs throw immediately with field-level error messages.
- Why: Prevents type confusion, out-of-range values, and missing required fields from propagating into the system. Combined with immutable config pattern (getter function, never mutated), this prevents config corruption during runtime.

## Modules Reviewed
- `src/api/server.ts` — 1 finding (auth bypass)
- `src/whatsapp/dispatch.ts` — clean
- `src/whatsapp/commands.ts` — clean
- `src/whatsapp/access.ts` — clean
- `src/whatsapp/admin.ts` — 1 finding (Zod bypass)
- `src/whatsapp/client.ts` — clean (WA_SESSION_DIR documented as accepted)
- `src/db/database.ts` — clean (parameterized queries)
- `src/db/mysql-database.ts` — clean (parameterized queries)
- `src/db/factory.ts` — clean
- `src/config.ts` — clean
- `src/data/snapshot.ts` — clean (path validation)
- `src/api/uma-moe.ts` — clean (no SSRF — hardcoded URL + validated params)
- `src/index.ts` — clean

## Low-Confidence Notes

- `src/whatsapp/client.ts:273` — `chats.upsert` event handler casts `chat.id` as `string` without validation. If Baileys ever emitted a `null` or non-string `id`, the `jid.endsWith('@g.us')` check at line 277 would throw. Low concern because Baileys guarantees this field type.
- `src/db/database.ts:242-249` — SQLite `recordAlert` has TOCTOU race (check-then-insert). Already documented as acceptable for single-process mode (line 243-245 comment). Would be a concern only if running multiple bot instances against the same SQLite file.
- `src/api/server.ts:106` — `req.headers.host` is used in URL construction. A malformed Host header could cause URL parsing to throw, but the surrounding try/catch (line 131) handles this gracefully with a 500 response.
