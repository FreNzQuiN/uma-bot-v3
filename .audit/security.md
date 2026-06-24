# Security Audit Findings

## Summary
6 findings: 0 CRITICAL, 0 HIGH, 3 MEDIUM, 3 LOW

## Scope
- 40 source files reviewed (7,883 LOC)
- CWE-20 (Input Validation), CWE-77/89/78 (Injection), CWE-862/863 (Auth/Authz), CWE-798 (Secrets), CWE-22 (Path Traversal), CWE-918 (SSRF), CWE-502 (Deserialization)

## Findings

### [MEDIUM] Bearer token comparison vulnerable to timing side-channel
- File: `src/api/server.ts:123`
- What: Bearer token compared using JavaScript string inequality (`!==`) which short-circuits on first mismatch, leaking timing information about token correctness byte-by-byte.
- Why: An attacker with precise timing measurement capability (e.g., co-located on the same host) could theoretically reconstruct the API token one character at a time through repeated requests.
- How: Use Node.js `crypto.timingSafeEqual()` for constant-time comparison:
  ```typescript
  import crypto from 'crypto';
  // ...
  const expected = `Bearer ${this.apiToken}`;
  const authBuffer = Buffer.from(authHeader ?? '');
  const expectedBuffer = Buffer.from(expected);
  if (authBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(authBuffer, expectedBuffer)) {
  ```
- Confidence: HIGH
- Note: Mitigated by localhost-only binding, but remains a valid defense-in-depth finding.

### [MEDIUM] Config YAML deserialization lacks prototype pollution guard
- File: `src/config.ts:156`
- What: YAML parsed via `parseYaml(raw)` produces a plain JavaScript object that is passed through `deepMerge` (line 199) before Zod validation. The `deepMerge` function recursively merges arbitrary nested objects without checking for `__proto__`, `constructor`, or `prototype` keys.
- Why: If an attacker can write to `config.yaml` (e.g., through a compromised deployment pipeline or shared hosting), they could inject `__proto__` properties that pollute `Object.prototype` for the entire Node.js process, affecting all modules.
- How: Add an explicit guard in `deepMerge` to skip dangerous keys:
  ```typescript
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  for (const [key, value] of Object.entries(source)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    // ...existing merge logic
  }
  ```
  Alternatively, validate the parsed YAML output shape before deep-merging.
- Confidence: MEDIUM
- Note: Mitigated by Zod validation (which only passes known keys) and by config.yaml being gitignored/operator-controlled. The `deepMerge` itself is the gap; Zod catches the result but the intermediate merge is unprotected.

### [MEDIUM] Admin command `/setreq` accepts unbounded numeric values
- File: `src/whatsapp/admin.ts:34`
- What: `parseInt(args[1], 10)` parses the user-provided requirement value without an upper-bound check. The Zod schema for `monthlyFans`/`weeklyFans` uses `.number().min(0)` with no `.max()` constraint, so values like `Number.MAX_SAFE_INTEGER` pass validation and are persisted to `config.yaml`.
- Why: An admin could accidentally or maliciously set an astronomically high requirement that makes all members permanently fail requirements, or cause integer overflow in downstream calculations (e.g., `formatNumber` in `src/utils/format.ts`).
- How: Add a max-value constraint in the Zod schema:
  ```typescript
  monthlyFans: z.number().min(0).max(10_000_000_000).default(20_000_000),
  weeklyFans: z.number().min(0).max(10_000_000_000).default(0),
  ```
  Or validate in `handleSetReq` before calling `saveConfig`.
- Confidence: HIGH
- Note: Requires admin access to exploit, limiting the attack surface.

