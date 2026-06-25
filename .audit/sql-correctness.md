# SQL Correctness Findings

## Summary
8 findings: 1 HIGH, 3 MEDIUM, 2 LOW, 2 POSITIVE

---

## Findings

### [HIGH] MySQL `VALUES()` function removed in MySQL 8.0.29+ — `upsertMember` will fail at runtime
- File: `src/db/mysql-database.ts:276-281`
- SQL:
  ```sql
  INSERT INTO member_history (...) VALUES (...)
  ON DUPLICATE KEY UPDATE
    trainer_name = VALUES(trainer_name),
    circle_id = VALUES(circle_id),
    last_seen = VALUES(last_seen),
    previous_circle_id = COALESCE(VALUES(previous_circle_id), member_history.previous_circle_id),
    previous_circle_name = COALESCE(VALUES(previous_circle_name), member_history.previous_circle_name),
    status = VALUES(status)
  ```
- What: The `VALUES(col)` function in `ON DUPLICATE KEY UPDATE` was deprecated in MySQL 8.0.20 and **removed** in MySQL 8.0.29 (April 2023). Any MySQL server ≥ 8.0.29 will throw `ER_TABLE_VALUE_FUNCTION_DEPRECATED` and reject the query entirely. TiDB still supports `VALUES()` for backward compatibility, so this only affects standard MySQL deployments.
- Why: The `upsertMember` method is called in a transaction loop from `src/data/member-history.ts:32-53` for every member in every snapshot update. A failure here means the entire member history update fails — no member data is recorded.
- How: Replace `VALUES(col)` with an aliased row reference:
  ```sql
  INSERT INTO member_history (...) VALUES (...)
  AS new_row
  ON DUPLICATE KEY UPDATE
    trainer_name = new_row.trainer_name,
    circle_id = new_row.circle_id,
    last_seen = new_row.last_seen,
    previous_circle_id = COALESCE(new_row.previous_circle_id, member_history.previous_circle_id),
    previous_circle_name = COALESCE(new_row.previous_circle_name, member_history.previous_circle_name),
    status = new_row.status
  ```
  The `AS new_row` alias syntax works on MySQL 8.0.19+ and TiDB v7+.
- Confidence: HIGH

### [MEDIUM] MySQL `error_message VARCHAR(255)` truncates long error messages in strict mode
- File: `src/db/mysql-database.ts:89`
- Schema:
  ```sql
  error_message VARCHAR(255)
  ```
- What: The `error_message` column is `VARCHAR(255)` in MySQL but `TEXT` (unlimited) in SQLite. Error messages stored by `updateRunStatus` are `error.message` from caught exceptions (see `src/scheduler/scheduler.ts:81`). JavaScript error messages can easily exceed 255 characters — especially from HTTP client errors (axios, Baileys), which include full response bodies or stack prefixes. MySQL 8.0+ defaults to strict mode (`STRICT_TRANS_TABLES`), which will reject the INSERT/UPDATE with `ER_DATA_TOO_LONG` instead of silently truncating.
- Why: If a report delivery fails with a long error message, the `updateRunStatus` call itself throws, masking the original failure. The scheduler's catch handler at `src/scheduler/scheduler.ts:80-84` will propagate this secondary error, and the run record is left in `pending` status forever — breaking catch-up detection.
- How: Change to `TEXT` to match SQLite's unlimited storage:
  ```sql
  error_message TEXT
  ```
  MySQL `TEXT` columns have a 64KB limit, which is more than sufficient for error messages. The SQLite schema already uses `TEXT` for this column, so this also reduces schema divergence.
- Confidence: HIGH

### [MEDIUM] MySQL `settings.value VARCHAR(255)` — same truncation risk if settings table is ever used
- File: `src/db/mysql-database.ts:74`
- Schema:
  ```sql
  value VARCHAR(255) NOT NULL
  ```
- What: The `settings` table's `value` column is `VARCHAR(255)` in MySQL but `TEXT` in SQLite. The table is currently unused (no `IDatabase` methods read/write settings — confirmed in `.audit/architecture.md:164`), so this is latent. But if settings are ever implemented (e.g., storing serialized config, JSON blobs, or large values), the 255-char limit will silently truncate on MySQL strict mode.
- Why: Schema drift between SQLite and MySQL that becomes a real bug the moment the `settings` table is used. A developer adding settings support would test against SQLite (unlimited), deploy to MySQL, and hit truncation.
- How: Change to `TEXT NOT NULL` to match SQLite:
  ```sql
  value TEXT NOT NULL
  ```
  Or delete the table entirely until settings support is implemented (avoids dead schema).
