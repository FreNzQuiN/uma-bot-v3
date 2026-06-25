# Synthesis

## Summary
- Total findings before synthesis: 38
- Rejected (false positives): 5
- Downgraded: 1
- Surviving findings: 32

## Deduplication
- No duplicate file:line references across dimensions
- No semantic overlap between confirmed findings

## Top 10 Priorities (by Priority Score)

| # | Score | Severity | Finding | File |
|---|-------|----------|---------|------|
| 1 | 0.90 | HIGH | Port 18767 collision causes flaky test | tests/api/server.integration.test.ts:251 |
| 2 | 0.63 | MEDIUM | N+1 queries in updateMemberHistory | src/data/member-history.ts:30-63 |
| 3 | 0.63 | MEDIUM | Individual recordAlert + markAlertSent per alert | src/orchestrator/report-orchestrator.ts:197-214 |
| 4 | 0.56 | MEDIUM | Report type knowledge scattered across 6+ files | src/reports/registry.ts + 5 others |
| 5 | 0.56 | MEDIUM | detectAlerts 200 lines with repeated patterns | src/alerts/alerts.ts:35-203 |
| 6 | 0.56 | MEDIUM | Parameter threading explosion (7-9 params) | src/whatsapp/dispatch.ts:54-61 |
| 7 | 0.56 | MEDIUM | executeCatchUp 125 lines with 3 divergent paths | src/scheduler/catchup.ts:179-304 |
| 8 | 0.56 | MEDIUM | configChanged manually compares schedule fields | src/index.ts:59-82 |
| 9 | 0.56 | MEDIUM | Database adapter row mapping duplicated | src/db/database.ts + mysql-database.ts |
| 10 | 0.56 | MEDIUM | generateReportString method shadows import | src/orchestrator/report-orchestrator.ts:146-166 |

## Remaining Findings (not in top 10)

### MEDIUM
- Config hot-reload watcher untested (testing)
- Module-level detectAlerts mock masks behavior (testing)
- Unmocked new Date() in catchup tests (testing)
- computeTierData unguarded members[0] access (correctness)
- alignSnapshotToMonth unguarded members[0] access (correctness)
- API auth skipped when API_TOKEN unset (security)

### LOW
- Bearer token non-constant-time comparison (security)
- /setreq bypasses Zod validation (security)
- Non-newline splitting marker overhead (correctness, downgraded from MEDIUM)
- Stats stale count definition mismatch (correctness)
- countActiveDays includes day 1 baseline (correctness)
- loadMonthSnapshots reads all files (performance)
- Intl.DateTimeFormat recreated every log line (performance)
- settings table DDL exists with no methods (maintainability)
- Database backward-compat aliases unused (maintainability)
- isStaleMember deprecated but still exported (maintainability)
- as any casts access private internals (testing)
- No dedicated test for runtime.ts (testing)
- e2e-output.test.ts depends on config.yaml (testing)
