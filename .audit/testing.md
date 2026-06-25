# Testing Audit Findings

## Summary

12 findings: 0 CRITICAL, 2 HIGH, 5 MEDIUM, 5 LOW, 1 POSITIVE

---

## Findings

### [HIGH] SQLite `getExistingAlertKeys()` has no integration test
- File: `tests/db/database.integration.test.ts` (entire file)
- What: The SQLite adapter's `getExistingAlertKeys` method at `src/db/database.ts:235-243` has zero direct integration test coverage. This is the only `IDatabase` method without a SQLite integration test.
- Why: This method constructs a dynamic `IN` clause with variable placeholders from an array of strings, then maps rows to a `Set`. A bug in placeholder generation (e.g., off-by-one, trailing comma) or row mapping would go undetected for SQLite deployments. The alerts system (`src/alerts/alerts.ts:171-173`) calls this on every alert detection cycle.
- How: Add an integration test in `tests/db/database.integration.test.ts` covering: (1) empty input returns empty set, (2) batch of 3 keys where 1 exists as "sent" returns that key, (3) keys with "pending" status are NOT included, (4) keys with "suppressed" status ARE included. Mirror the MySQL mock tests at `mysql-database.unit.test.ts:517-539`.
- Confidence: HIGH

### [HIGH] `afterEach` does not `await` `db.close()` in 3 test files
- File: `tests/scheduler/scheduler.unit.test.ts:15-17`
- File: `tests/scheduler/catchup-regression.test.ts:13-15`
- File: `tests/reports/members.unit.test.ts:138-140`
- What: These files use `afterEach(() => { db.close(); })` without `async`/`await`. Since `close()` returns a `Promise`, the connection teardown is fire-and-forget — it may not complete before the next test's `beforeEach` runs.
- Why: With `:memory:` SQLite databases, the in-memory DB is GC'd so data doesn't leak between tests. But the auto-save `setInterval` timer inside `SqliteDatabase.close()` is async. If `close()` hasn't finished when the next test starts, a stale timer could trigger a write on a closed DB, causing non-deterministic test flakiness. Under high parallelism or slow CI, this becomes intermittent failures.
- How: Change to `afterEach(async () => { await db.close(); })` in all three files, matching the pattern used by `database.integration.test.ts`, `alerts.unit.test.ts`, `member-history.unit.test.ts`, and `left-members.unit.test.ts`.
- Confidence: HIGH

### [MEDIUM] Health endpoint DB-failure path is not tested
- File: `tests/api/server.integration.test.ts:29-32` (server creation without `db`)
- What: The server is instantiated as `new ApiServer(PORT, () => SNAPSHOT, config)` — without passing a `db` parameter. The health handler at `src/api/server.ts:216` checks `if (this.db)` and skips the DB ping when no DB is provided. There is no test for the case where `db` IS provided but `getLastSuccessfulRun` throws (which should return 503).
- Why: The async health check (`await this.db.getLastSuccessfulRun('_health_check')`) was introduced as part of the DB refactor. If this throws and the try/catch is broken, the health endpoint would crash with an unhandled error instead of returning 503. No test guards this behavior.
- How: Add a test case that constructs an `ApiServer` with a mock `db` where `getLastSuccessfulRun` rejects, then verifies `/health` returns status 503 with `dbConnected: false`.
- Confidence: HIGH

### [MEDIUM] MySQL tests don't cover pool connection failure or rejection
- File: `tests/db/mysql-database.unit.test.ts` (entire file)
- What: The mock pool always resolves `getConnection` successfully. No test verifies behavior when the pool cannot provide a connection (e.g., pool exhaustion, connection timeout).
- Why: In production, `pool.getConnection()` can reject under load. The MySQL adapter's `transaction()` method calls `this.pool.getConnection()` at `src/db/mysql-database.ts:380` — if this rejects, the error propagates but no test confirms the error is clean (no leaked state, no hung promise).
- How: Add a test case: `mockGetConnection.mockRejectedValueOnce(new Error('Pool exhausted'))`, then verify `db.transaction()` rejects and `db.getLastSuccessfulRun()` still works afterward (connection not leaked).
- Confidence: MEDIUM

