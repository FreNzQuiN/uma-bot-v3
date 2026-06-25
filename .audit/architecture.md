# Database Abstraction Layer — Architecture Map

## 1. Module Dependency Graph

### Core DB layer (4 files)

```
src/db/types.ts          ← IDatabase interface (the contract)
src/db/database.ts       ← SqliteDatabase implements IDatabase
src/db/mysql-database.ts ← MysqlDatabase implements IDatabase
src/db/factory.ts        ← createDatabase() factory, returns IDatabase
```

### Who imports what from the DB layer

**Type-only imports (`IDatabase`)** — 10 consumer files depend only on the interface:

| Consumer file | Import | Usage |
|---|---|---|
| `src/api/server.ts:11` | `IDatabase` type | Health-check query via `getLastSuccessfulRun` |
| `src/alerts/alerts.ts:18` | `IDatabase` type | Batch dedup via `getExistingAlertKeys`, quiet-hours `recordAlert` |
| `src/data/member-history.ts:9` | `IDatabase` type | `transaction`, `getMember`, `upsertMember`, `getMembers` |
| `src/orchestrator/report-orchestrator.ts:9` | `IDatabase` type | `recordAlert`, `markAlertSent` |
| `src/reports/members.ts:11` | `IDatabase` type | Passed to `getLeftMembers` for left-member history |
| `src/reports/registry.ts:9` | `IDatabase` type | Optional `db` param forwarded to `generateMembersReport` |
| `src/scheduler/catchup.ts:9` | `IDatabase` type | `getLastSuccessfulRun`, `recordRun`, `updateRunStatus`, `save` |
| `src/scheduler/scheduler.ts:11` | `IDatabase` type | `getLastSuccessfulRun`, `recordRun`, `updateRunStatus` |
| `src/whatsapp/dispatch.ts:9` | `IDatabase` type | `getLastSuccessfulRun` (status command) |

**Value import (`createDatabase`)** — 1 consumer:

| Consumer file | Import | Usage |
|---|---|---|
| `src/index.ts:14` | `createDatabase` from `./db/factory` | Creates adapter at startup, stored as `IDatabase` |

**Value import (`SqliteDatabase`)** — 1 internal + tests:

| Consumer file | Import | Usage |
|---|---|---|
| `src/db/factory.ts:7` | `SqliteDatabase` from `./database` | Instantiated when `backend === 'sqlite'` |

**No consumer in `src/` imports `SqliteDatabase` or `MysqlDatabase` directly** — all production code depends on `IDatabase` or `createDatabase`. The backward-compat aliases (`Database = SqliteDatabase` at `src/db/database.ts:487-488`) are only used by test files.

### Test-layer imports (concrete classes)

| Test file | Import |
|---|---|
| `tests/db/database.integration.test.ts:1` | `SqliteDatabase` |
| `tests/db/database-regression.test.ts:1` | `SqliteDatabase` |
| `tests/db/mysql-database.unit.test.ts:36-37` | `MysqlDatabase`, `MysqlConfig` |
| `tests/alerts/alerts.unit.test.ts:3` | `SqliteDatabase` |
| `tests/alerts/alerts-regression.test.ts:3` | `SqliteDatabase` |
| `tests/data/member-history.unit.test.ts:6` | `SqliteDatabase` |
| `tests/data/left-members.unit.test.ts:9` | `SqliteDatabase` |
| `tests/reports/members.unit.test.ts:15` | `Database` (alias) |
| `tests/reports/compute.unit.test.ts:11` | `Database` (alias) |
| `tests/scheduler/scheduler.unit.test.ts:4` | `Database` (alias) |
| `tests/scheduler/catchup-regression.test.ts:2` | `Database` (alias) |

---

## 2. Async Boundary Analysis

Every method on `IDatabase` returns `Promise`. All callers have been migrated to `async/await`.

### Functions that became async (full list)

**Report generators** — `generateReportString` in `src/reports/registry.ts:25` is now `async`. This propagated to:

- `src/reports/registry.ts:39` — `generateMembersReport` is `async` (uses `getLeftMembers`)
- `src/dispatch.ts:324-335` — `generateReport()` calls `await generateReportString()`
- `src/orchestrator/report-orchestrator.ts:152-172` — `generateReportString()` is `async`

