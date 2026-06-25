# Codebase Audit Report
*Date: 2026-06-25 | Language: TypeScript | Framework: Node.js | Files: 40 | LOC: 7,974*

## Executive Summary

This audit covers the full Uma Club Bot v3 codebase — a WhatsApp bot for Uma Musume club leaders. The codebase is well-structured with clean layered architecture, no circular dependencies, and exceptional test coverage (1,632 tests across 67 suites). **No CRITICAL findings were identified.** The highest-severity finding is a flaky test caused by a port collision (HIGH). Most findings are MEDIUM-severity maintainability issues (code duplication, parameter threading, function complexity) that slow down feature additions but don't cause bugs today. The adversarial validation phase killed 5 false positives (including 2 HIGH-severity ones that were actually correct code), confirming the codebase is healthier than initial specialist review suggested.

## Deterministic Analysis

| Category | Count | Status |
|----------|-------|--------|
| Type errors | 0 | PASS (tsc --noEmit clean) |
| Lint errors | 0 | N/A (no linter beyond tsc) |
| Tests | 1,632 pass / 0 fail | 84% statements, 70% branches, 83% functions |
| Dependency vulns | Not audited | npm audit blocked by permission rules |

## Adversarial Validation

| Metric | Count |
|--------|-------|
| Findings reviewed | 38 |
| Confirmed (kept) | 32 |
| Downgraded (severity reduced) | 1 |
| Rejected (false positive) | 5 |
| Unverifiable | 0 |

### Top Rejected Findings
1. **[HIGH] Weekly stale offset bug** — The audit misread the parameter flow. `countConsecutiveZeroDaysAtEnd` iterates from its parameter (which receives `viewedEndDay`), not from a hardcoded latest day. The misleading parameter name `latestDataDay` caused the LLM to conclude the code was wrong when it wasn't. (`daily-fans.ts:286`)
2. **[MEDIUM] Daily stale warning ignores offset** — The code has an explicit comment at `daily.ts:118-119` explaining the design choice: warn about snapshot freshness, not historical data completeness. The audit proposed a behavioral change and framed it as a bug.
3. **[HIGH] Missing regression test for stale offset** — Depends on the false positive above. No bug = no test needed.

## Findings by Dimension

### Security [3 findings]
| # | Severity | File:Line | Finding | CWE | Confidence |
|---|----------|-----------|---------|-----|:----------:|
| 1 | MEDIUM | `src/api/server.ts:123` | API auth skipped when API_TOKEN unset — no startup warning | CWE-862 | HIGH |
| 2 | LOW | `src/api/server.ts:125` | Bearer token comparison uses `!==` not constant-time | CWE-208 | HIGH |
| 3 | LOW | `src/whatsapp/admin.ts:40-49` | `/setreq` saves config without Zod validation | CWE-20 | HIGH |

