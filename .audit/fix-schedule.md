# Fix Execution Schedule

## Branch Strategy
- Branch: `audit/full-codebase-2025` (all fixes applied directly)
- Base branch: `audit/full-codebase-2025`
- Merge strategy: All fixes applied in sequence, single commit at end

## Execution Wave

### Batch 1: File-independent quick wins (parallel)

1. **Fix 1: Port collision** — `tests/api/server.integration.test.ts`
2. **Fix 10: Cache DateTimeFormat** — `src/utils/logger.ts`

### Batch 2: File-grouped fixes (sequential within group)

3. **Fix 2 + Fix 4: Database cleanup** — `src/db/database.ts` + `src/db/mysql-database.ts`
4. **Fix 7 + Fix 8: API server security** — `src/api/server.ts`
5. **Fix 3 + Fix 6: Data layer guards** — `src/data/daily-fans.ts`
6. **Fix 5 + Fix 6: Orchestrator cleanup** — `src/orchestrator/report-orchestrator.ts`
7. **Fix 9: Admin validation** — `src/whatsapp/admin.ts`

## Verification
After all fixes: `npm run lint:check && npm test`