**Alert detection** — `detectAlerts` in `src/alerts/alerts.ts:43` is `async` because it calls `db.getExistingAlertKeys`. This propagated to:

- `src/orchestrator/report-orchestrator.ts:201` — `await detectAlerts(...)` in `processAlertsForReport`
- `src/orchestrator/report-orchestrator.ts:316` — `await this.processAlertsForReport(...)` in `sendReport`

**Member history** — `updateMemberHistory` in `src/data/member-history.ts:27` is `async`. Uses `db.transaction()`, `db.getMember()`, `db.upsertMember()`, `db.getMembers()`.

**Scheduler** — `recordAndSend` in `src/scheduler/scheduler.ts:50` is `async`. Calls `db.getLastSuccessfulRun`, `db.recordRun`, `db.updateRunStatus`.

**CatchUpManager** — `detectMissedReports` in `src/scheduler/catchup.ts:48` is `async`. Calls `db.getLastSuccessfulRun` for each report type.

**Dispatch** — `setupCommandHandler` in `src/whatsapp/dispatch.ts:69` registers an `async` message handler.

**API server** — Health check in `src/api/server.ts:218` calls `await db.getLastSuccessfulRun('_health_check')`.

### Async propagation chain

```
index.ts:99  await createDatabase(config.database)
  ↓
index.ts:257  await updateMemberHistory(snapshot, db)
index.ts:258  await db.saveRankHistory(...)
  ↓
scheduler.ts:60  await this.db.getLastSuccessfulRun(reportType)
scheduler.ts:68  await this.db.recordRun(...)
scheduler.ts:79  await this.db.updateRunStatus(runId, 'sent')
  ↓
catchup.ts:58  await this.db.getLastSuccessfulRun(reportType) [per report type]
catchup.ts:182  await this.db.recordRun(...)
catchup.ts:194  await this.db.updateRunStatus(runId, 'sent')
  ↓
orchestrator.ts:201  await detectAlerts(..., this.db)
orchestrator.ts:206  await this.db.recordAlert(...)
orchestrator.ts:222  await this.db.markAlertSent(alertId)
  ↓
alerts.ts:172  await db.getExistingAlertKeys(candidateKeys)
  ↓
registry.ts:39  await generateMembersReport(snapshot, config, computedMembers, options?.db)
  ↓
members.ts:74  await getLeftMembers(snapshot, db)
member-history.ts:36  await db.getMember(member.viewer_id)
member-history.ts:39  await db.upsertMember(...)
member-history.ts:52  await db.getMembers(circleId)
```

---

## 3. Type System Health

### IDatabase interface contract (`src/db/types.ts:64-94`)

The interface defines 15 methods across 5 domains:

| Domain | Methods |
|---|---|
| Lifecycle | `initialize()`, `close()`, `save()` |
| Schedule runs | `getLastSuccessfulRun()`, `recordRun()`, `updateRunStatus()` |
| Alerts | `isAlertAlreadySent()`, `getExistingAlertKeys()`, `recordAlert()`, `markAlertSent()` |
| Members | `upsertMember()`, `getMembers()`, `getMember()` |
| Rank history | `saveRankHistory()`, `getRankHistory()` |
| Transactions | `transaction<T>()` |

### Type flow

```
BotConfig.database          → config.ts:123-138 (Zod schema)
                           → src/types/index.ts:253-268 (BotConfig interface)
                           → factory.ts:10 (receives as BotConfig['database'])
                           → SqliteDatabase(dbPath, autoSaveMs) or MysqlDatabase(config.mysql)
                           → returns IDatabase

ScheduleRunInsert           → src/db/types.ts:18-27
ScheduleRunRow              → src/types/index.ts:281-291 (imported by db/types.ts:9)

AlertEventInsert            → src/db/types.ts:29-37
AlertEventRow               → src/types/index.ts:293-303 (exists in types but NOT in IDatabase return types)

MemberHistoryInsert         → src/db/types.ts:39-48
MemberHistoryRow            → src/types/index.ts:305-314

RankHistoryInsert           → src/db/types.ts:50-58
RankHistoryRow              → src/types/index.ts:316-324
```

### `AlertEventRow` — defined but unused in IDatabase

