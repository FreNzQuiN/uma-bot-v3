# Codebase Audit Report
*Date: 2026-06-23 | Language: TypeScript | Framework: Node.js (Baileys, sql.js, Playwright) | Files: 37 source + 41 test | LOC: 7,808*

## Executive Summary

The Uma Club Bot v3 codebase is well-structured with strong fundamentals: zero circular dependencies, clean composition root, fully parameterized SQL queries, and 1,389 passing tests. However, **6 high-severity findings** require attention before production deployment. The most critical are: a catch-up alert bug that causes duplicate delivery, incorrect month calculation in monthly reports, and an unauthenticated HTTP API. Architecture is clean overall, with 19 medium-priority design improvements identified. Zero vulnerabilities in 429 dependencies.

## Deterministic Analysis

| Category | Count | Status |
|----------|-------|--------|
| Type errors | 0 | PASS |
| Lint errors | 0 | No linter configured (tsc --noEmit only) |
| Tests | 1,389 pass / 0 fail | PASS (24.9s) |
| Dependency vulns | 0 critical, 0 high, 0 moderate | PASS (npm audit) |

## Adversarial Validation

| Metric | Count |
|--------|-------|
| Findings reviewed | 36 |
| Confirmed (kept) | 18 |
| Downgraded (severity reduced) | 7 |
| Rejected (false positive) | 3 |
| Unverifiable | 0 |

### Top Rejected Findings
1. **"Duplicated dispatch at 3 locations"** — actually 2, not 3. The third "dispatch" in `index.ts` calls `orchestrator.generateCombinedReportString()` — no switch on report type exists there.
2. **"isStaleMember is dead code"** — used extensively in 5+ test files for computing expected values. Not dead.
3. **"runtime.ts mutable state"** — standard Node.js singleton pattern for a single-process bot. By design.

## Findings by Dimension

### Security (9 findings)

| # | Severity | File:Line | Finding | CWE | Confidence |
|---|----------|-----------|---------|-----|:----------:|
| 1 | HIGH | server.ts:104-193 | API server has no authentication | CWE-862 | HIGH |
| 2 | HIGH | server.ts:227 | Error messages leaked in /groups response | CWE-209 | HIGH |
| 3 | MEDIUM | Dockerfile:38 | Config.yaml baked into image layer | CWE-200 | HIGH |
| 4 | MEDIUM | client.ts:52-68 | console.error monkey-patching suppresses security-relevant errors | CWE-779 | MEDIUM |
| 5 | LOW | server.ts:56 | Rate limiter Map grows unbounded (localhost-only, minimal risk) | CWE-400 | MEDIUM |
| 6 | LOW | client.ts:138 | WA_SESSION_DIR env var not sanitized (attacker needs env control) | CWE-22 | MEDIUM |
| 7 | LOW | server.ts:33-34 | No Cache-Control or HSTS headers | CWE-693 | LOW |
| 8 | LOW | config.ts:226-228 | saveConfig uses predictable temp file path | CWE-377 | LOW |
| 9 | LOW | dispatch.ts:134, client.ts:338 | Log injection via user message content | CWE-117 | LOW |

**Positive:** SQL injection fully mitigated — all queries use `?` parameterized placeholders.

### Correctness (7 findings)

| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | HIGH | report-orchestrator.ts:231-236 | Catch-up alerts never marked 'sent' — causes duplicate delivery | HIGH |
| 2 | HIGH | dispatch.ts:269-275 | Monthly pre-fetch calculates wrong target month when snapshot is stale | HIGH |
| 3 | HIGH | monthly.ts:44-60 | Monthly report silently shows wrong month when target snapshot unavailable | HIGH |
| 4 | MEDIUM | alerts.ts:194-211 | Quiet hours permanently suppress alerts with no retry | HIGH |
| 5 | MEDIUM | database.ts:384-389 | Database save() blocks event loop during catch-up | MEDIUM |
| 6 | MEDIUM | daily-fans.ts:244-258 | computeRollingAverage inflates averages by excluding zero-gain days | MEDIUM |
| 7 | MEDIUM | compute.ts:90-104 | Ghost detection can misclassify transfer members as 'left' | MEDIUM |

### Architecture (11 findings)