### [LOW] Global `console.error` monkey-patching suppresses errors process-wide
- File: `src/whatsapp/client.ts:52-69`
- What: `suppressLibsignalErrors()` replaces `console.error` globally for the entire Node.js process. The replacement filters messages containing "Failed to decrypt message", "Session error", or "Bad MAC" and redirects them to `log.debug` instead of `console.error`.
- Why: Any library (sql.js, playwright, node-cron, etc.) that writes to `console.error` with messages containing those substrings would have its errors silently suppressed. An attacker who can trigger error messages containing these exact strings could suppress legitimate security-relevant errors.
- How: Consider using a more targeted approach, such as Baileys' built-in logger adapter (already implemented at lines 81-128) instead of global `console.error` patching. The `createBaileysLogger()` adapter at line 81 already handles this correctly for Baileys' internal logging.
- Confidence: LOW
- Note: Documented in code comments as intentional. The three patterns are highly specific to libsignal. The `createBaileysLogger()` adapter handles Baileys logs without monkey-patching.

### [LOW] Stale temp file blocks config persistence after crash
- File: `src/config.ts:226-228`
- What: `saveConfig` uses atomic write pattern (`writeFileSync` with `flag: 'wx'` + `renameSync`). If the process crashes between these two calls, the `.tmp` file persists. Subsequent calls to `saveConfig` will fail because the `wx` flag requires the file to not exist.
- Why: After a crash, admin commands that modify config (`/setreq`, `/catchup`, `/alerts`) will throw an uncaught error from `writeFileSync`, causing the command to fail silently. The config change is lost.
- How: Add cleanup logic at the start of `saveConfig`:
  ```typescript
  const tmpPath = path + '.tmp';
  try { unlinkSync(tmpPath); } catch { /* ignore */ }
  writeFileSync(tmpPath, raw, { encoding: 'utf-8', flag: 'wx' });
  ```
- Confidence: HIGH
- Note: This is a reliability issue with security implications (config changes silently lost). The error IS caught by the dispatch handler, so the process doesn't crash.

### [LOW] API `/health` endpoint leaks operational details without authentication
- File: `src/api/server.ts:130-131,205-227`
- What: The `/health` endpoint is exempted from bearer token authentication (line 121) and returns detailed operational information: uptime, connection state, reconnection count, message counts, last disconnect reason, and config reload count.
- Why: An attacker who can reach the loopback interface (e.g., through a compromised browser tab or local service) can enumerate bot operational state without authentication, aiding reconnaissance.
- How: Consider splitting into two endpoints: a minimal `/health` (just `{ status: 'ok' }`) for health checks, and a `/health/detail` (with full stats) behind auth. Or gate the detailed fields behind `API_TOKEN` check.
- Confidence: LOW
- Note: Mitigated by localhost-only binding. The Dockerfile health check only uses the basic `success` field.

## Positive Observations

### [POSITIVE] Parameterized SQL queries throughout
- File: `src/db/database.ts:165-167,186-200,209-218,227-231,251-264,293-314,319-324,329-334,351-364,369-378`
- What: All SQL queries use parameterized `?` placeholders with the params array passed to `execSql`/`runSql`. No string interpolation in SQL.
- Why: Completely eliminates SQL injection (CWE-89) across all 5 database tables. This is the gold standard for database access.

### [POSITIVE] Robust input validation on path-sensitive parameters
- File: `src/data/snapshot.ts:24` (`buildSnapshotPath` regex), `src/api/server.ts:177` (`/members/{id}` regex), `src/whatsapp/commands.ts:57` (`parseStrictInt` regex)
- What: All user-influenced or externally-sourced values that affect file paths or database queries are validated with strict regex patterns before use.
- Why: Eliminates path traversal (CWE-22) and type confusion attacks at the trust boundary.

### [POSITIVE] Zod validation at config boundary
- File: `src/config.ts:26-122`
- What: All config values are validated through a comprehensive Zod schema with sensible defaults, type constraints, and format patterns (e.g., `HH:MM` regex for times).
- Why: Prevents config injection, type confusion, and out-of-range values from reaching business logic. Defense-in-depth even if the YAML parser or deepMerge has issues.

### [POSITIVE] Defense-in-depth on API security
- File: `src/api/server.ts:32-34,89,121-127,250-259`
- What: API uses multiple security layers: localhost-only binding, optional bearer token auth, rate limiting (50 req/s), security headers (nosniff, DENY framing, no-cache), and request timeout (30s).
- Why: Even if one layer is bypassed, the others provide protection. Good security architecture.

