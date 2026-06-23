# Synthesis

## Deduplication Log

| Finding | Dimensions | Action |
|---------|-----------|--------|
| Duplicated report dispatch | Architecture + Correctness | Merged — Architecture finding covers both locations |
| Monthly offset calculation | Architecture + Correctness (pre-fetch) | Merged — same root cause, different symptoms |
| catch-up persistence gap | Correctness + Architecture | Merged under Correctness (it's a logic bug, not just architecture) |

## Conflict Resolution

| Conflict | Resolution |
|----------|-----------|
| computeRollingAverage: HIGH (Correctness) vs design choice | Downgraded to MEDIUM per adversarial validator — explicitly documented, tests pass |
| Ghost detection: HIGH (Correctness) vs edge case | Downgraded to MEDIUM — doesn't manifest with real data |
| client.ts god module: HIGH (Architecture) vs inherent coupling | Downgraded to MEDIUM — concerns are inherently related in a single-process bot |

## Final Findings (ranked by priority)

### Priority 1 — CRITICAL/HIGH bugs with direct user impact

| # | Severity | Finding | File:Line | Dimension | Score |
|---|----------|---------|-----------|-----------|-------|
| 1 | HIGH | API server has no authentication | server.ts:104-193 | Security | 1.00 |
| 2 | HIGH | Catch-up alerts never marked 'sent' — duplicate delivery | report-orchestrator.ts:231-236 | Correctness | 0.90 |
| 3 | HIGH | Monthly pre-fetch calculates wrong target month | dispatch.ts:269-275 | Correctness | 0.90 |
| 4 | HIGH | Monthly report silently shows wrong month | monthly.ts:44-60 | Correctness | 0.90 |
| 5 | HIGH | Error messages leaked in /groups response | server.ts:227 | Security | 0.80 |
| 6 | HIGH | Reversed dependency: data → API layer | snapshot.ts:13 | Architecture | 0.50 |

### Priority 2 — MEDIUM issues (maintenance cost, design concerns)

| # | Severity | Finding | File:Line | Dimension | Score |
|---|----------|---------|-----------|-----------|-------|
| 7 | MEDIUM | Duplicated report dispatch (2 locations) | dispatch.ts:360-411, report-orchestrator.ts:168-178 | Architecture | 0.35 |
| 8 | MEDIUM | Monthly offset calculation duplicated (3 locations) | index.ts:279, dispatch.ts:268, report-orchestrator.ts:273 | Architecture | 0.35 |
| 9 | MEDIUM | Quiet hours permanently suppress alerts | alerts.ts:194-211 | Correctness | 0.63 |
| 10 | MEDIUM | Database save() blocks event loop | database.ts:384-389 | Correctness | 0.63 |
| 11 | MEDIUM | Alert delivery duplicated (orchestrator + catch-up) | report-orchestrator.ts:85-104, index.ts:337-353 | Architecture | 0.35 |
| 12 | MEDIUM | snapshot.ts mixes 3 concerns | snapshot.ts:1-426 | Architecture | 0.35 |
| 13 | MEDIUM | console.error monkey-patching suppresses errors | client.ts:52-68 | Security | 0.35 |
| 14 | MEDIUM | reports/format.ts is a grab-bag | format.ts:1-135 | Architecture | 0.28 |
| 15 | MEDIUM | configChanged uses JSON.stringify | index.ts:42-65 | Architecture | 0.28 |
| 16 | MEDIUM | alerts → reports/tier cross-module coupling | alerts.ts:11 | Architecture | 0.35 |
| 17 | MEDIUM | computeRollingAverage inflates averages | daily-fans.ts:244-258 | Correctness | 0.63 |
| 18 | MEDIUM | Ghost detection can misclassify transfers | compute.ts:90-104 | Correctness | 0.63 |
| 19 | MEDIUM | Dockerfile bakes config.yaml into image | Dockerfile:38 | Security | 0.35 |

### Priority 3 — LOW issues (hygiene, minor risks)

| # | Severity | Finding | File:Line | Dimension | Score |
|---|----------|---------|-----------|-----------|-------|
| 20 | LOW | Rate limiter Map unbounded | server.ts:56 | Security | 0.08 |
| 21 | LOW | WA_SESSION_DIR not sanitized | client.ts:138 | Security | 0.08 |
| 22 | LOW | No security headers beyond basic | server.ts:33-34 | Security | 0.08 |
| 23 | LOW | saveConfig non-exclusive temp file | config.ts:226-228 | Security | 0.08 |
| 24 | LOW | Log injection via user content | dispatch.ts:134, client.ts:338 | Security | 0.08 |
| 25 | LOW | runtime.ts mutable state | runtime.ts:21-39 | Architecture | 0.20 |
| 26 | LOW | logger.ts synchronous file I/O | logger.ts:183,189 | Architecture | 0.20 |
| 27 | LOW | catchup persistence gap (narrow window) | catchup.ts:217-230 | Correctness | 0.28 |

## Deterministic Findings (from Phase 0)

| Finding | Status |
|---------|--------|
| Type errors: 0 | Clean |
| Lint warnings: 0 | Clean |
| Tests: 1389/1389 pass | Clean |
| Dependencies: 0 vulnerabilities | Clean |

## Positive Findings

| Finding | Dimension |
|---------|-----------|
| SQL injection fully mitigated | Security |
| Clean composition root | Architecture |
| Zero circular dependencies | Architecture |
| Pure report functions | Architecture |