`AlertEventRow` at `src/types/index.ts:293-303` is defined and imported by `src/db/types.ts` indirectly (via `../types`), but `IDatabase` has **no method that returns `AlertEventRow`**. The only alert read methods return `boolean` (dedup check) or `Set<string>` (batch dedup). The actual alert row data is never exposed to consumers.

### SettingsRow — orphaned type

`SettingsRow` at `src/types/index.ts:275-279` corresponds to the `settings` table created by both adapters, but `IDatabase` has **zero methods for reading or writing settings**. The table exists in both SQLite and MySQL schemas but is unused.

---

## 4. Config Propagation

### Flow: config.yaml → Zod → BotConfig → factory → adapter

```
config.yaml
  ↓ loadConfig()            src/config.ts:163
  ↓ parseYaml + ConfigSchema.parse()  src/config.ts:174
BotConfig.database          src/types/index.ts:253-268
  ↓ config.database         src/index.ts:99
  ↓ createDatabase()        src/db/factory.ts:10
  ↓ config.backend switch   src/db/factory.ts:11
  case 'mysql':
    ↓ dynamic import        src/db/factory.ts:15
    ↓ new MysqlDatabase(config.mysql)  src/db/factory.ts:20
    ↓ await db.initialize() src/db/factory.ts:21
  case 'sqlite':
    ↓ new SqliteDatabase(config.sqlite.path, config.sqlite.autoSaveMs)  src/db/factory.ts:26
    ↓ await db.initialize() src/db/factory.ts:28
  ↓ returns IDatabase
```

### Zod schema for database section (`src/config.ts:123-138`)

```
database.backend: z.enum(['sqlite', 'mysql']).default('sqlite')
database.sqlite.path: z.string().default('data/bot.db')
database.sqlite.autoSaveMs: z.number().int().min(1000).default(30_000)
database.mysql.host: z.string().default('localhost')
database.mysql.port: z.number().int().min(1).max(65535).default(3306)
database.mysql.database: z.string().default('uma_club_bot')
database.mysql.user: z.string().default('')
database.mysql.password: z.string().default('')
database.mysql.connectionLimit: z.number().int().min(1).max(100).default(5)
database.mysql.ssl: z.boolean().default(false)
```

### Config change detection (`src/index.ts:186-188`)

Hot-reload detects `database` config changes but only logs a warning — it does NOT recreate the DB adapter. This is correct: `src/index.ts:186-188`:

```typescript
if (!deepEqual(oldConfig.database, config.database)) {
  log.warn('Config', 'Database config changed — restart required to apply new database settings');
}
```

---

## 5. Test Coverage Map

### SQLite adapter (`tests/db/database.integration.test.ts` — 599 lines)

| IDatabase method | Tested? | Tests |
|---|---|---|
| `initialize()` | Yes | Creates tables, idempotent, throws before init, directory creation |
| `close()` | Yes | Closes cleanly, persistence round-trip |
| `save()` | Yes | Persistence round-trip, disk file creation |
| `getLastSuccessfulRun()` | Yes | Returns null, finds by type, not found for failed |
| `recordRun()` | Yes | Returns ID > 0 |
| `updateRunStatus()` | Yes | Sent + failed, sent_at timestamp |
| `isAlertAlreadySent()` | Yes | Before/after markAlertSent |
| `getExistingAlertKeys()` | **NO** | Not tested for SQLite |
| `recordAlert()` | Yes | Insert, duplicate dedup, sequential IDs |
| `markAlertSent()` | Yes | Dedup after marking |
| `upsertMember()` | Yes | Insert, conflict update, transfer info |
| `getMembers()` | Yes | By circle_id |
| `getMember()` | Yes | Found + not found |
| `saveRankHistory()` | Yes | Insert, upsert on conflict, LIMIT |
| `getRankHistory()` | Yes | Query + limit |
| `transaction()` | Yes | Commit + rollback |

### SQLite regression tests (`tests/db/database-regression.test.ts` — 89 lines)

Tests `recordAlert` sequential IDs and duplicate handling. Covers Bug #4 regression.

### MySQL adapter (`tests/db/mysql-database.unit.test.ts` — 808 lines)

All 15 methods are tested with mocked `mysql2/promise` pool:

| IDatabase method | Tested? | Notes |
|---|---|---|
| `initialize()` | Yes | Pool creation, DDL verification |
| `close()` | Yes | pool.end(), double-close safe |
| `save()` | Yes | Confirmed no-op |
| `getLastSuccessfulRun()` | Yes | Row mapping, is_catch_up conversion |
| `recordRun()` | Yes | INSERT + LAST_INSERT_ID() |
| `updateRunStatus()` | Yes | sent_at logic, error path |
| `isAlertAlreadySent()` | Yes | Returns true/false |
| `getExistingAlertKeys()` | Yes | Empty input, batch query |
| `recordAlert()` | Yes | INSERT IGNORE + fallback SELECT |
| `markAlertSent()` | Yes | Status + sent_at update |
| `upsertMember()` | Yes | ON DUPLICATE KEY UPDATE syntax |
| `getMembers()` | Yes | Row mapping |
| `getMember()` | Yes | Found + not found |
| `saveRankHistory()` | Yes | REPLACE INTO syntax |
| `getRankHistory()` | Yes | LIMIT param |
| `transaction()` | Yes | Commit, rollback, connection routing |

### MySQL-specific SQL pattern tests

Section 14 of the MySQL test file explicitly verifies:
- No `ON CONFLICT` / `excluded.` (SQLite syntax) in upsert — `mysql-database.unit.test.ts:739-753`
- `REPLACE INTO` not `INSERT OR REPLACE` — `mysql-database.unit.test.ts:755-771`
- `LAST_INSERT_ID()` not `last_insert_rowid()` — `mysql-database.unit.test.ts:773-807`

### Mock DB in shared helpers (`tests/_helpers/index.ts:198-217`)

`makeMockDb()` returns all 15 `IDatabase` methods as `jest.fn()` stubs. This is used by non-DB test files (dispatch, orchestrator, alerts, scheduler tests) to mock database interactions.

### Coverage gap summary

| Gap | Severity |
|---|---|
| SQLite `getExistingAlertKeys()` has no direct integration test | **Medium** — only tested via MySQL mocks and `makeMockDb` |
| `AlertEventRow` type exists but no method returns it | **Low** — dead type, not a bug |
| `settings` table created but unused by IDatabase | **Low** — schema exists for future use |
| `Database` backward-compat alias used by 4 test files | **Low** — works but will break if alias is removed |

---

## 6. Risk Signals

### R1: SQLite `getExistingAlertKeys` lacks direct test coverage

- **Location**: `src/db/database.ts:235-243` (implementation), `tests/db/database.integration.test.ts` (missing test)
- **Evidence**: `grep` for `getExistingAlertKeys` in `tests/db/database.integration.test.ts` returns zero matches. Only tested in MySQL unit test (`tests/db/mysql-database.unit.test.ts:517-539`) and mock helper.
- **Impact**: The SQLite implementation constructs a dynamic `IN` clause with placeholders. If the placeholder logic or `Set` construction has a bug, no test catches it. The alerts system (`src/alerts/alerts.ts:171-173`) is the sole production caller.

### R2: `settings` table created but dead

- **Location**: `src/db/database.ts:105-111` (SQLite), `src/db/mysql-database.ts:71-77` (MySQL)
- **Evidence**: Both adapters create a `settings` table with `key`, `value`, `updated_at` columns. `IDatabase` at `src/db/types.ts:64-94` has no methods for reading/writing settings. The `SettingsRow` type at `src/types/index.ts:275-279` is defined but never used.
- **Impact**: Schema drift. If someone assumes settings are stored in the DB (based on schema existence), they'll find no API to access them.

### R3: `Database` backward-compat alias is a maintenance trap

- **Location**: `src/db/database.ts:486-488`
- **Evidence**: `export type Database = SqliteDatabase; export const Database = SqliteDatabase;`
- **Impact**: 4 test files import `Database` instead of `SqliteDatabase`: `tests/scheduler/scheduler.unit.test.ts:4`, `tests/scheduler/catchup-regression.test.ts:2`, `tests/reports/members.unit.test.ts:15`, `tests/reports/compute.unit.test.ts:11`. When this alias is removed, those tests break. The comment says "will be removed once all consumers migrate to IDatabase" but test files use concrete instances for in-memory DB creation, so they'll need `SqliteDatabase` imports.

### R4: MySQL adapter's `transaction()` holds connection for entire callback duration