## Modules Reviewed
- `src/api/server.ts`: 2 findings (timing attack, health endpoint)
- `src/api/uma-moe.ts`: clean — fixed target URL, no user-controlled URLs (SSRF safe)
- `src/config.ts`: 2 findings (prototype pollution gap, temp file staleness)
- `src/db/database.ts`: clean — fully parameterized SQL
- `src/whatsapp/dispatch.ts`: clean — command validation before dispatch
- `src/whatsapp/commands.ts`: clean — strict integer parsing, no injection vectors
- `src/whatsapp/admin.ts`: 1 finding (unbounded numeric value)
- `src/whatsapp/access.ts`: clean — correct JID-based access control
- `src/whatsapp/client.ts`: 1 finding (global console.error patching)
- `src/data/snapshot.ts`: clean — regex-validated paths, structured JSON
- `src/data/ensure-snapshot.ts`: clean
- `src/data/daily-fans.ts`: clean — pure arithmetic
- `src/data/member-history.ts`: clean — parameterized SQL
- `src/alerts/alerts.ts`: clean — parameterized SQL, event_key dedup
- `src/scheduler/scheduler.ts`: clean — cron expressions from validated config
- `src/scheduler/catchup.ts`: clean
- `src/scheduler/helpers.ts`: clean
- `src/orchestrator/report-orchestrator.ts`: clean
- `src/reports/compute.ts`: clean — pure computation
- `src/reports/registry.ts`: clean
- `src/reports/format.ts`: clean
- `src/reports/combined.ts`: clean
- `src/reports/daily.ts`: clean
- `src/reports/weekly.ts`: clean
- `src/reports/monthly.ts`: clean
- `src/reports/ranks.ts`: clean
- `src/reports/bottom.ts`: clean
- `src/reports/stats.ts`: clean
- `src/reports/members.ts`: clean
- `src/reports/tier.ts`: clean
- `src/reports/compare.ts`: clean — `sanitizeName` prevents WhatsApp format injection
- `src/reports/analyze.ts`: clean
- `src/utils/format.ts`: clean — `sanitizeName` escapes formatting chars
- `src/utils/logger.ts`: clean — path from validated config
- `src/utils/timezone.ts`: clean — pure timezone functions
- `src/utils/index.ts`: clean — single re-export
- `src/runtime.ts`: clean — in-memory state only
- `src/types/index.ts`: clean — type definitions only
- `src/index.ts`: clean — hardcoded paths, validated env vars
- `config.example.yaml`: clean — placeholder values, no secrets

## Low-Confidence Notes

- [src/whatsapp/client.ts:57] The `console.error` monkey-patch replaces the global function. While the three suppression patterns are highly specific to libsignal, a more targeted approach (using the existing Baileys logger adapter at line 81) would eliminate this global side effect entirely. The adapter already handles Baileys logs correctly — the monkey-patch may be redundant.

- [src/config.ts:226] The `flag: 'wx'` atomic write pattern is correct but platform-dependent. On Windows NTFS, `renameSync` may not be truly atomic if the target file is open by another process. The Dockerfile targets Linux where this is atomic.

- [Dockerfile:42] The container runs as `node` user (non-root). Good practice. However, `chown -R node:node /app/playwright-browsers` (line 34) runs before `USER node` is set, requiring root for the chown operation during build. This is normal for Docker multi-stage patterns.

## Documented Accepted Risks (Not Flagged)
These are documented in `docs/architecture.md:390-418` and `.audit/architecture.md:607-661`:
- Rate limiter Map unbounded (localhost only) — architecture.md:611
- WA_SESSION_DIR not path-sanitized (operator-controlled env var) — architecture.md:614
- Minimal security headers (JSON-only, localhost) — architecture.md:618
- Single-process architecture — architecture.md:639
- sql.js over sqlite3 — architecture.md:644