- Confidence: MEDIUM (latent — no current usage)

### [MEDIUM] SQLite `getExistingAlertKeys()` has zero test coverage
- File: `src/db/database.ts:235-243`
- What: The SQLite implementation of `getExistingAlertKeys` constructs a dynamic `IN (?, ?, ...)` clause with parameterized placeholders. No test in `tests/db/database.integration.test.ts` exercises this method. The MySQL adapter's version is tested at `tests/db/mysql-database.unit.test.ts:517-539`, and both adapters use `makeMockDb()` in shared helpers (`tests/_helpers/index.ts:204`), but the actual SQLite SQL execution path is never verified.
- Why: This is the primary dedup mechanism for alerts — `src/alerts/alerts.ts:171-173` calls `db.getExistingAlertKeys(candidateKeys)` to batch-check which alerts already exist. A bug in placeholder construction (e.g., off-by-one in `eventKeys.map(() => '?').join(',')`) or in `Set` construction from result rows would cause all alerts to be re-sent every time, flooding the announcement group.
- How: Add integration tests to `tests/db/database.integration.test.ts`:
  1. Empty array returns empty Set
  2. Mix of existing and non-existing keys returns only existing ones
  3. Keys with `sent` and `suppressed` status are included
  4. Keys with `pending` status are NOT included
  5. Large batch (50+ keys) — verify placeholder count matches
- Confidence: HIGH

### [LOW] SQLite `recordAlert` check-then-insert is not atomic — safe only in single-process mode
- File: `src/db/database.ts:246-268`
- SQL:
  ```sql
  SELECT id FROM alert_events WHERE event_key = ?
  -- then, if not found:
  INSERT INTO alert_events (...) VALUES (...)
  ```