- **Location**: `src/db/mysql-database.ts:379-398`
- **Evidence**: `getConn()` at line 64 returns `this.transactionConn ?? this.pool!`. During a transaction, all queries within the callback use the pinned connection (`this.transactionConn`). This is correct behavior but creates a risk: if the callback is long-running or throws after a partial commit boundary, the connection is held.
- **Impact**: Low in current usage. `transaction()` is only called from `src/data/member-history.ts:32` for member upsert loops. But the connection is released in `finally` block (`src/db/mysql-database.ts:395-397`), which is correct.

### R5: Config change detection warns but doesn't block

- **Location**: `src/index.ts:186-188`
- **Evidence**: If `database` config changes via hot-reload, only a warning is logged. The running adapter is not replaced.
- **Impact**: Intentional design (documented in AGENTS.md: "Database config changed — restart required"). But if someone changes `database.backend` from `sqlite` to `mysql` without restarting, the SQLite adapter continues operating. No runtime error occurs — the new config simply has no effect until restart.

### R6: Factory uses dynamic import for MySQL only

- **Location**: `src/db/factory.ts:13-17`
- **Evidence**: `await import('./mysql-database')` with try/catch. SQLite is a static import.
- **Impact**: Correct design (MySQL is optional, SQLite always works). But the dynamic import means TypeScript can't verify `MysqlDatabase` implements `IDatabase` at compile time. The return type is `Promise<IDatabase>` and the factory casts via `db` which is typed as `MysqlDatabase`. Since `MysqlDatabase implements IDatabase`, this is type-safe. The risk is that if someone adds a method to `IDatabase` and forgets to implement it in `MysqlDatabase`, it won't be caught until runtime with MySQL backend.

### R7: SQLite auto-save timer holds a reference to `this`

- **Location**: `src/db/database.ts:56-61`
- **Evidence**: `setInterval(() => { this.save().catch(...) }, this.autoSaveMs)` — arrow function captures `this` correctly.
- **Impact**: None. The timer is cleared in `close()` at line 394-397. The `save()` method handles the `dirty` flag correctly (line 385). No leak risk.

---

## 7. Type Declaration Changes

### Deleted: `src/types/sql.js.d.ts`

Was declaring both `sql.js` and `qrcode-terminal` modules. Deleted because:
- `@types/sql.js` is in `devDependencies` (`package.json:52`) — the types come from the package
- `qrcode-terminal` needed its own declaration

### Created: `src/types/qrcode-terminal.d.ts`

- **Location**: `src/types/qrcode-terminal.d.ts:1-3`
- Contains only the `qrcode-terminal` module declaration (3 lines)

### tsconfig.json (`tsconfig.json:1-26`)

- `strict: true` — all type checks enforced
- `skipLibCheck: true` — skips declaration file validation (relevant for `sql.js.d.ts` deletion)
- `include: ["src/**/*"]` — covers the new `.d.ts` file
- No `paths` aliases — all imports use relative paths

---

## 8. Schema Comparison: SQLite vs MySQL

Both adapters create identical logical schemas with dialect-specific syntax:

| Feature | SQLite (`database.ts`) | MySQL (`mysql-database.ts`) |
|---|---|---|
| Auto-increment | `INTEGER PRIMARY KEY AUTOINCREMENT` | `INT AUTO_INCREMENT PRIMARY KEY` |
| String type | `TEXT` | `VARCHAR(255)` |
| Boolean | `INTEGER NOT NULL DEFAULT 0` | `TINYINT(1) NOT NULL DEFAULT 0` |
| Upsert | `ON CONFLICT(col) DO UPDATE SET ... excluded.col` | `ON DUPLICATE KEY UPDATE ... VALUES(col)` |
| Rank upsert | `INSERT OR REPLACE INTO` | `REPLACE INTO` |
| Last insert ID | `last_insert_rowid()` | `LAST_INSERT_ID()` |
| Alert dedup | SELECT + INSERT (check-then-act) | `INSERT IGNORE` + fallback SELECT (atomic) |
| Index creation | `CREATE INDEX IF NOT EXISTS` | `CREATE INDEX IF NOT EXISTS` |

The MySQL adapter's `recordAlert` at `src/db/mysql-database.ts:224-254` uses `INSERT IGNORE` for atomic dedup, while the SQLite adapter at `src/db/database.ts:246-269` does a check-then-insert. Both are correct for their engines, but the MySQL approach is race-condition-free.