### [MEDIUM] `makeMockDb` does not type-check against `IDatabase`
- File: `tests/_helpers/index.ts:198-217`
- What: `makeMockDb()` returns a plain object that must match all 15 `IDatabase` methods. If a method is added to `IDatabase` but not added to `makeMockDb()`, the test will compile but the mock silently returns `undefined` for the new method instead of failing at type-check time.
- Why: The current 15/15 match is correct, but this is fragile. A future PR that adds a method to `IDatabase` (e.g., `getSettings()`) would break all consumer code using the mock without any compile error.
- How: Add a type assertion: `return { ... } as unknown as IDatabase;` — this ensures `makeMockDb` is checked against the interface at compile time. If a method is missing, TypeScript will error.
- Confidence: MEDIUM

### [MEDIUM] MySQL mock doesn't simulate `INSERT IGNORE` returning `affectedRows: 0`
- File: `tests/db/mysql-database.unit.test.ts:542-565`
- What: The `recordAlert` test for the duplicate path returns `callCount === 1` as `[{}, undefined]`, simulating a successful INSERT. The MySQL `INSERT IGNORE` actually returns `affectedRows: 0` when a duplicate is silently skipped. The mock doesn't differentiate between an insert and a skip.
- Why: The adapter code at `src/db/mysql-database.ts:232-254` checks `result.affectedRows > 0` to decide whether to call `LAST_INSERT_ID()`. If the mock always returns `{}`, the test always takes the "insert succeeded" path. A bug where `affectedRows` is incorrectly checked would go undetected.
- How: For the duplicate case, return `[{ affectedRows: 0, insertId: 0 }, undefined]` instead of `[{}, undefined]`. This forces the code into the fallback SELECT path, which is the actual code path for duplicates.
- Confidence: MEDIUM

### [LOW] 4 test files import `Database` alias — will break when removed
- File: `tests/scheduler/scheduler.unit.test.ts:4`
- File: `tests/scheduler/catchup-regression.test.ts:2`
- File: `tests/reports/members.unit.test.ts:15`
- File: `tests/reports/compute.unit.test.ts:11`
- What: These files import `Database` (the backward-compat alias) instead of `SqliteDatabase` from `src/db/database`. The alias at `src/db/database.ts:486-488` is marked for removal.
- Why: When the alias is removed, all 4 files will fail to compile. The comment on the alias says "will be removed once all consumers migrate to IDatabase" but these tests need concrete instances, not the interface.
- How: Replace `import { Database } from '../../src/db/database'` with `import { SqliteDatabase } from '../../src/db/database'` and update all `new Database(':memory:')` calls to `new SqliteDatabase(':memory:')`.
- Confidence: HIGH

### [LOW] MySQL tests use shared mock objects across test cases
- File: `tests/db/mysql-database.unit.test.ts:3-27`
- What: `mockConn`, `mockPool`, and all `mock*` functions are module-level constants shared across all test cases. They're reset in `beforeEach` via `.mockReset()`, but the object structure itself is shared.
- Why: If a test accidentally mutates the mock structure (e.g., adds a property), it affects all subsequent tests. The current tests don't do this, but it's a latent risk. The `resetMocks: true` Jest config (if used) could also interfere.
- How: Low priority — the current approach works. Consider moving mock creation into `beforeEach` for stronger isolation if flaky tests emerge.
- Confidence: LOW

### [LOW] No test verifies `compute.unit.test.ts` Database import is used
- File: `tests/reports/compute.unit.test.ts:11`
- What: `compute.unit.test.ts` imports `Database` from the database module. It's used at line 375-378 for left-member testing. The import exists but the test section using it is deeply nested.
- Why: Minimal risk — the import IS used. But if the `Database` alias is removed, this file breaks. Already covered by the broader alias finding.
- How: Addressed by the alias migration finding above.
- Confidence: LOW