| # | Severity | File:Line | Finding | Confidence |
|---|----------|-----------|---------|:----------:|
| 1 | HIGH | snapshot.ts:13 | Reversed dependency: data layer imports API layer | HIGH |
| 2 | MEDIUM | dispatch.ts:360-411, report-orchestrator.ts:168-178 | Duplicated report dispatch (2 locations) | HIGH |
| 3 | MEDIUM | index.ts:279, dispatch.ts:268, report-orchestrator.ts:273 | Monthly offset calculation duplicated (3 locations) | HIGH |
| 4 | MEDIUM | report-orchestrator.ts:85-104, index.ts:337-353 | Alert delivery duplicated (orchestrator + catch-up) | HIGH |
| 5 | MEDIUM | snapshot.ts:1-426 | snapshot.ts mixes 3 concerns (file I/O, DB, API) | HIGH |
| 6 | MEDIUM | alerts.ts:11 | Cross-module coupling: alerts → reports/tier | HIGH |
| 7 | MEDIUM | format.ts:1-135 | reports/format.ts is a grab-bag utility module | MEDIUM |
| 8 | MEDIUM | index.ts:42-65 | configChanged uses JSON.stringify for deep comparison | MEDIUM |
| 9 | LOW | runtime.ts:21-39 | Module-level mutable state (standard singleton pattern) | MEDIUM |
| 10 | LOW | logger.ts:183,189 | Synchronous file I/O on every log line | MEDIUM |
| 11 | LOW | catchup.ts:217-230 | Catchup persistence gap (narrow crash window) | HIGH |

**Positive:** Clean composition root, zero circular dependencies, pure report functions.

## Cross-Cutting Issues

1. **Monthly report pipeline** — The monthly report has 3 related issues: wrong pre-fetch month (dispatch.ts:269), silent fallback to wrong data (monthly.ts:59), and duplicated offset calculation (3 locations). These should be fixed together as a single unit.

2. **Alert delivery duplication** — Alert delivery is implemented twice: `orchestrator.deliverAlerts()` for normal flow and `index.ts:337-353` for catch-up. The catch-up path also has the "never marked sent" bug. Both should use a single delivery function.

3. **Data flow violations** — `snapshot.ts` imports from `api/uma-moe.ts` (data→API dependency) and `alerts.ts` imports from `reports/tier.ts` (alerts→reports dependency). Both violate layering.

## Top 5 Priorities

1. **Catch-up alerts duplicate delivery** (HIGH, Correctness) — Users receive the same alert messages multiple times. The `markAlertSent()` call is inside the wrong conditional branch. Fix: move it outside `if (!options?.collectAlerts)` or add a post-delivery marking step in `index.ts:337-353`.

2. **Monthly pre-fetch wrong month** (HIGH, Correctness) — When snapshot is stale, the pre-fetch targets the wrong month entirely. Fix: use `getDataDateComponents()` instead of `snapshot.members[0]` at `dispatch.ts:269`.

3. **Monthly report silent wrong data** (HIGH, Correctness) — Users receive a report labeled with the wrong month containing current month data with no warning. Fix: add a warning line when fallback triggers.

4. **API server no auth** (HIGH, Security) — Any local process can read all member data. Fix: add bearer token authentication.

5. **Reversed dependency: data → API** (HIGH, Architecture) — `snapshot.ts` depends on `api/uma-moe.ts` via `ensureMonthSnapshot`. Fix: move `ensureMonthSnapshot` to the orchestrator layer.

## Confidence Summary

| Dimension | HIGH | MEDIUM | LOW | Total |
|-----------|------|--------|-----|-------|
| Security | 2 | 2 | 5 | 9 |
| Correctness | 3 | 4 | 0 | 7 |
| Architecture | 4 | 5 | 2 | 11 |
| **Total** | **9** | **11** | **7** | **27** |

## Weakest Evidence

These LOW-confidence findings need manual verification:

- **catchup.ts:217-230 persistence gap** — The crash window is ~10ms. The 30s auto-save would persist pending records. Real-world risk is negligible.
- **compute.ts:90-104 ghost detection** — Transfer misclassification is theoretical; real data shows transfer members sort above ghosts.
- **daily-fans.ts:249 rolling average** — The `gain > 0` filter is explicitly documented. This is a design choice, not a bug.
- **server.ts:33-34 missing headers** — API is localhost-only serving JSON. Missing Cache-Control is low practical risk.

## Methodology

- Deterministic tools: `tsc --noEmit` (type check), `npm audit` (dependency vulnerabilities), `npm test` (1,389 tests)
- Dimensions: Architecture, Security, Correctness (3 executed; Performance, Maintainability, Testing skipped — adaptive termination at 35+ findings)
- Waves: 1 executed (3 parallel dispatches) — Wave 2 skipped due to 35+ findings
- Dispatches: 4 total (3 Wave 1 + 1 adversarial)
- Adversarial validation: 36 findings reviewed, 3 rejected, 7 downgraded
- Final findings: 27 (after dedup + FP filter + adversarial)

## Files

All audit artifacts in `.audit/`:
- `context.md` — Project context
- `deterministic.md` — Type check, test, dependency results
- `architecture.md` — Module map
- `wave-plan.md` — Wave schedule
- `architecture-review.md` — Architecture findings
- `security.md` — Security findings
- `correctness.md` — Correctness findings
- `challenge.md` — Adversarial validation verdicts
- `synthesis.md` — Deduped + ranked findings
- `REPORT.md` — This report
