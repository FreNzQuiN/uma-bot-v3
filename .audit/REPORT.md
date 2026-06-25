# Database Abstraction Layer — Audit Report

## Scope
Focused audit on the database refactor (Repository Pattern for SQLite + MySQL/TiDB support). Not a full codebase audit.

## Verdict: CONDITIONAL PASS
The refactor is solid architecturally. 1 HIGH, 10 MEDIUM, 7 LOW findings. No CRITICAL. 5 false positives rejected by adversarial validation.

---

## Must Fix (Before MySQL Production Use)

### 1. [HIGH] SQLite `getExistingAlertKeys()` has no integration test
- **File**: `src/db/database.ts:235-243`
- **Impact**: The dynamic `IN` clause construction is untested on SQLite. A placeholder bug would break alert deduplication silently.
- **Fix**: Add test in `tests/db/database.integration.test.ts`: empty input, batch with mix of existing/non-existing keys, pending vs sent vs suppressed status filtering.

### 2. [MEDIUM] MySQL `VALUES()` deprecated — breaks MySQL 8.0.29+
- **File**: `src/db/mysql-database.ts:276-281`
- **Impact**: TiDB OK. Standard MySQL 8.0.29+ throws `ER_TABLE_VALUE_FUNCTION_DEPRECATED`.
- **Fix**: Change to alias syntax: `VALUES (?) AS new_vals ON DUPLICATE KEY UPDATE col = new_vals.col`. Works on MySQL 8.0.19+ and TiDB v7+.

### 3. [MEDIUM] MySQL `error_message VARCHAR(255)` truncation
- **File**: `src/db/mysql-database.ts:89`
- **Impact**: Long error messages truncated in strict mode, masking root cause of report delivery failures.
- **Fix**: Change to `TEXT` instead of `VARCHAR(255)`.

---

## Should Fix (Code Quality)

### 4. [MEDIUM] `AlertEventRow.status` type is wrong
- **File**: `src/types/index.ts:301`
- **What**: Type says `'deduped'` but code uses `'suppressed'` everywhere.
- **Fix**: Change to `'pending' | 'sent' | 'suppressed'`.

### 5. [MEDIUM] `deduplicateAlerts` is dead code
- **File**: `src/alerts/alerts.ts:226-234`
- **What**: Zero callers. Replaced by batch `getExistingAlertKeys`.
- **Fix**: Remove the function and its export.

### 6. [MEDIUM] Config double-cast allows Zod↔interface drift
- **File**: `src/config.ts:147,156`
- **What**: `as unknown as BotConfig` bypasses type checking.
- **Fix**: Use `z.infer<typeof ConfigSchema>` or add compile-time assertion.

### 7. [MEDIUM] `makeMockDb` doesn't type-check against `IDatabase`
- **File**: `tests/_helpers/index.ts:198-217`
- **What**: Missing interface method silently returns `undefined`.
- **Fix**: Add `as unknown as IDatabase` return type assertion.

### 8. [MEDIUM] Health endpoint DB-failure path untested
- **File**: `tests/api/server.integration.test.ts`
- **What**: No test for 503 when DB ping fails.
- **Fix**: Add test with mock db that rejects `getLastSuccessfulRun`.

### 9. [MEDIUM] MySQL tests don't cover pool connection failure
- **File**: `tests/db/mysql-database.unit.test.ts`
- **What**: `mockGetConnection` always resolves.
- **Fix**: Add test for pool exhaustion rejection.

---

## Nice to Have (Low Priority)

### 10. [MEDIUM] `process.on('exit')` calls async `db.close()` without await
- **File**: `src/index.ts:362`
- **Impact**: Only on uncaughtException path where data loss is already acceptable. Code hygiene.

### 11. [LOW] 4 test files import `Database` alias
- **Files**: `scheduler.unit.test.ts`, `catchup-regression.test.ts`, `members.unit.test.ts`, `compute.unit.test.ts`
- **Fix**: Replace `Database` → `SqliteDatabase` when removing alias.

### 12. [LOW] SQLite `recordAlert` TOCTOU (safe in single-process)
- **File**: `src/db/database.ts:246-268`
- **Fix**: Add comment documenting single-process safety invariant.

### 13. [LOW] `CREATE INDEX IF NOT EXISTS` fails on MySQL < 8.0.31
- **File**: `src/db/mysql-database.ts:133-135`
- **Impact**: TiDB supports it. Only affects very old MySQL.

### 14. [LOW] `ts-node` may not load `.d.ts` files
- **File**: `tsconfig.json`
- **Fix**: Add `"files": true` to ts-node compilerOptions if needed.

### 15. [LOW] `settings` table created but unused
- **File**: Both adapters
- **Impact**: Schema drift. No runtime risk.

---

## What Went Well

1. **Async migration was thorough** — zero missing `await` across 48 call sites
2. **Transaction error handling is correct** — rollback wrapped in try/catch in both adapters
3. **Interface segregation is clean** — all consumers depend only on `IDatabase`, not concrete classes
4. **Factory pattern with dynamic import** — MySQL is truly optional
5. **Batch pre-fetch for alerts** — N+1 queries reduced to 1

---

## Findings Summary

| Severity | Count | Action |
|----------|-------|--------|
| HIGH | 1 | Must fix |
| MEDIUM | 10 | Should fix |
| LOW | 7 | Nice to have |
| REJECTED | 5 | False positives |
| POSITIVE | 5 | What went well |
