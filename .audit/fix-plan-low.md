# Fix Plan: LOW Severity Findings

## Summary
- Total LOW findings: 20
- Intentional/Accepted risk (skip): 9
- Fixable: 11
- Fix clusters: 4
- Estimated effort: 3 Trivial, 5 Simple, 3 Moderate

## Priority Queue (sorted by Priority Score descending)

### Fix 1: utils/index.ts unused barrel file
- **Priority Score:** 1 × 1.0 × 1.0 × 1.0 = 1.00
- **Findings resolved:** 1 (architecture LOW)
- **Root cause:** Barrel file re-exports ./timezone but nothing imports from it
- **Fix approach:** Delete src/utils/index.ts
- **Files affected:** src/utils/index.ts
- **Effort:** Trivial
- **Dependencies:** None
- **Verification:** npm test

### Fix 2: Monthly report empty members guard
- **Priority Score:** 1 × 0.7 × 1.0 × 1.0 = 0.70
- **Findings resolved:** 1 (correctness LOW)
- **Root cause:** activeSnapshot.members[0] accessed without guarding against empty array
- **Fix approach:** Add guard before line 60: if (activeSnapshot.members.length === 0) return early
- **Files affected:** src/reports/monthly.ts
- **Effort:** Trivial
- **Dependencies:** None
- **Verification:** npm test

### Fix 3: isStaleMember exported but unused
- **Priority Score:** 1 × 0.7 × 1.0 × 1.0 = 0.70
- **Findings resolved:** 1 (correctness LOW)
- **Root cause:** Two stale-detection functions with different semantics
- **Fix approach:** Add @deprecated JSDoc to isStaleMember pointing to isStaleForReport
- **Files affected:** src/data/daily-fans.ts
- **Effort:** Trivial
- **Dependencies:** None
- **Verification:** npm test

### Fix 4: Admin command /setreq unbounded values
- **Priority Score:** 1 × 0.7 × 1.0 × 1.0 = 0.70
- **Findings resolved:** 1 (security LOW)
- **Root cause:** parseInt without upper-bound check
- **Fix approach:** Add max constraint in Zod schema or validate in handleSetReq
- **Files affected:** src/config.ts (Zod schema)
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test

### Fix 5: alerts → reports coupling
- **Priority Score:** 1 × 0.7 × 0.7 × 1.5 = 0.74
- **Findings resolved:** 1 (architecture LOW)
- **Root cause:** alerts.ts imports computeTierData from reports/compute.ts
- **Fix approach:** Move computeTierData to data/daily-fans.ts or data/tier.ts
- **Files affected:** src/reports/compute.ts, src/alerts/alerts.ts, src/reports/tier.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test

### Fix 6: configChanged uses JSON.stringify
- **Priority Score:** 1 × 0.7 × 0.7 × 1.0 = 0.49
- **Findings resolved:** 1 (performance LOW)
- **Root cause:** JSON.stringify for deep comparison
- **Fix approach:** Replace with structured deep equality check
- **Files affected:** src/index.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test

### Fix 7: ensure-snapshot.ts no dedicated test
- **Priority Score:** 1 × 0.7 × 0.7 × 0.5 = 0.25
- **Findings resolved:** 1 (testing LOW)
- **Root cause:** 66-line module with no dedicated tests
- **Fix approach:** Add unit tests for ensureMonthSnapshot
- **Files affected:** tests/data/ensure-snapshot.unit.test.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test

### Fix 8: member-history.ts no dedicated test
- **Priority Score:** 1 × 0.7 × 0.7 × 0.5 = 0.25
- **Findings resolved:** 1 (testing LOW)
- **Root cause:** No dedicated test file
- **Fix approach:** Add unit tests for updateMemberHistory and getLeftMembers
- **Files affected:** tests/data/member-history.unit.test.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test

### Fix 9: combined report missing combos
- **Priority Score:** 1 × 0.7 × 0.7 × 0.5 = 0.25
- **Findings resolved:** 1 (testing LOW)
- **Root cause:** Missing daily+monthly, daily+weekly+monthly combos
- **Fix approach:** Add test cases for missing combinations
- **Files affected:** tests/reports/combined.unit.test.ts
- **Effort:** Simple
- **Dependencies:** None
- **Verification:** npm test

### Fix 10: scheduler.unit.test.ts uses real time
- **Priority Score:** 1 × 0.7 × 0.4 × 1.0 = 0.28
- **Findings resolved:** 1 (testing LOW)
- **Root cause:** getDataDate() depends on real time
- **Fix approach:** Use jest.useFakeTimers() to freeze time
- **Files affected:** tests/scheduler/scheduler.unit.test.ts
- **Effort:** Moderate
- **Dependencies:** None
- **Verification:** npm test

### Fix 11: Weak dispatch test assertions
- **Priority Score:** 1 × 0.7 × 0.4 × 1.0 = 0.28
- **Findings resolved:** 1 (testing LOW)
- **Root cause:** Tests verify sendOrEdit was called but not content
- **Fix approach:** Add content assertions (golden-inline tests cover this gap, but dispatch tests should verify basics)
- **Files affected:** tests/whatsapp/dispatch.test.ts
- **Effort:** Moderate
- **Dependencies:** None
- **Verification:** npm test

## Skipped Findings (Intentional/Accepted Risk)
1. Bearer token timing side-channel — localhost-only, accepted risk
2. dispatch.ts bypasses orchestrator — intentional design
3. dispatch.ts is 466 lines — well-organized, acceptable
4. Config getter pattern inconsistent — intentional design
5. orchestrator mixes snapshot freshness — pipeline coordination
6. Logger statSync — documented accepted risk
7. Logger Intl.DateTimeFormat — negligible impact
8. api/server.ts recomputes computeMembers — negligible impact
9. formatUptime in dispatch.ts — YAGNI

## Dependency Graph
```
Fix 1 (utils barrel) — no dependencies
Fix 2 (monthly guard) — no dependencies
Fix 3 (isStaleMember JSDoc) — no dependencies
Fix 4 (setreq max) — no dependencies
Fix 5 (alerts coupling) — no dependencies
Fix 6 (configChanged) — no dependencies
Fix 7 (ensure-snapshot test) — no dependencies
Fix 8 (member-history test) — no dependencies
Fix 9 (combined combos) — no dependencies
Fix 10 (scheduler tests) — no dependencies
Fix 11 (dispatch assertions) — no dependencies
```

## Execution Order
1. **Wave 1 (Trivial):** Fix 1, Fix 2, Fix 3
2. **Wave 2 (Simple):** Fix 4, Fix 5, Fix 6, Fix 7, Fix 8, Fix 9
3. **Wave 3 (Moderate):** Fix 10, Fix 11