### [LOW] No transaction test for concurrent callers
- File: `tests/db/database.integration.test.ts:456-493`, `tests/db/mysql-database.unit.test.ts:636-698`
- What: Both adapter test suites verify that a single `transaction()` call commits or rolls back correctly. Neither tests what happens when two `transaction()` calls overlap.
- Why: In SQLite, `transaction()` uses `BEGIN EXCLUSIVE` which blocks concurrent writers. In MySQL, `transaction()` pins a connection from the pool. If two callers run transactions simultaneously, the second could deadlock or timeout. Current production usage (only `updateMemberHistory` calls `transaction()`) makes concurrent transactions unlikely, but the behavior is untested.
- How: Low priority for current usage. If the codebase starts using `transaction()` from multiple async call sites, add concurrent transaction tests.
- Confidence: LOW

### [LOW] Health endpoint test doesn't pass `db` parameter
- File: `tests/api/server.integration.test.ts:30`
- What: The test creates `new ApiServer(PORT, () => SNAPSHOT, config)` without the optional `db` parameter. The health check at `src/api/server.ts:216-218` therefore skips DB pinging entirely (`if (this.db)` is false).
- Why: The happy-path health check works, but the new async DB health check path is never exercised in the integration test. This is already covered by the [MEDIUM] finding above about the missing 503 test.
- How: Covered by the DB-failure path finding above.
- Confidence: LOW

### [POSITIVE] Test suite has excellent DB lifecycle hygiene
- File: `tests/db/database.integration.test.ts:8-15`, `tests/alerts/alerts.unit.test.ts:12-19`, `tests/data/member-history.unit.test.ts:11-18`, `tests/data/left-members.unit.test.ts:14-21`
- What: Most test files using real `SqliteDatabase` instances follow the correct `beforeEach` (create + initialize) / `afterEach` (close) pattern with `:memory:` databases. This ensures test isolation — each test gets a fresh, isolated in-memory database.
- Why: This pattern prevents data leakage between tests and ensures no test depends on another's side effects. The persistence tests correctly use try/finally for file-based DBs. This is a well-structured test foundation.
- How: The 3 files flagged in the async close finding should align with this established pattern.
- Confidence: HIGH

---

## Modules Reviewed

- **tests/db/database.integration.test.ts**: 1 finding (getExistingAlertKeys gap)
- **tests/db/database-regression.test.ts**: clean
- **tests/db/mysql-database.unit.test.ts**: 2 findings (pool failure, affectedRows mock)
- **tests/alerts/alerts.unit.test.ts**: clean
- **tests/alerts/alerts-regression.test.ts**: clean
- **tests/data/member-history.unit.test.ts**: clean
- **tests/data/left-members.unit.test.ts**: clean
- **tests/scheduler/scheduler.unit.test.ts**: 1 finding (async close)
- **tests/scheduler/catchup-regression.test.ts**: 1 finding (async close)
- **tests/orchestrator/report-orchestrator.unit.test.ts**: clean
- **tests/reports/members.unit.test.ts**: 1 finding (async close, Database alias)
- **tests/reports/compute.unit.test.ts**: 1 finding (Database alias)
- **tests/reports/e2e-output.test.ts**: clean
- **tests/reports/e2e-output-regression.test.ts**: clean
- **tests/reports/golden-inline.test.ts**: clean
- **tests/_helpers/index.ts**: 1 finding (type assertion for makeMockDb)
- **tests/api/server.integration.test.ts**: 2 findings (no DB param, no 503 test)

## Low-Confidence Notes

- The MySQL mock's `mockConnQuery` is shared between transaction-internal queries and non-transaction queries. If a future test needs to distinguish between pool-level and connection-level queries, the current shared mock may not differentiate correctly.
- `scheduler.unit.test.ts:229` accesses `(scheduler as any).recordAndSend` — this private-access pattern couples tests to implementation details. If `recordAndSend` is renamed or refactored, the test breaks silently (no compile error due to `as any`).
