# Fix Plan

## Summary
- Total findings: 45
- Fix clusters: 12
- Estimated effort: 8 Trivial, 10 Simple, 4 Moderate, 0 Complex

## Priority Queue (sorted by Priority Score descending)

### Fix 1: Combined report alert processing gap
- **Priority Score:** 2 × 0.9 × 0.7 × 1.5 = 1.89
- **Findings resolved:** 3 (correctness MEDIUM, testing MEDIUM, testing LOW)
- **Root cause:** `onCombinedReport` callback doesn't call `processAlertsForReport()` for each report type
- **Fix approach:** After delivering combined report, iterate over types and call `orchestrator.processAlertsForReport(type, snapshot, config, computedMembers)` for each
- **Files affected:** src/index.ts, tests/orchestrator/report-orchestrator.unit.test.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test, manual check that alerts fire on collision days

### Fix 2: saveConfig temp file collision after crash
- **Priority Score:** 2 × 0.9 × 1.0 × 1.0 = 1.80
- **Findings resolved:** 2 (correctness MEDIUM, testing MEDIUM)
- **Root cause:** `flag: 'wx'` throws EEXIST if `.tmp` exists from prior crash
- **Fix approach:** Change `flag: 'wx'` to `flag: 'w'` or add cleanup before write
- **Files affected:** src/config.ts, tests/config.unit.test.ts
- **Effort:** Trivial
- **Dependencies:** None
- **Verification:** npm test, test crash recovery scenario

### Fix 3: Database auto-save exports WASM blob
- **Priority Score:** 2 × 0.6 × 0.7 × 1.0 = 0.84
- **Findings resolved:** 2 (performance MEDIUM, performance LOW)
- **Root cause:** No dirty flag — `db.export()` runs even when no writes occurred
- **Fix approach:** Add dirty flag, only export when changes occurred
- **Files affected:** src/db/database.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test, verify auto-save still works

### Fix 4: console.error bypasses structured logger
- **Priority Score:** 2 × 0.9 × 1.0 × 1.0 = 1.80
- **Findings resolved:** 2 (correctness MEDIUM, maintainability MEDIUM)
- **Root cause:** Two locations use `console.error` instead of `log.error`
- **Fix approach:** Replace `console.error` with `log.error('DB', message, context)`
- **Files affected:** src/db/database.ts
- **Effort:** Trivial
- **Dependencies:** None
- **Verification:** npm test, check log output

### Fix 5: Unused `db` parameter in report generators
- **Priority Score:** 2 × 0.5 × 1.0 × 1.0 = 1.00
- **Findings resolved:** 1 (architecture MEDIUM)
- **Root cause:** Six report generators accept `db?: Database` but never reference it
- **Fix approach:** Remove `db?: Database` parameter from all generators except `members.ts`
- **Files affected:** src/reports/daily.ts, weekly.ts, monthly.ts, bottom.ts, stats.ts, tier.ts, registry.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test, type check

### Fix 6: Monthly pre-fetch logic duplicated
- **Priority Score:** 2 × 0.5 × 0.7 × 1.0 = 0.70
- **Findings resolved:** 1 (architecture MEDIUM)
- **Root cause:** Same pattern repeated in 4 locations
- **Fix approach:** Extract into helper function
- **Files affected:** src/index.ts, src/orchestrator/report-orchestrator.ts, src/whatsapp/dispatch.ts
- **Effort:** Moderate
- **Dependencies:** None
- **Verification:** npm test, type check

### Fix 7: Help text admin commands hardcoded
- **Priority Score:** 2 × 0.5 × 0.7 × 1.0 = 0.70
- **Findings resolved:** 1 (architecture MEDIUM)
- **Root cause:** Help text is hardcoded instead of derived from ADMIN_COMMANDS
- **Fix approach:** Generate help text from ADMIN_COMMANDS set
- **Files affected:** src/whatsapp/dispatch.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test, manual check help output