- What: Two separate queries without a transaction or UNIQUE constraint guard. Under concurrent access, a duplicate `event_key` could slip between the SELECT and INSERT. The MySQL adapter uses `INSERT IGNORE` (atomic) for the same operation. Both produce the same result in the current single-process architecture, but the SQLite approach is fragile.
- Why: If the bot ever runs multiple processes against the same SQLite file, or if `recordAlert` is ever called from parallel async contexts within the same process (it currently isn't — the call chain is sequential through the orchestrator), duplicates could be inserted. The UNIQUE constraint on `event_key` would prevent a true duplicate, but the INSERT would throw an unhandled error instead of gracefully returning the existing ID.
- How: Either (a) wrap the check-then-insert in a transaction with a UNIQUE constraint and catch the constraint violation, or (b) add a comment documenting the single-process safety invariant. The MySQL approach (`INSERT IGNORE` + `LAST_INSERT_ID()` fallback) is the robust alternative — SQLite has `INSERT OR IGNORE` which would work similarly:
  ```sql
  INSERT OR IGNORE INTO alert_events (...) VALUES (...)
  ```
  Then use `last_insert_rowid()` — if the row was ignored, `last_insert_rowid()` returns the ID of the existing row (in SQLite, `last_insert_rowid()` returns the most recent successful INSERT, which would be 0 if ignored).
  Actually, `INSERT OR IGNORE` with `last_insert_rowid()` is trickier in SQLite because `last_insert_rowid()` doesn't change when IGNORE fires. The current check-then-insert approach is actually the correct pattern for SQLite when you need the ID back. Document the safety invariant instead.
- Confidence: HIGH (issue exists, but fix is documentation, not code change)

### [LOW] `CREATE INDEX IF NOT EXISTS` may fail on MySQL < 8.0.31
- File: `src/db/mysql-database.ts:133-135`
- SQL:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_member_history_circle_id ON member_history(circle_id)
  CREATE INDEX IF NOT EXISTS idx_rank_history_circle_date ON rank_history(circle_id, date DESC)
  CREATE INDEX IF NOT EXISTS idx_schedule_runs_type_status ON schedule_runs(report_type, status, id DESC)
  ```
- What: `CREATE INDEX IF NOT EXISTS` is not valid syntax in MySQL 8.0.0–8.0.30. It was added in MySQL 8.0.31 (October 2022). On older MySQL 8.0 versions, these statements will throw `ER_PARSE_ERROR`. SQLite supports `CREATE INDEX IF NOT EXISTS` natively. TiDB supports it in all recent versions.
- Why: The `initialize()` method would fail during table creation, preventing the bot from starting with MySQL backend on older servers. Since the MySQL tests are mocked (never execute real SQL), this is not caught by the test suite.
- How: If supporting MySQL < 8.0.31 is required, use a catch-and-ignore pattern:
  ```typescript
  try {
    await conn.query('CREATE INDEX idx_... ON ...');
  } catch (err: any) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err; // 1061 = duplicate key name
  }
  ```
  If the minimum supported MySQL version is 8.0.31+ (reasonable given 8.0.31 is 3+ years old), add a comment documenting this requirement. The current code works for MySQL 8.0.31+ and TiDB.
- Confidence: MEDIUM (depends on target MySQL version; 8.0.31+ is widely deployed)

### [POSITIVE] Dynamic IN clause construction is correct and injection-safe
- File: `src/db/database.ts:237-240`, `src/db/mysql-database.ts:216-219`
- What: Both adapters build `IN (?, ?, ...)` dynamically using `eventKeys.map(() => '?').join(',')` and spread the array as parameterized bindings `[...eventKeys, 'sent', 'suppressed']`. The placeholder count always matches the array length. Empty array is handled with an early return before any SQL is constructed.
- Why: String interpolation of SQL placeholders is a common source of both SQL injection and placeholder-count mismatches. The parameterized approach is correct for both sql.js and mysql2/promise, and the empty-array guard prevents a syntax error from `IN ()` with no elements.
- Confidence: HIGH

### [POSITIVE] UPSERT semantics are correctly mapped between engines
- File: `src/db/database.ts:283-306` (SQLite), `src/db/mysql-database.ts:269-293` (MySQL)
- What: SQLite uses `ON CONFLICT(viewer_id) DO UPDATE SET ... excluded.col` and MySQL uses `ON DUPLICATE KEY UPDATE ... VALUES(col)`. Both correctly reference the "proposed new row" using their engine's native syntax (`excluded.` for SQLite, `VALUES()` for MySQL pre-8.0.29). The `COALESCE` pattern for optional fields (`previous_circle_id`, `previous_circle_name`) is identical in both adapters and correctly preserves existing values when the new value is NULL.
- Why: UPSERT is the most common source of dialect-specific bugs. The `excluded.` prefix is SQLite-specific (not standard SQL), and `VALUES()` is MySQL-specific (deprecated). Both are correctly used for their respective engines. The test at `tests/db/mysql-database.unit.test.ts:739-753` explicitly verifies MySQL doesn't accidentally use SQLite syntax.
- Confidence: HIGH

---

## Reviewed Items (No Issue Found)

| Concern | Verdict |
|---------|---------|
| Dynamic IN clause: placeholder count vs array length | ✅ Correct — `map(() => '?')` produces exactly N placeholders for N elements |
| Dynamic IN clause: SQL injection via string concatenation | ✅ Safe — placeholders are `?`, values are parameterized |
| Dynamic IN clause: empty array edge case | ✅ Handled — both adapters return `new Set()` before constructing SQL |
| UPSERT: `excluded.` prefix in SQLite | ✅ Correct — SQLite's native syntax for referring to the proposed row |
| UPSERT: `VALUES()` prefix in MySQL | ✅ Correct for MySQL < 8.0.29 (see HIGH finding above for ≥ 8.0.29) |
| Last insert ID: SQLite `last_insert_rowid()` | ✅ Correct — standard SQLite function |
| Last insert ID: MySQL `LAST_INSERT_ID()` | ✅ Correct — standard MySQL function |
| REPLACE INTO: MySQL `REPLACE INTO` | ✅ Correct syntax. `rank_history` has composite PK `(date, circle_id)` with no auto-increment, so the delete-and-reinsert behavior of REPLACE INTO causes no ID churn |
| INSERT OR REPLACE: SQLite `INSERT OR REPLACE INTO` | ✅ Correct syntax |
| Transaction: SQLite `BEGIN/COMMIT/ROLLBACK` via `rawRun` | ✅ Correct — sql.js is synchronous, `rawRun` avoids setting `dirty` flag unnecessarily |
| Transaction: MySQL `beginTransaction/commit/rollback` | ✅ Correct — connection pinned via `transactionConn`, released in `finally` |
| Parameter binding: `?` placeholders | ✅ Both sql.js and mysql2/promise use `?` positional parameters |
| NULL parameter binding | ✅ Both engines handle `null` JS values as SQL NULL correctly |
| Schema: `INTEGER` vs `INT` | ✅ Compatible — MySQL treats `INT` and `INTEGER` identically |
| Schema: `CREATE TABLE IF NOT EXISTS` | ✅ Works on both SQLite and MySQL 8.0+ |
| Alert dedup equivalence | ✅ Semantic equivalence confirmed — SQLite check-then-insert and MySQL INSERT IGNORE produce the same logical outcome (insert if new, return existing ID if duplicate) |
