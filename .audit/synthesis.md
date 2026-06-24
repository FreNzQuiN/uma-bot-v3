# Synthesis: Deduplicated and Ranked Findings

## Summary
- Total findings from Wave 1-2: 61
- After adversarial validation: 56 (5 rejected as false positives)
- After deduplication: 42 unique findings
- After severity adjustment: 42 findings with corrected severities

## Top 5 Priorities

### 1. Combined report alert processing gap (MEDIUM)
- **Source:** correctness.md, testing.md
- **File:** src/index.ts:279-300
- **What:** `onCombinedReport` callback doesn't call `processAlertsForReport()` for each report type in the combined set
- **Impact:** Alerts silently lost on collision days (daily+weekly same time)
- **Priority Score:** MEDIUM × 0.9 × 1.0 = 0.63
- **Fix:** After delivering combined report, iterate over types and call `orchestrator.processAlertsForReport(type, snapshot, config, computedMembers)` for each

### 2. saveConfig temp file collision after crash (MEDIUM)
- **Source:** correctness.md, security.md (downgraded from HIGH)
- **File:** src/config.ts:227
- **What:** `flag: 'wx'` throws EEXIST if `.tmp` exists from prior crash
- **Impact:** Admin commands silently fail until manual cleanup
- **Priority Score:** MEDIUM × 0.9 × 1.0 = 0.63
- **Fix:** Change `flag: 'wx'` to `flag: 'w'` or add cleanup before write

### 3. Database auto-save exports entire WASM blob every 30s (MEDIUM)
- **Source:** performance.md
- **File:** src/db/database.ts:47-49,384-389
- **What:** No dirty flag — `db.export()` runs even when no writes occurred
- **Impact:** Unnecessary I/O and CPU usage
- **Priority Score:** MEDIUM × 0.6 × 1.0 = 0.42
- **Fix:** Add dirty flag, only export when changes occurred

### 4. `console.error` bypasses structured logger in database.ts (MEDIUM)
- **Source:** correctness.md, maintainability.md
- **File:** src/db/database.ts:65,75
- **What:** Two locations use `console.error` instead of `log.error`
- **Impact:** Database errors won't appear in log file, won't have timestamps
- **Priority Score:** MEDIUM × 0.9 × 0.4 = 0.14
- **Fix:** Replace `console.error` with `log.error('DB', message, context)`

### 5. Unused `db` parameter in 6 of 7 report generators (MEDIUM)
- **Source:** architecture-review.md
- **File:** src/reports/daily.ts:29, weekly.ts:51, monthly.ts:38, bottom.ts:27, stats.ts:27, tier.ts:24
- **What:** Six report generators accept `db?: Database` but never reference it
- **Impact:** False dependency graph, misleading type signatures
- **Priority Score:** MEDIUM × 0.5 × 1.0 = 0.35
- **Fix:** Remove `db?: Database` parameter from all generators except `members.ts`

## All Findings by Severity

### HIGH (0 after adversarial validation)
None — all HIGH findings were downgraded by adversarial validator

### MEDIUM (12 findings)
1. **Combined report alert processing gap** — src/index.ts:279-300
2. **saveConfig temp file collision** — src/config.ts:227
3. **Database auto-save exports WASM blob** — src/db/database.ts:47-49
4. **`console.error` bypasses logger** — src/db/database.ts:65,75
5. **Unused `db` parameter in 6 report generators** — src/reports/*.ts
6. **Monthly pre-fetch logic duplicated** — src/index.ts:287, orchestrator.ts:242/290, dispatch.ts:261
7. **Help text admin commands hardcoded** — src/whatsapp/dispatch.ts:190-199, 210-219
8. **`reports/format.ts` re-exports formatDateWIB** — src/reports/format.ts:13
9. **handleCatchUp and handleAlerts are structurally identical** — src/whatsapp/admin.ts:157-193 vs 199-234
10. **No test for combined report alert gap** — src/index.ts:279-300
11. **No test for saveConfig temp file collision** — src/config.ts:226-228
12. **`dataDay` naming ambiguity** — src/reports/daily.ts:38, stats.ts:34, monthly.ts:93

### LOW (15 findings)
1. **Bearer token timing side-channel** — src/api/server.ts:123
2. **Admin command `/setreq` unbounded values** — src/whatsapp/admin.ts:34
3. **Monthly report empty members guard** — src/reports/monthly.ts:61
4. **dispatch.ts bypasses orchestrator** — src/whatsapp/dispatch.ts:14-17
5. **dispatch.ts is 466 lines** — src/whatsapp/dispatch.ts:1-466
6. **alerts → reports coupling** — src/alerts/alerts.ts:11
7. **Config getter pattern inconsistent** — src/whatsapp/dispatch.ts:70, src/api/server.ts:63
8. **orchestrator mixes snapshot freshness** — src/orchestrator/report-orchestrator.ts:104-143
9. **Logger statSync on every log line** — src/utils/logger.ts
10. **Logger creates Intl.DateTimeFormat per line** — src/utils/logger.ts
11. **configChanged uses JSON.stringify** — src/index.ts:47-48
12. **api/server.ts recomputes computeMembers** — src/api/server.ts
13. **formatUptime in dispatch.ts** — src/whatsapp/dispatch.ts:49-54
14. **isStaleMember exported but unused** — src/data/daily-fans.ts:220-226
15. **ensure-snapshot.ts no dedicated test** — src/data/ensure-snapshot.ts:1-66

### LOW (Testing)
1. **scheduler.unit.test.ts uses real time** — tests/scheduler/scheduler.unit.test.ts:322,349,391
2. **Weak dispatch test assertions** — tests/whatsapp/dispatch.test.ts:163-252
3. **combined report missing combos** — tests/reports/ (missing daily+monthly, daily+weekly+monthly)
4. **member-history.ts no dedicated test** — src/data/member-history.ts

### LOW (Architecture)
1. **utils/index.ts unused barrel file** — src/utils/index.ts:1

## Positive Findings (Preserved)
1. Clean DAG dependency graph with no circular imports
2. Dependency injection via getter functions enables testability and hot-reload
3. ensure-snapshot.ts cleanly bridges data and API layers
4. Parameterized SQL queries throughout
5. Robust input validation on path-sensitive parameters
6. Zod validation at config boundary
7. Defense-in-depth on API security
8. Golden-file inline snapshots for all 8 report types
9. Adversarial fuzz testing with 56 inputs
10. Consistent JSDoc documentation across all modules