### Fix 8: reports/format.ts re-exports formatDateWIB
- **Priority Score:** 2 × 0.5 × 1.0 × 1.0 = 1.00
- **Findings resolved:** 1 (architecture MEDIUM)
- **Root cause:** `export { formatDateWIB }` creates dual import paths
- **Fix approach:** Remove re-export, update imports to use utils/timezone directly
- **Files affected:** src/reports/format.ts, src/reports/*.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test, type check

### Fix 9: handleCatchUp and handleAlerts are identical
- **Priority Score:** 2 × 0.5 × 0.7 × 1.0 = 0.70
- **Findings resolved:** 1 (maintainability MEDIUM)
- **Root cause:** Copy-paste pattern with identical toggle logic
- **Fix approach:** Extract generic toggle helper
- **Files affected:** src/whatsapp/admin.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test, type check

### Fix 10: dataDay naming ambiguity
- **Priority Score:** 2 × 0.5 × 1.0 × 1.0 = 1.00
- **Findings resolved:** 1 (maintainability MEDIUM)
- **Root cause:** Same variable name holds different semantic values
- **Fix approach:** Rename to descriptive names (e.g., `adjustedDataDay`, `actualDataDay`)
- **Files affected:** src/reports/daily.ts, stats.ts, monthly.ts
- **Effort:** Trivial
- **Dependencies:** None
- **Verification:** npm test, type check

### Fix 11: Add tests for combined report alert gap
- **Priority Score:** 2 × 0.5 × 0.7 × 0.5 = 0.35
- **Findings resolved:** 1 (testing MEDIUM)
- **Root cause:** No regression test for combined report alert processing
- **Fix approach:** Add test that verifies `processAlertsForReport` is called for each type
- **Files affected:** tests/orchestrator/report-orchestrator.unit.test.ts
- **Effort:** Simple
- **Dependencies:** Fix 1
- **Verification:** npm test

### Fix 12: Add tests for saveConfig temp file collision
- **Priority Score:** 2 × 0.5 × 0.7 × 0.5 = 0.35
- **Findings resolved:** 1 (testing MEDIUM)
- **Root cause:** No test creates orphaned `.tmp` file and verifies recovery
- **Fix approach:** Add test that creates orphaned `.tmp` and verifies `saveConfig` recovers
- **Files affected:** tests/config.unit.test.ts
- **Effort:** Simple
- **Dependencies:** Fix 2
- **Verification:** npm test

## Dependency Graph

```
Fix 1 (combined report alerts) ──► Fix 11 (test for Fix 1)
Fix 2 (saveConfig temp file) ──► Fix 12 (test for Fix 2)
Fix 3 (database auto-save) ── no dependencies
Fix 4 (console.error logger) ── no dependencies
Fix 5 (unused db param) ── no dependencies
Fix 6 (monthly pre-fetch) ── no dependencies
Fix 7 (help text hardcoded) ── no dependencies
Fix 8 (re-exports formatDateWIB) ── no dependencies
Fix 9 (identical toggle handlers) ── no dependencies
Fix 10 (dataDay naming) ── no dependencies
```

## Execution Order

1. **Wave A (Trivial fixes):** Fix 2, Fix 4, Fix 10
2. **Wave B (Simple fixes):** Fix 1, Fix 3, Fix 5, Fix 7, Fix 8, Fix 9
3. **Wave C (Moderate fixes):** Fix 6
4. **Wave D (Tests):** Fix 11, Fix 12

## LOW Findings (Not in Fix Plan)

These are lower priority and can be addressed later:

1. Bearer token timing side-channel — defense-in-depth, localhost-only
2. Admin command `/setreq` unbounded values — requires admin access
3. Monthly report empty members guard — requires corrupted file
4. dispatch.ts bypasses orchestrator — intentional design
5. dispatch.ts is 466 lines — well-organized, acceptable
6. alerts → reports coupling — no circular dependency
7. Config getter pattern inconsistent — intentional for testing
8. orchestrator mixes snapshot freshness — pipeline coordination
9. Logger statSync on every log line — documented accepted risk
10. Logger creates Intl.DateTimeFormat per line — negligible impact
11. configChanged uses JSON.stringify — works due to Zod ordering
12. api/server.ts recomputes computeMembers — 1-2ms per call
13. formatUptime in dispatch.ts — 5-line function, only used locally
14. isStaleMember exported but unused — keep for test compatibility
15. ensure-snapshot.ts no dedicated test — add later
16. scheduler.unit.test.ts uses real time — add fake timers later
17. Weak dispatch test assertions — golden-inline tests cover this
18. combined report missing combos — add later
19. member-history.ts no dedicated test — add later
20. utils/index.ts unused barrel file — delete later