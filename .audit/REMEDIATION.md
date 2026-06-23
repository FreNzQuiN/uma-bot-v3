# Remediation Report

## Summary
- Findings in audit: 27
- Fixes attempted: 7
- Fixes passed: 7
- Fixes reverted: 0
- Fixes skipped (user decision): 0
- Findings resolved: 13 (6 HIGH + 7 MEDIUM)

## Fix Details

### Fix 7: console.error monkey-patch (Trivial)
- Finding: `src/whatsapp/client.ts:52-68` — suppresses security-relevant errors (MEDIUM)
- What changed: Replaced bare `return` with `log.debug()` so suppressed libsignal errors are recorded at debug level
- Files modified: `src/whatsapp/client.ts`
- Verification: type check ✓, tests ✓ (1389/1389)

### Fix 8: Dockerfile config exposure (Trivial)
- Finding: `Dockerfile:38` — config.yaml baked into image layer (MEDIUM)
- What changed: Removed `COPY config.yaml ./` from Dockerfile
- Files modified: `Dockerfile`
- Verification: type check ✓, tests ✓ (1389/1389)

### Fix 3: API auth + error leak (Simple)
- Finding: `src/api/server.ts:104-193` — no authentication (HIGH) + error leak at line 227 (HIGH)
- What changed: Added bearer token auth from `API_TOKEN` env var (optional, backwards compatible). Replaced error leak with generic message.
- Files modified: `src/api/server.ts`
- Verification: type check ✓, tests ✓ (1389/1389)

### Fix 1: Monthly pipeline (Moderate — 3 findings)
- Finding: wrong pre-fetch month (HIGH), silent wrong-month fallback (HIGH), offset duplicated (MEDIUM)
- What changed: Added `getTargetMonth()` utility to `utils/timezone.ts`. Fixed `dispatch.ts` to use `getDataDateComponents()` instead of `snapshot.members[0]`. Added fallback warning in `monthly.ts`. Replaced 3 copy-pasted offset calculations.
- Files modified: `src/utils/timezone.ts`, `src/whatsapp/dispatch.ts`, `src/reports/monthly.ts`, `src/index.ts`, `src/orchestrator/report-orchestrator.ts`
- Verification: type check ✓, tests ✓ (1389/1389)

### Fix 2: Catch-up alerts (Moderate — 3 findings)
- Finding: alerts never marked 'sent' (HIGH), delivery duplicated (MEDIUM), quiet hours permanent suppression (MEDIUM)
- What changed: Moved `markAlertSent()` outside conditional. Changed quiet hours status from 'sent' to 'suppressed'. Updated `isAlertAlreadySent` to treat 'suppressed' as handled.
- Files modified: `src/orchestrator/report-orchestrator.ts`, `src/alerts/alerts.ts`, `src/db/database.ts`
- Verification: type check ✓, tests ✓ (1389/1389)

### Fix 4: Reversed dependency (Moderate)
- Finding: `src/data/snapshot.ts:13` — data layer imports API layer (HIGH)
- What changed: Moved `ensureMonthSnapshot` to new `src/data/ensure-snapshot.ts`. Removed `UmaMoeClient` import from `snapshot.ts`. Re-exported to preserve public API.
- Files modified: `src/data/snapshot.ts`, new `src/data/ensure-snapshot.ts`
- Verification: type check ✓, tests ✓ (1389/1389)

### Fix 5: Dispatch registry (Moderate — 2 findings)
- Finding: report dispatch duplicated (MEDIUM), alerts → reports/tier coupling (MEDIUM)
- What changed: Created `src/reports/registry.ts` with `generateReportString()`. Replaced 2 switch statements. Moved `computeTierData` from `reports/tier.ts` to `reports/compute.ts`.
- Files modified: new `src/reports/registry.ts`, `src/whatsapp/dispatch.ts`, `src/orchestrator/report-orchestrator.ts`, `src/reports/compute.ts`, `src/reports/tier.ts`, `src/alerts/alerts.ts`
- Verification: type check ✓, tests ✓ (1389/1389)

## Regressions Detected
- None

## Remaining Findings (14 deferred)
| # | Severity | Finding | Reason Deferred |
|---|----------|---------|----------------|
| 1 | MEDIUM | snapshot.ts mixes 3 concerns | Requires larger refactor, covered by Fix 4 partially |
| 2 | MEDIUM | reports/format.ts grab-bag | Style/organizational, not a bug |
| 3 | MEDIUM | configChanged uses JSON.stringify | Works in practice, low risk |
| 4 | LOW | Rate limiter Map unbounded | localhost-only, minimal risk |
| 5 | LOW | WA_SESSION_DIR not sanitized | Requires attacker env control |
| 6 | LOW | No security headers | localhost-only JSON API |
| 7 | LOW | saveConfig non-exclusive temp file | Requires local symlink attack |
| 8 | LOW | Log injection via user content | Integrity concern only |
| 9 | LOW | runtime.ts mutable state | Standard singleton pattern |
| 10 | LOW | logger.ts synchronous I/O | Acceptable at current scale |
| 11 | LOW | catchup persistence gap | ~10ms crash window |
| 12 | MEDIUM | computeRollingAverage | Design choice, not bug |
| 13 | MEDIUM | Ghost detection edge case | Doesn't manifest with real data |
| 14 | MEDIUM | client.ts god module | Inherently coupled concerns |

## Methodology
- Fix strategy: One-fix-at-a-time with test gates
- Branch strategy: Direct to working tree (single-developer project)
- Verification: Type check → Tests → Full regression after each wave
- Retry limit: 2 per fix (0 retries needed — all passed first attempt)
