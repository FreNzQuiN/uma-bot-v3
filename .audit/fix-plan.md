# Fix Plan

## Summary
- Total findings: 32
- Fix clusters: 15 (10 quick wins + 5 larger refactors)
- Estimated effort: 10 Trivial/Simple fixes + 5 deferred Complex refactors

## Approach

This plan focuses on **safe, low-risk fixes** that don't change business logic or architecture. Complex refactors (report type registry, parameter threading, alert decomposition, catch-up refactoring, DB adapter dedup, N+1 batch queries) are deferred — they require careful design and would be risky in a single audit pass.

## Quick Wins (Fix Now)

### Fix 1: Port collision flaky test
- Priority Score: 0.90
- Findings resolved: 1 (testing)
- Root cause: Two test files use same port 18767
- Fix approach: Change FAIL_DB_PORT to a unique port in server.integration.test.ts
- Files affected: `tests/api/server.integration.test.ts`
- Effort: Trivial
- Dependencies: None
- Verification: `npx jest tests/api/`

### Fix 2: Remove unused Database aliases
- Priority Score: 0.40
- Findings resolved: 1 (maintainability)
- Root cause: Backward-compat aliases never imported anywhere
- Fix approach: Remove lines 464-466 from database.ts
- Files affected: `src/db/database.ts`
- Effort: Trivial
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 3: Remove deprecated isStaleMember export
- Priority Score: 0.40
- Findings resolved: 1 (maintainability)
- Root cause: Function marked @deprecated but still exported
- Fix approach: Keep function, add clear comment it's test-only. Don't remove (tests use it).
- Files affected: `src/data/daily-fans.ts`
- Effort: Trivial
- Dependencies: None
- Verification: `npm test`

### Fix 4: Remove settings table DDL
- Priority Score: 0.40
- Findings resolved: 1 (maintainability)
- Root cause: Table created but no IDatabase methods exist for it
- Fix approach: Remove CREATE TABLE settings from both SQLite and MySQL adapters
- Files affected: `src/db/database.ts`, `src/db/mysql-database.ts`
- Effort: Simple
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 5: Rename shadowed generateReportString method
- Priority Score: 0.56
- Findings resolved: 1 (maintainability)
- Root cause: Method name same as imported function
- Fix approach: Rename method to `buildReportString` in orchestrator
- Files affected: `src/orchestrator/report-orchestrator.ts`
- Effort: Simple
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 6: Add empty-array guards
- Priority Score: 0.56
- Findings resolved: 2 (correctness)
- Root cause: snapshot.members[0] accessed without length check
- Fix approach: Add early return guard at top of computeTierData and alignSnapshotToMonth
- Files affected: `src/data/daily-fans.ts`, `src/orchestrator/report-orchestrator.ts`
- Effort: Simple
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 7: Add API auth startup warning
- Priority Score: 0.42
- Findings resolved: 1 (security)
- Root cause: No log when API_TOKEN is unset
- Fix approach: Add log.warn at API server startup when auth is disabled
- Files affected: `src/api/server.ts`
- Effort: Simple
- Dependencies: None
- Verification: `npm run lint:check`

### Fix 8: Use constant-time bearer token comparison
- Priority Score: 0.28
- Findings resolved: 1 (security)
- Root cause: Uses !== instead of crypto.timingSafeEqual
- Fix approach: Import crypto, use timingSafeEqual for token comparison
- Files affected: `src/api/server.ts`
- Effort: Simple
- Dependencies: None
- Verification: `npm run lint:check && npx jest tests/api/server-auth`

### Fix 9: Fix /setreq to use updateConfig
- Priority Score: 0.28
- Findings resolved: 1 (security)
- Root cause: Saves config directly without Zod validation
- Fix approach: Use updateConfig() instead of manual saveConfig()
- Files affected: `src/whatsapp/admin.ts`
- Effort: Simple
- Dependencies: None
- Verification: `npm run lint:check && npx jest tests/whatsapp/admin`

### Fix 10: Cache Intl.DateTimeFormat instance
- Priority Score: 0.28
- Findings resolved: 1 (performance)
- Root cause: New formatter created on every log line
- Fix approach: Cache as class field, recreate only on configure() with different timezone
- Files affected: `src/utils/logger.ts`
- Effort: Simple
- Dependencies: None
- Verification: `npm run lint:check && npx jest tests/utils/logger`

## Deferred (Larger Refactors)

These require careful design and are better done incrementally:

1. **N+1 queries in updateMemberHistory** — Requires new batch DB methods + IDatabase changes
2. **N+1 alert recording** — Requires new batch DB methods
3. **Report type knowledge scattering** — Requires architectural decision on central registry
4. **detectAlerts decomposition** — Requires extracting 5 detector functions
5. **Parameter threading** — Requires options/context object design
6. **executeCatchUp refactoring** — Requires careful extraction of shared logic
7. **configChanged simplification** — Requires deep-equal approach decision
8. **Database adapter row mapping** — Requires shared mapper module
9. **loadMonthSnapshots optimization** — Requires targeted file lookup
10. **Config hot-reload testing** — Requires mock fs setup

## Dependency Graph

```
Fix 1 (port) ────────────────────────── independent
Fix 2 (aliases) ─────────────────────── independent
Fix 3 (deprecated) ──────────────────── independent
Fix 4 (settings DDL) ────────────────── independent
Fix 5 (shadowing) ───────────────────── independent
Fix 6 (empty guards) ────────────────── independent
Fix 7 (auth warning) ────────────────── independent
Fix 8 (timing safe) ─────────────────── independent
Fix 9 (setreq Zod) ──────────────────── independent
Fix 10 (DateTimeFormat) ─────────────── independent

All 10 fixes are independent — can be done in parallel.
```
