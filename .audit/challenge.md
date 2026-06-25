# Adversarial Validation

## Summary

- Total findings reviewed: 26
- CONFIRMED (kept as-is): 14
- DOWNGRADED (severity reduced): 4
- REJECTED (false positive): 5
- UNVERIFIABLE: 0
- POSITIVE kept: 3

---

## Rejected Findings

### [MEDIUM] MySQL mock doesn't simulate INSERT IGNORE returning affectedRows: 0
- File: `tests/db/mysql-database.unit.test.ts:542-565`
- Original severity: MEDIUM
- Reason: **Factually wrong about the code path.** The finding claims "The adapter code at `src/db/mysql-database.ts:232-254` checks `result.affectedRows > 0`" — but `affectedRows` is NEVER referenced in `mysql-database.ts` (confirmed via grep). The actual code at line 243-246 uses `SELECT LAST_INSERT_ID() as id` and checks `lastId > 0`. The mock at line 547-549 correctly exercises this path: INSERT IGNORE → LAST_INSERT_ID returns 0 → fallback SELECT returns existing ID. The mock's `[{}, undefined]` for INSERT IGNORE is fine because the adapter never reads properties from that result set.

### [LOW] No test verifies `compute.unit.test.ts` Database import is used
- File: `tests/reports/compute.unit.test.ts:11`
- Original severity: LOW
- Reason: **Non-finding.** The finding itself acknowledges "the import IS used" and then says "Already covered by the broader alias finding." This adds zero new information beyond the existing [LOW] Database alias finding. Duplicate.

### [LOW] Health endpoint test doesn't pass `db` parameter
- File: `tests/api/server.integration.test.ts:30`
- Original severity: LOW
- Reason: **Acknowledged duplicate.** The finding's own "How" section says "Covered by the DB-failure path finding above." This is the same issue as the [MEDIUM] finding about missing 503 test coverage.

### [MEDIUM] SQLite `getExistingAlertKeys()` has zero test coverage (sql-correctness.md)
- File: `src/db/database.ts:235-243`
- Original severity: MEDIUM
- Reason: **Duplicate of testing.md finding #1.** Identical finding, same file reference, same recommendation. Should not be a separate finding.

### [LOW] SQLite `recordAlert` check-then-insert is not atomic (sql-correctness.md)
- File: `src/db/database.ts:246-268`
- Original severity: LOW
- Reason: **Duplicate of correctness.md finding #6.** Identical observation, same file reference, same conclusion ("safe only in single-process mode"). Should not be a separate finding.

---

## Downgraded Findings

### [HIGH] `process.on('exit')` calls async `db.close()` without await
- File: `src/index.ts:362`
- Original: HIGH → New: MEDIUM
- Reason: The code at line 362 does call `db.close()` synchronously in an exit handler, and this IS technically wrong for MySQL's async `pool.end()`. However, the `exit` handler only fires after `process.exit(1)` from the `uncaughtException` handler (line 41). The `cleanup` function (lines 352-358) properly `await`s `db.close()` for SIGINT/SIGTERM. The audit's own low-confidence notes acknowledge "data loss is already acceptable" for the uncaughtException path. On an exceptional crash path where the process is already dying, the OS reclaims sockets. This is a code hygiene issue, not a production data-loss risk.

### [MEDIUM] `ts-node` may not load `qrcode-terminal.d.ts` ambient declaration
- File: `src/types/qrcode-terminal.d.ts:1-3`
- Original: MEDIUM → New: LOW
- Reason: The finding is speculative — it depends on an unknown `ts-node` version. The `tsconfig.json` has `include: ["src/**/*"]` which covers the declaration file. The `await import('qrcode-terminal')` at `client.ts:217` is a dynamic import, and `ts-node` (≥10.7.0) respects `include` patterns. The `npm run dev:watch` command uses `--transpile-only` which skips type-checking entirely. Without being able to verify the installed `ts-node` version, this is a theoretical concern, not a confirmed bug.

### [HIGH] `afterEach` does not `await` `db.close()` in 3 test files
- Files: `scheduler.unit.test.ts:15-17`, `catchup-regression.test.ts:13-15`, `members.unit.test.ts:138-140`
- Original: HIGH → New: LOW
- Reason: The finding's core claim — "the auto-save `setInterval` timer inside `SqliteDatabase.close()` is async" — is incorrect for `:memory:` databases. Evidence: (1) The timer is only created for file-based databases (`database.ts:55`: `if (this.dbPath !== ':memory:')`), so `:memory:` databases have NO timer to be "stale." (2) `close()` at line 393-405 runs `clearInterval` synchronously, then for `:memory:` databases, skips `save()` entirely and calls `this.db.close()` (WASM, synchronous) then `this.db = null`. ALL operations in `close()` are synchronous for `:memory:` databases — the `async` keyword is purely for interface conformance. (3) Not awaiting a synchronous operation inside an `async` wrapper has zero functional impact. The finding's reasoning about "stale timer" and "write on a closed DB" is invalid for the test files in question. The suboptimal `afterEach` pattern is worth noting for correctness hygiene but carries no actual risk.