### Correctness [6 findings]
| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | MEDIUM | `src/data/daily-fans.ts:335-336` | `computeTierData` accesses `snapshot.members[0]` without empty-array guard | HIGH |
| 2 | MEDIUM | `src/orchestrator/report-orchestrator.ts:107,125` | `alignSnapshotToMonth` accesses `snapshot.members[0]` without guard | HIGH |
| 3 | LOW | `src/reports/stats.ts:87` | Stale count uses `status === 'stale'` which differs from rolling-window definition | MEDIUM |
| 4 | LOW | `src/data/daily-fans.ts:259-273` | `countActiveDays` includes day 1 baseline as "active" | MEDIUM |
| 5 | LOW | `src/utils/format.ts:57-67` | Non-newline splitting underestimates marker overhead (downgraded from MEDIUM) | MEDIUM |
| 6 | LOW | `src/reports/analyze.ts:39-45` | Consistency includes baseline day (related to #4) | MEDIUM |

### Performance [4 findings]
| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | MEDIUM | `src/data/member-history.ts:30-63` | N+1 queries in `updateMemberHistory` — ~70 individual get+upsert calls | HIGH |
| 2 | MEDIUM | `src/orchestrator/report-orchestrator.ts:197-214` | Individual `recordAlert` + `markAlertSent` per alert in loop (~4N DB ops) | HIGH |
| 3 | LOW | `src/data/snapshot.ts:131-162` | `loadMonthSnapshots` reads ALL 31 files when only latest is needed | MEDIUM |
| 4 | LOW | `src/utils/logger.ts:108-117` | `Intl.DateTimeFormat` recreated on every log line | MEDIUM |

### Maintainability [10 findings]
| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | MEDIUM | `src/reports/registry.ts` + 5 files | Report type knowledge scattered across 6+ files | HIGH |
| 2 | MEDIUM | `src/db/database.ts` + `mysql-database.ts` | Database adapter row mapping duplicated (~60 lines each) | HIGH |
| 3 | MEDIUM | `src/alerts/alerts.ts:35-203` | `detectAlerts` is 200 lines with 5 repeated alert-type patterns | HIGH |
| 4 | MEDIUM | `src/whatsapp/dispatch.ts:54-61` | Parameter threading explosion (7→8→9 params through 3 levels) | HIGH |
| 5 | MEDIUM | `src/scheduler/catchup.ts:179-304` | `executeCatchUp` is 125 lines with 3 divergent code paths | HIGH |
| 6 | MEDIUM | `src/index.ts:59-82` | `configChanged` manually compares 15+ schedule fields | HIGH |
| 7 | MEDIUM | `src/orchestrator/report-orchestrator.ts:146-166` | `generateReportString` method shadows the imported function | HIGH |
| 8 | LOW | `src/db/database.ts:105-112` | `settings` table DDL exists in both adapters with no IDatabase methods | MEDIUM |
| 9 | LOW | `src/db/database.ts:464-466` | `Database` backward-compat aliases are unused dead code | MEDIUM |
| 10 | LOW | `src/data/daily-fans.ts:211-220` | `isStaleMember` is deprecated but still exported | MEDIUM |

### Testing [6 findings]
| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | HIGH | `tests/api/server.integration.test.ts:251` | Port 18767 collision causes flaky test | HIGH |
| 2 | MEDIUM | `tests/scheduler/catchup-regression.test.ts:31,68,112` | Unmocked `new Date()` makes tests date-dependent | MEDIUM |
| 3 | MEDIUM | `src/index.ts:132-198` | Config hot-reload watcher untested (~67 lines of branching) | MEDIUM |
| 4 | MEDIUM | `tests/orchestrator/report-orchestrator.unit.test.ts:353-357` | Module-level `detectAlerts` mock masks behavior | MEDIUM |
| 5 | LOW | `tests/scheduler/scheduler.unit.test.ts:226,244,331,374,399` | `as any` casts access private internals | MEDIUM |
| 6 | LOW | `src/runtime.ts` | No dedicated test file for runtime.ts module | MEDIUM |
| 7 | LOW | `tests/reports/e2e-output.test.ts:33` | Depends on config.yaml on disk | LOW |

## Cross-Cutting Issues

1. **Empty-array guards**: Multiple functions access `snapshot.members[0]` without checking length. Current callers always guard, but the functions themselves are unprotected (correctness findings #1-2).
2. **N+1 database patterns**: Both `updateMemberHistory` and alert processing loop with individual DB calls. With MySQL adapter, these create real latency at startup and per report cycle (performance findings #1-2).
3. **Knowledge scattering**: Report type knowledge is spread across 6+ files, making it easy to miss a location when adding new types (maintainability finding #1).

## Top 5 Priorities

1. **Port 18767 collision (HIGH, testing)** — Quick fix: change one port number. Eliminates the only flaky test.
2. **N+1 queries in updateMemberHistory (MEDIUM, performance)** — Batch the ~70 individual DB calls. Impact: ~70ms saved at startup with MySQL.
3. **N+1 alert recording (MEDIUM, performance)** — Add batch DB methods for alert processing. Impact: ~40 round-trips reduced to ~4 per report.
4. **Report type knowledge scattering (MEDIUM, maintainability)** — Create a central report type registry. Prevents silent failures when adding new report types.
5. **detectAlerts complexity (MEDIUM, maintainability)** — Extract each alert type into its own detector function. Reduces cognitive load and enables independent testing.

## Confidence Summary

| Dimension | HIGH | MEDIUM | LOW | Total |
|-----------|------|--------|-----|-------|
| Security | 3 | 0 | 0 | 3 |
| Correctness | 2 | 0 | 4 | 6 |
| Performance | 2 | 0 | 2 | 4 |
| Maintainability | 7 | 0 | 3 | 10 |
| Testing | 1 | 3 | 3 | 7 |
| **Total** | **15** | **3** | **12** | **32** |

## Weakest Evidence

- **Runtime.ts has no tests** (LOW) — module is simple (93 lines) but mutable state could regress
- **e2e-output.test.ts depends on config.yaml** (LOW) — may produce different results in CI vs dev
- **`as any` casts in scheduler tests** (LOW) — tight coupling to internal structure, but tests work

## Methodology
- Deterministic tools: tsc --noEmit (type check), jest (test suite)
- Dimensions: Security, Correctness, Performance, Maintainability, Testing
- Waves: 2 executed (Wave 1: Security+Correctness+Performance, Wave 2: Maintainability+Testing)
- Dispatches: 6 total across all waves + 1 adversarial validation
- Adversarial validation: 38 findings reviewed, 5 rejected, 1 downgraded
- Scope narrowing: All modules reviewed (small codebase, no skipping needed)
- Final findings: 32 (after dedup + FP filter + adversarial)
