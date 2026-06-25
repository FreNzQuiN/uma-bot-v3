# Fix Progress

## Wave 1: Quick Wins
- [x] Fix 1: Port collision (18767→18769) — PASSED
- [x] Fix 2: Cache Intl.DateTimeFormat — PASSED
- [x] Fix 3: Remove unused Database aliases — PASSED
- [x] Fix 4: Remove settings table DDL — PASSED
- [x] Fix 5: API auth warning — PASSED
- [x] Fix 6: Timing-safe auth — PASSED
- [x] Fix 7: Zod validation for /setreq — PASSED
- [x] Fix 8: Method rename (shadowing) — PASSED
- [x] Fix 9: Empty-array guard — PASSED
- [x] Fix 10: Logger datetime cache — PASSED

## Wave 2: Medium Refactors
- [x] Fix 11: Batch upsertMembers + updateMemberHistory N+1 fix — PASSED
- [x] Fix 12: Batch recordAlerts + markAlertsSent — PASSED
- [x] Fix 13: Simplify configChanged with JSON.stringify — PASSED
- [x] Fix 14: loadMonthSnapshots reads only latest — PASSED
- [x] Fix 15: detectAlerts decomposed into per-type functions — PASSED
- [x] Fix 16: DispatchContext for parameter threading — PASSED
- [x] Fix 17: executeCatchUp shared helper extraction — PASSED

## Wave 3: Cleanup
- [x] Fix 18: Remove deprecated isStaleMember export — PASSED
- [x] Fix 19: Catchup tests use mockCurrentDate — PASSED

## Summary
- Total fixes attempted: 19
- Passed: 19
- Reverted: 0
- Skipped: 0
- Regressions caught during fix: 2 (both fixed same session)