### [HIGH] MySQL `VALUES()` function removed in MySQL 8.0.29+
- File: `src/db/mysql-database.ts:276-281`
- Original: HIGH → New: MEDIUM
- Reason: The finding is technically correct — `VALUES()` was removed in MySQL 8.0.29. However, the project explicitly supports TiDB (AGENTS.md: "MySQL/TiDB adapter"), and TiDB still supports `VALUES()`. The docs at `docs/architecture.md:130` say "Supports MySQL 5.7+ and TiDB." MySQL 5.7 is EOL, but the `VALUES()` deprecation only affects MySQL 8.0.29+ (April 2023). For TiDB deployments, this is a non-issue. The severity should reflect that the impact depends on the deployment target. HIGH implies it's broken for everyone; MEDIUM accurately reflects that it's broken only for standard MySQL 8.0.29+ (not TiDB).

---

## Confirmed Findings

### correctness.md

| # | Severity | Title | File:line | Notes |
|---|----------|-------|-----------|-------|
| 1 | MEDIUM | `AlertEventRow.status` type says `'deduped'` but code uses `'suppressed'` | `src/types/index.ts:301` | Type is factually wrong. Code uses `'suppressed'` everywhere (alerts.ts:209, database.ts:229,240, mysql-database.ts:208,219). Latent — `AlertEventRow` isn't returned by `IDatabase`. |
| 2 | MEDIUM | `config.ts` double-cast `as unknown as BotConfig` | `src/config.ts:147,156` | Both `getDefaultConfig()` and `validateConfig()` bypass type checking. Zod schema and `BotConfig` interface can drift silently. |
| 3 | MEDIUM | `deduplicateAlerts` is dead code | `src/alerts/alerts.ts:226-234` | Zero callers confirmed via grep. Replaced by batch `getExistingAlertKeys` at line 171-173. |
| 4 | LOW | SQLite `recordAlert` check-then-insert (TOCTOU) | `src/db/database.ts:246-268` | SELECT then INSERT without transaction. Safe in single-process mode. The audit's recommendation (add a documenting comment) is appropriate. |

### testing.md

| # | Severity | Title | File:line | Notes |
|---|----------|-------|-----------|-------|
| 5 | HIGH | SQLite `getExistingAlertKeys()` has no integration test | `tests/db/database.integration.test.ts` | grep confirms zero matches. Only tested via MySQL mocks and `makeMockDb`. Dynamic `IN` clause construction is untested for SQLite. |
| 6 | MEDIUM | Health endpoint DB-failure path is not tested | `tests/api/server.integration.test.ts:30` | Server created without `db` param. No test exercises the 503 path when `getLastSuccessfulRun` throws. |
| 7 | MEDIUM | MySQL tests don't cover pool connection failure | `tests/db/mysql-database.unit.test.ts` | `mockGetConnection` always resolves. No test for pool exhaustion or connection timeout. |
| 8 | MEDIUM | `makeMockDb` does not type-check against `IDatabase` | `tests/_helpers/index.ts:198-217` | Returns plain object without `as unknown as IDatabase` assertion. Missing methods silently return `undefined`. |
| 9 | LOW | 4 test files import `Database` alias | `scheduler.unit.test.ts:4`, `catchup-regression.test.ts:2`, `members.unit.test.ts:15`, `compute.unit.test.ts:11` | Alias at `database.ts:486-488` is marked for removal. These files will break when removed. |
| 10 | LOW | MySQL tests use shared mock objects | `tests/db/mysql-database.unit.test.ts:3-27` | Module-level mocks shared across tests, reset in `beforeEach`. Current approach works but is fragile. |
| 11 | LOW | No transaction test for concurrent callers | `database.integration.test.ts:456-493`, `mysql-database.unit.test.ts:636-698` | Both adapters test single transaction only. Low priority for current usage (only `updateMemberHistory` calls `transaction()`). |

### sql-correctness.md

| # | Severity | Title | File:line | Notes |
|---|----------|-------|-----------|-------|
| 12 | MEDIUM | MySQL `error_message VARCHAR(255)` truncation risk | `src/db/mysql-database.ts:89` | SQLite uses `TEXT`. MySQL strict mode rejects >255 char error messages, which would mask the original failure and break catch-up detection. |
| 13 | MEDIUM | MySQL `settings.value VARCHAR(255)` latent truncation | `src/db/mysql-database.ts:74` | Table is unused but schema drift exists. If settings are ever implemented, MySQL strict mode truncation would be discovered only in production. |
| 14 | LOW | `CREATE INDEX IF NOT EXISTS` fails on MySQL < 8.0.31 | `src/db/mysql-database.ts:133-135` | Added in MySQL 8.0.31 (Oct 2022). 3+ years old, widely deployed. TiDB supports it. Low risk unless targeting older MySQL. |

### POSITIVE (kept)

| # | Title | File:line |
|---|-------|-----------|
| P1 | Dynamic IN clause construction is correct and injection-safe | `database.ts:237-240`, `mysql-database.ts:216-219` |
| P2 | UPSERT semantics are correctly mapped between engines | `database.ts:283-306`, `mysql-database.ts:269-293` |
| P3 | Test suite has excellent DB lifecycle hygiene | `database.integration.test.ts:8-15` and others |

---

## Severity Distribution

| Severity | Original | After Challenge |
|----------|----------|-----------------|
| HIGH | 4 | 1 |
| MEDIUM | 11 | 10 |
| LOW | 8 | 7 |
| POSITIVE | 3 | 3 |
| REJECTED | 0 | 5 |

The original audit over-reported severity. Four HIGH findings were downgraded:
- Two (exit handler, VALUES()) are real issues but with limited blast radius
- Two (afterEach, ts-node) have flawed reasoning or are speculative
