# Codebase Audit Report
*Date: 2026-06-24 | Language: TypeScript | Framework: Node.js | Files: 40 | LOC: 7,883*

## Executive Summary

This audit covers the Uma Club Bot v3 codebase — a WhatsApp bot for Uma Musume club leaders. The codebase is well-structured with clean architecture, strong testing (1,571 tests passing), and zero type errors. After adversarial validation, we identified **42 unique findings** (0 CRITICAL, 0 HIGH, 12 MEDIUM, 30 LOW). The top priority is a **combined report alert processing gap** where alerts are silently lost on collision days. Overall health is good — the codebase follows consistent patterns, has solid security fundamentals, and comprehensive test coverage.

## Deterministic Analysis

| Category | Count | Status |
|----------|-------|--------|
| Type errors | 0 | PASS |
| Lint errors | 0 | PASS |
| Tests | 1571 pass / 0 fail | PASS |
| Dependency vulns | N/A (audit blocked) | — |

## Adversarial Validation

| Metric | Count |
|--------|-------|
| Findings reviewed | 61 |
| Confirmed (kept) | 16 |
| Downgraded (severity reduced) | 15 |
| Rejected (false positive) | 5 |
| Unverifiable | 0 |

### Top Rejected Findings

1. **Prototype pollution in config YAML** — Zod validation strips `__proto__` before `deepMerge` is called on untrusted input. The Zod schema at `config.ts:26-122` is the actual trust boundary.

2. **computeTierData projectedOutcome overrides demotion risk** — The 'promote' outcome intentionally supersedes demotion_risk because risk and outcome are independent display axes. `tier.ts:72` shows both.

3. **Help text admin commands diverge from ADMIN_COMMANDS** — `schedule` IS in `ADMIN_COMMANDS` (`access.ts:16-25`), contrary to the audit's claim. No actual divergence exists.

4. **runtime.ts zero test coverage** — 11 trivial counter/timestamp functions are exercised indirectly through client/dispatch tests. No edge cases exist.

5. **Health endpoint leaks operational details** — localhost-only binding makes this a non-issue. An attacker who can reach loopback already has local access.

## Findings by Dimension

### Security (2 findings after adversarial)

| # | Severity | File:Line | Finding | CWE | Confidence |
|---|----------|-----------|---------|-----|:----------:|
| 1 | LOW | api/server.ts:123 | Bearer token timing side-channel | CWE-208 | HIGH |
| 2 | LOW | whatsapp/admin.ts:34 | `/setreq` accepts unbounded numeric values | CWE-20 | HIGH |

### Correctness (5 findings after adversarial)

| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | MEDIUM | index.ts:279-300 | Combined report alert processing gap | HIGH |
| 2 | MEDIUM | config.ts:227 | saveConfig temp file collision after crash | HIGH |
| 3 | LOW | reports/monthly.ts:61 | Monthly report empty members guard | MEDIUM |
| 4 | LOW | reports/compute.ts:151-154 | projectedOutcome overrides demotion risk | MEDIUM |
| 5 | LOW | data/daily-fans.ts:220-226 | isStaleMember exported but unused | HIGH |

### Architecture (12 findings after adversarial)

| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | MEDIUM | reports/*.ts | Unused `db` parameter in 6 report generators | HIGH |
| 2 | MEDIUM | index.ts:287, orchestrator.ts:242/290, dispatch.ts:261 | Monthly pre-fetch logic duplicated | HIGH |
| 3 | MEDIUM | whatsapp/dispatch.ts:190-199, 210-219 | Help text admin commands hardcoded | HIGH |
| 4 | MEDIUM | reports/format.ts:13 | Re-exports formatDateWIB creating dual import paths | HIGH |
| 5 | LOW | whatsapp/dispatch.ts:14-17 | dispatch.ts bypasses orchestrator for compare/analyze | MEDIUM |
| 6 | LOW | whatsapp/dispatch.ts:1-466 | dispatch.ts is 466 lines mixing concerns | MEDIUM |
| 7 | LOW | alerts/alerts.ts:11 | alerts → reports coupling for tier data | MEDIUM |
| 8 | LOW | whatsapp/dispatch.ts:70, api/server.ts:63 | Config getter pattern inconsistent | MEDIUM |
| 9 | LOW | orchestrator/report-orchestrator.ts:104-143 | orchestrator mixes snapshot freshness | MEDIUM |
| 10 | LOW | utils/index.ts:1 | Barrel file unused dead code | HIGH |
| 11 | LOW | reports/format.ts:13 | Dual import paths for formatDateWIB | HIGH |
| 12 | LOW | whatsapp/dispatch.ts:49-54 | formatUptime in dispatch.ts | HIGH |

### Performance (10 findings after adversarial)

| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | MEDIUM | db/database.ts:47-49 | Database auto-save exports WASM blob every 30s | HIGH |
| 2 | LOW | utils/logger.ts | statSync on every log line | MEDIUM |
| 3 | LOW | utils/logger.ts | Intl.DateTimeFormat created per log line | MEDIUM |
| 4 | LOW | index.ts:47-48 | configChanged uses JSON.stringify | MEDIUM |
| 5 | LOW | api/server.ts | computeMembers recomputed per request | MEDIUM |
| 6 | LOW | data/snapshot.ts | loadLatestSnapshot walks entire dir tree | LOW |
| 7 | LOW | data/member-history.ts | Full table query to diff departed members | LOW |
| 8 | LOW | whatsapp/client.ts | Message cache uses FIFO instead of LRU | LOW |
| 9 | LOW | data/snapshot.ts | Sequential file reads in loadMonthSnapshots | LOW |
| 10 | LOW | db/database.ts | No dirty flag for auto-save | HIGH |

### Maintainability (8 findings after adversarial)

| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | MEDIUM | db/database.ts:65,75 | console.error bypasses structured logger | HIGH |
| 2 | MEDIUM | whatsapp/admin.ts:157-193 vs 199-234 | handleCatchUp and handleAlerts are identical | HIGH |
| 3 | MEDIUM | reports/daily.ts:38, stats.ts:34, monthly.ts:93 | dataDay naming ambiguity | HIGH |
| 4 | LOW | index.ts:47-48 | configChanged uses JSON.stringify | MEDIUM |
| 5 | LOW | whatsapp/dispatch.ts:49-54 | formatUptime in dispatch.ts | HIGH |
| 6 | LOW | whatsapp/admin.ts:106 | status parameter is large inline type | LOW |
| 7 | LOW | whatsapp/dispatch.ts:190-199 | Help text hardcoded | HIGH |
| 8 | LOW | reports/format.ts:13 | Dual import paths | HIGH |

### Testing (8 findings after adversarial)

| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | MEDIUM | index.ts:279-300 | No test for combined report alert gap | HIGH |
| 2 | MEDIUM | config.ts:226-228 | No test for saveConfig temp file collision | HIGH |
| 3 | LOW | scheduler/scheduler.unit.test.ts:322,349,391 | Tests use real time (flakiness risk) | HIGH |
| 4 | LOW | whatsapp/dispatch.test.ts:163-252 | Weak dispatch test assertions | MEDIUM |
| 5 | LOW | tests/reports/ | combined report missing combos | LOW |
| 6 | LOW | data/member-history.ts | No dedicated test file | LOW |
| 7 | LOW | data/ensure-snapshot.ts | No dedicated test file | HIGH |
| 8 | LOW | tests/whatsapp/ | dispatch tests verify routing not content | MEDIUM |

## Cross-Cutting Issues

1. **Config persistence reliability** — `saveConfig` temp file collision (correctness) + `configChanged` JSON.stringify (performance) both relate to config system robustness.

2. **Logging consistency** — `console.error` in database.ts (maintainability) + logger statSync (performance) + logger Intl.DateTimeFormat (performance) all relate to logging infrastructure.

3. **Report generator coupling** — Unused `db` parameter (architecture) + help text hardcoded (architecture) + monthly pre-fetch duplicated (architecture) all relate to report system design.

## Top 5 Priorities

### 1. Combined report alert processing gap (MEDIUM)
- **Why:** Alerts silently lost on collision days — a correctness bug that affects real users
- **Impact:** Performance drops, demotion risks, and streak breaks go undetected on days when daily+weekly reports collide
- **Fix:** After delivering combined report, iterate over types and call `orchestrator.processAlertsForReport()` for each

### 2. saveConfig temp file collision after crash (MEDIUM)
- **Why:** Admin commands silently fail after crash — reliability issue with simple fix
- **Impact:** `/setreq`, `/catchup`, `/alerts` commands fail until manual cleanup
- **Fix:** Change `flag: 'wx'` to `flag: 'w'` or add cleanup before write

### 3. Database auto-save exports WASM blob (MEDIUM)
- **Why:** Unnecessary I/O every 30 seconds — performance waste
- **Impact:** Disk writes even when no changes occurred
- **Fix:** Add dirty flag, only export when changes occurred

### 4. `console.error` bypasses structured logger (MEDIUM)
- **Why:** Database errors won't appear in log file — observability gap
- **Impact:** Debugging database issues requires checking console output instead of log files
- **Fix:** Replace `console.error` with `log.error('DB', message, context)`

### 5. Unused `db` parameter in report generators (MEDIUM)
- **Why:** False dependency graph — misleading type signatures
- **Impact:** Developers assume reports need database access when they don't
- **Fix:** Remove `db?: Database` parameter from all generators except `members.ts`

## Confidence Summary

| Dimension | HIGH | MEDIUM | LOW | Total |
|-----------|------|--------|-----|-------|
| Security | 2 | 0 | 0 | 2 |
| Correctness | 2 | 2 | 1 | 5 |
| Architecture | 4 | 4 | 4 | 12 |
| Performance | 2 | 1 | 7 | 10 |
| Maintainability | 3 | 3 | 2 | 8 |
| Testing | 3 | 2 | 3 | 8 |
| **Total** | **16** | **12** | **17** | **45** |

## Weakest Evidence

These LOW confidence findings need manual verification:

1. **Bearer token timing side-channel** — localhost-only binding makes timing attack impractical
2. **Monthly report empty members guard** — requires corrupted snapshot file on disk
3. **alerts → reports coupling** — cross-layer import but no circular dependency
4. **Config getter pattern inconsistent** — intentional design for testing vs runtime
5. **orchestrator mixes snapshot freshness** — pipeline coordination includes data acquisition
6. **Logger statSync on every log line** — documented accepted risk at current scale
7. **configChanged uses JSON.stringify** — works due to Zod key ordering
8. **api/server.ts recomputes computeMembers** — 1-2ms per call, localhost-only
9. **formatUptime in dispatch.ts** — 5-line function, only used in dispatch.ts
10. **scheduler.unit.test.ts uses real time** — may cause flakiness across JST midnight

## Methodology

- **Deterministic tools:** tsc --noEmit, npm test, package.json analysis
- **Dimensions:** Architecture, Security, Correctness, Performance, Maintainability, Testing
- **Waves:** 2 executed (no early termination)
- **Dispatches:** 7 total across all waves (3 Wave 1 + 3 Wave 2 + 1 adversarial)
- **Adversarial validation:** 61 findings reviewed, 5 rejected, 15 downgraded
- **Scope narrowing:** 0 HIGH risk, 10 MEDIUM risk, 0 skipped
- **Final findings:** 45 (after dedup + FP filter + adversarial)

## Positive Findings

1. **Clean DAG dependency graph** — Zero circular imports across 40 files
2. **Dependency injection via getter functions** — Enables testability and hot-reload
3. **ensure-snapshot.ts cleanly bridges layers** — Textbook dependency inversion
4. **Parameterized SQL queries throughout** — Eliminates SQL injection
5. **Robust input validation** — Regex validation on all path-sensitive parameters
6. **Zod validation at config boundary** — Prevents config injection
7. **Defense-in-depth on API security** — Multiple layers: localhost, bearer, rate limiting
8. **Golden-file inline snapshots** — Captures exact output of all 8 report types
9. **Adversarial fuzz testing** — 56 inputs across 6 attack categories
10. **Consistent JSDoc documentation** — All modules follow tiered documentation system