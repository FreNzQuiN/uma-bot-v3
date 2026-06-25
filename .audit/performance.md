# Performance Audit Findings

## Summary
4 findings: 0 CRITICAL, 2 MEDIUM, 2 LOW

## Findings

### [MEDIUM] N+1 queries in `updateMemberHistory` — per-member get+upsert loop
- File: `src/data/member-history.ts:30-63`
- What: For each of ~34 snapshot members, performs `db.getMember(id)` followed by `db.upsertMember(...)` individually inside a transaction, then fetches ALL historical members with `db.getMembers(circleId)` and upserts non-current members one-by-one.
- Why: With the SQLite adapter this is in-memory WASM (~70μs total). With the MySQL adapter, each `getMember` + `upsertMember` pair is a network round-trip (~1ms each), totaling ~70 sequential round-trips (~70ms). This runs once at startup and on snapshot refresh, so the absolute impact is limited, but the pattern doesn't scale if member count grows.
- How: Batch the individual operations. For MySQL, use a single `INSERT ... ON DUPLICATE KEY UPDATE` per member without the preceding `SELECT`. For marking left members, query `SELECT viewer_id FROM member_history WHERE circle_id = ?` once, diff against current snapshot IDs, then batch-upsert only the changed members. This would reduce ~70 queries to ~4.
- Confidence: HIGH

### [MEDIUM] Individual `recordAlert` + `markAlertSent` calls in alert processing loop
- File: `src/orchestrator/report-orchestrator.ts:197-214`
- What: Each detected alert triggers 2-3 individual DB operations: `recordAlert` (check + insert + get ID for SQLite, or INSERT IGNORE + LAST_INSERT_ID for MySQL), then `markAlertSent` (UPDATE). With N alerts, this is ~4N individual DB operations.
- Why: With the MySQL adapter, 10 alerts generate ~40 sequential network round-trips. The quiet-hours path in `alerts.ts:184-196` has the same N+1 pattern — each alert calls `db.recordAlert()` individually. Both paths could be batched.
- How: Add batch methods to `IDatabase`: `recordAlerts(alerts[])` using a transaction with batch INSERT, and `markAlertsSent(ids[])` using `UPDATE ... WHERE id IN (...)`. For MySQL, `INSERT IGNORE` already handles dedup atomically, so batching is safe. For SQLite, a single transaction wrapping all inserts achieves the same.
- Confidence: HIGH

### [LOW] `loadMonthSnapshots` reads and parses ALL snapshot files when only the latest is needed
- File: `src/data/snapshot.ts:131-162` called from `src/data/ensure-snapshot.ts:33`
- What: `ensureMonthSnapshot` calls `loadMonthSnapshots(year, month)` which reads every `.json` file in the month directory (up to 31 files), parses each as JSON, and validates each — only to return `cached[cached.length - 1]` (the latest one).
- Why: At startup, pre-fetching 2 months reads and parses up to 62 JSON files (~434KB total) when only 2 snapshots are needed. During monthly report generation, up to 31 files are read when 1 suffices. Each parse costs ~1ms, adding ~30-60ms of unnecessary I/O per call.
- How: In `ensureMonthSnapshot`, replace `loadMonthSnapshots()` with a targeted lookup: scan the month directory for the latest `.json` filename (sorted alphabetically = sorted by day), read and validate only that single file. If invalid, fall back to the next-latest. This reduces disk reads from N to 1.
- Confidence: MEDIUM

### [LOW] `Intl.DateTimeFormat` instance created on every log line
- File: `src/utils/logger.ts:108-117`
- What: `formatLine()` constructs a new `Intl.DateTimeFormat('sv-SE', { timeZone, ... })` on every log line. `Intl.DateTimeFormat` construction is one of the more expensive operations in V8's internationalization API — it compiles CLDR locale data and creates a formatter object.
- Why: At ~100 log lines per report cycle (documented scale), the cumulative cost is small but unnecessary. The formatter only needs to be created once per timezone configuration. This is not the documented sync I/O decision (that's `appendFileSync`) — it's a separate overhead in the formatting path.
- How: Cache the `Intl.DateTimeFormat` instance as a class field. Invalidate and recreate only when `configure()` is called with a different timezone. Example: `private formatter: Intl.DateTimeFormat | null = null;` — lazily created in `formatLine`, cleared in `configure()`.
- Confidence: MEDIUM

## Low-Confidence Notes

- `src/data/snapshot.ts:113-121` (`loadLatestSnapshot`) does `readdirSync` + `readFileSync` + `JSON.parse` on every WhatsApp command and API request via the `getSnapshot` callback. At human message speed (~1/sec) and localhost API speed (<50 req/sec), each call takes <1ms. Not a bottleneck at current scale, but worth noting if the bot ever handles higher concurrency.

- `src/index.ts:132-198` (config watcher) reads `config.yaml` synchronously with `readFileSync` every 5 seconds. This is a documented accepted design choice (`docs/architecture.md:173`). The file is ~1KB so the blocking duration is sub-millisecond.

- `src/utils/logger.ts:183,189` (`appendFileSync` on every log line) is a documented accepted design choice (`docs/architecture.md:438-439`). Not flagged as a finding.

## Modules Reviewed
- Database (`src/db/database.ts`, `src/db/mysql-database.ts`): clean — queries are indexed, connection pooling is correct
- Data layer (`src/data/snapshot.ts`, `src/data/member-history.ts`): 2 findings (N+1 in updateMemberHistory, wasteful loadMonthSnapshots)
- Reports (`src/reports/compute.ts`, all generators): clean — O(N×W) with N=34, W=5, trivial
- API server (`src/api/server.ts`): clean — localhost-only, rate limiter appropriate for scale
- Scheduler (`src/scheduler/`): clean — sequential DB checks on tiny datasets
- Orchestrator (`src/orchestrator/report-orchestrator.ts`): 1 finding (N+1 alert recording)
- WhatsApp (`src/whatsapp/client.ts`): clean — message cache bounded, eviction is O(500)
- Utils (`src/utils/logger.ts`): 1 finding (Intl.DateTimeFormat recreation)
- Config (`src/config.ts`, `src/index.ts` config watcher): clean — documented patterns
- Alerts (`src/alerts/alerts.ts`): clean — batch `getExistingAlertKeys` is good, individual recording is noted in orchestrator finding
