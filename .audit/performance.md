# Performance Audit Findings

## Summary
10 findings: 0 CRITICAL, 1 HIGH, 5 MEDIUM, 4 LOW

## Findings

### [HIGH] Database auto-save exports entire WASM blob to disk every 30 seconds regardless of changes
- File: `src/db/database.ts:47-49,384-389`
- What: The `setInterval(() => this.save(), 30_000)` at line 47 triggers `save()` which calls `db.export()` (line 386) — serializing the entire in-memory SQLite database into a `Uint8Array`, converting to `Buffer`, and writing synchronously to disk — even when no writes occurred since the last save.
- Why: `db.export()` creates a full copy of the WASM heap on every call. For a bot with 34 members, 5 tables, and ~100 rows, the export is small (~50-200KB). But the sync write blocks the event loop for every 30s tick, and the pattern doesn't scale if the member count or table count grows. Additionally, `recordRun`, `updateRunStatus`, `recordAlert`, `markAlertSent`, and `upsertMember` all write to the DB but don't trigger an immediate save — the 30s timer is the only persistence mechanism besides explicit `db.save()` calls in catchup.
- How: Add a dirty flag: set it to `true` in `runSql` when the statement is an INSERT/UPDATE/DELETE. In the auto-save interval, only call `db.export()` and `writeFileSync` when the dirty flag is true. Reset the flag after saving:
  ```typescript
  private dirty = false;
  private runSql(sql: string, params?: unknown[]): void {
    this.ensureDb().run(sql, params);
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) {
      this.dirty = true;
    }
  }
  // In initialize():
  this.saveTimer = setInterval(() => {
    if (this.dirty) {
      this.save();
      this.dirty = false;
    }
  }, this.autoSaveMs);
  ```
- Confidence: HIGH

### [MEDIUM] Logger calls `statSync` on every log line to check file size
- File: `src/utils/logger.ts:179-186`
- What: `writeToFile()` at line 179 calls `existsSync(filePath)` and then `statSync(filePath)` on every log line to check if the log file exceeds `maxSizeMB`. Since `appendFileSync` is already called synchronously on every log line, the additional `statSync` doubles the synchronous filesystem syscalls per log write.
- Why: At ~100 log lines per report cycle (the documented scale), this means ~100 extra `statSync` calls per cycle. Each call is a synchronous syscall that blocks the event loop. The `existsSync` check is also redundant — if the file doesn't exist yet, `statSync` would throw, which is caught and handled by re-initializing.
- How: Check the file size periodically rather than on every write. Track the approximate bytes written since last size check and only call `statSync` every N writes or when accumulated bytes exceed `maxSizeMB`:
  ```typescript
  private bytesSinceLastCheck = 0;
  private writeToFile(line: string): void {
    if (!this.config.fileOutput) return;
    this.ensureLogDir();
    try {
      this.bytesSinceLastCheck += line.length + 1; // +1 for \n
      if (this.bytesSinceLastCheck > this.config.maxSizeMB * 1024 * 1024) {
        this.bytesSinceLastCheck = 0;
        // Only now check actual file size
        const stat = statSync(this.config.logFile);
        if (stat.size >= this.config.maxSizeMB * 1024 * 1024) {
          appendFileSync(this.config.logFile, line + '\n', 'utf-8');
          setImmediate(() => this.rotate(this.config.logFile));
          return;
        }
      }
      appendFileSync(this.config.logFile, line + '\n', 'utf-8');
    } catch (err) { /* ... */ }
  }
  ```
- Confidence: HIGH

### [MEDIUM] Logger creates a new `Intl.DateTimeFormat` instance on every log line
- File: `src/utils/logger.ts:120-129`
- What: `formatLine()` at line 120 constructs `new Intl.DateTimeFormat('sv-SE', { timeZone, ... })` on every call. `Intl.DateTimeFormat` instances are expensive to create — they parse locale data, timezone rules, and build an internal formatter.
- Why: The `Intl.DateTimeFormat` spec says implementations may cache instances, but the V8 engine (Node.js) does not cache format objects created inline like this. Each creation involves loading CLDR locale data. At ~100 log lines per report cycle, this adds unnecessary GC pressure and CPU time.
- How: Cache the `DateTimeFormat` instance on the `Logger` class, rebuilding only when the timezone changes:
  ```typescript
  private dateFormatter: Intl.DateTimeFormat | null = null;
  private getFormatter(): Intl.DateTimeFormat {
    if (!this.dateFormatter || this.lastTimezone !== this.config.timezone) {
      this.lastTimezone = this.config.timezone;
      this.dateFormatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: this.config.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
      });
    }
    return this.dateFormatter;
  }
  // In formatLine():
  const ts = this.getFormatter().format(now);
  ```
- Confidence: HIGH

### [MEDIUM] `configChanged` serializes every config section to JSON for deep comparison
- File: `src/index.ts:47-74`
- What: `deepEqual` at line 48 uses `JSON.stringify(a) === JSON.stringify(b)`. `configChanged` at line 51 calls `deepEqual` for 8 config sections (groups, admins, alerts, requirements, catchUp, message, memberStatus, commands), plus `JSON.stringify` for each config key at lines 162-164. Each `JSON.stringify` call serializes the entire sub-tree into a new string, and the string comparison allocates memory proportional to the object size.
- Why: Config changes are infrequent (manual file edits), and the config object is small. The total cost is negligible at current scale. But the pattern is unnecessarily expensive — `JSON.stringify` creates a full string representation just to compare structural equality. For deeply nested objects like `alerts` (5 sub-objects with nested config), this creates 5+ temporary strings per `configChanged` call.
- How: Replace with a shallow-equal check per section, or use a single recursive deep-equal that short-circuits on first mismatch:
  ```typescript
  function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => a[key] === b[key]);
  }
  ```
  For the schedule comparison (already done field-by-field), apply the same pattern to other sections.
- Confidence: MEDIUM

### [MEDIUM] API server recomputes `computeMembers` on every request to `/reports/*` and `/members/*`
- File: `src/api/server.ts:268,298,325`
- What: `handleReport` (line 268), `handleMembers` (line 298), and `handleMemberDetail` (line 325) each call `computeMembers(snapshot, this.config)` independently. The snapshot is immutable (loaded from disk via `snapshotLoader()`), and config is checked via getter. If a client hits `/reports/daily` then `/reports/weekly` then `/members`, `computeMembers` runs 3 times on the same snapshot.
- Why: `computeMembers` iterates over all members, computes gains, weekly breakdowns, and runs ghost detection (sort). For a 34-member club this is ~1-2ms per call. Multiple rapid requests waste CPU. The snapshot doesn't change between requests within a single process lifecycle (data updates once daily).
- How: Cache the computed members alongside the snapshot in the `snapshotLoader` closure. Since the snapshot is loaded from disk (immutable), the computed members can be cached by snapshot identity. Pass a pre-computed `computedMembers` to the report handlers, or memoize `computeMembers` by snapshot reference:
  ```typescript
  // In ApiServer constructor or start():
  private cachedMembers: { snapshot: Snapshot; computed: ComputedMember[] } | null = null;
  private getComputedMembers(snapshot: Snapshot): ComputedMember[] {
    if (this.cachedMembers?.snapshot === snapshot) {
      return this.cachedMembers.computed;
    }
    const computed = computeMembers(snapshot, this.config);
    this.cachedMembers = { snapshot, computed };
    return computed;
  }
  ```
- Confidence: HIGH

### [LOW] `loadLatestSnapshot` walks entire snapshot directory tree on every call
- File: `src/data/snapshot.ts:115-123,209-228`
- What: `loadLatestSnapshot` calls `listSnapshotDates` (line 118) which recursively scans `data/snapshots/YYYY/MM/` directories via `readdirSync` at three levels (years, months, days). This is called on every WhatsApp command (via `getSnapshot()` at `index.ts:112`) and by the API server (via `snapshotLoader` at `index.ts:112`).
- Why: The directory walk traverses 3 levels of subdirectories. For a bot running for 3 months with 30 snapshots each, that's 3 `readdirSync` calls for years, ~3 for months, and ~3 for days — 9 syscalls total. This is fast but redundant per request. The snapshot doesn't change between requests (immutable until next fetch).
- How: Cache the result of `listSnapshotDates` with an mtime-based invalidation. Or, since `getSnapshot()` is already a closure, cache the snapshot at the closure level (load once, return cached until the next `prefetchSnapshot` call). The simplest approach is to cache `loadLatestSnapshot`'s result and invalidate when `saveSnapshot` is called:
  ```typescript
  let _cachedLatest: { date: number; snapshot: Snapshot | null } | null = null;
  export function loadLatestSnapshot(rootDir = process.cwd()): Snapshot | null {
    const now = Date.now();
    if (_cachedLatest && now - _cachedLatest.date < 5000) {
      return _cachedLatest.snapshot;
    }
    // ... existing logic ...
    _cachedLatest = { date: now, snapshot: result };
    return result;
  }
  ```
- Confidence: MEDIUM

### [LOW] `updateMemberHistory` queries all historical members to find departed members
- File: `src/data/member-history.ts:54`
- What: `db.getMembers(circleId)` at line 54 fetches ALL historical members for the circle (including active, stale, and left) to diff against the current snapshot. This is O(h) where h = total historical members (active + previously-left).
- Why: For a club that has had 50 members total (34 current + 16 historical), this fetches 50 rows from SQLite and then iterates through them to find the 0-16 that are no longer in the snapshot. The query itself is fast (indexed on `circle_id`), but the pattern loads more data than necessary.
- How: Add a SQL query that directly finds members not in the current snapshot, avoiding the full table scan:
  ```sql
  SELECT * FROM member_history
  WHERE circle_id = ? AND viewer_id NOT IN (?, ?, ...)
  ```
  Or use a temporary table / VALUES clause. Alternatively, since this runs once per data fetch (not per request), the current approach is acceptable at current scale.
- Confidence: LOW

### [LOW] Message cache uses FIFO eviction instead of LRU
- File: `src/whatsapp/client.ts:577-592`
- What: `cacheSentMessage` at line 577 evicts the oldest 500 entries (by insertion order) when the cache exceeds 2000 entries. This is FIFO, not LRU. Recently-accessed messages that are still needed for retry recovery may be evicted before older ones that will never be retried.
- Why: Baileys' `getMessage` callback (line 259-261) is called when a recipient device requests a retry. Retry requests typically arrive shortly after the original send. FIFO eviction at 500 entries per batch means the cache fluctuates between 1500-2000 entries. In practice, retries happen within seconds of sending, so recently-sent messages are likely still in cache. The FIFO approach works because retries are fast.
- How: No change needed at current scale. If retry latency increases (e.g., slow network), consider switching to a Map-based LRU with `Map.keys().next()` for eviction.
- Confidence: LOW

### [LOW] `loadMonthSnapshots` reads each file individually in a sequential loop
- File: `src/data/snapshot.ts:133-164`
- What: `loadMonthSnapshots` at line 149 calls `readdirSync` to list files, then reads and parses each JSON file individually in a for-loop (lines 154-161). Each file read is a synchronous `readFileSync` + `JSON.parse`.
- Why: For a full month (30 snapshots), this performs 30 synchronous file reads. The function is called during monthly report generation with offset > 0, and by `ensureMonthSnapshot` for cache checks. The sequential reads block the event loop during report generation.
- How: For the monthly report path (called once per scheduled report), the 30 reads are acceptable. If performance matters, read files in parallel using `Promise.all` with `fs.promises.readFile`. However, since `loadMonthSnapshots` is synchronous, a full async refactor would require changing the call chain. Leave as-is — the function runs infrequently (once per monthly report with offset).
- Confidence: LOW

## Positive Observations

### [POSITIVE] `computeMembers` called once per pipeline, shared across all downstream consumers
- File: `src/orchestrator/report-orchestrator.ts:304`
- What: `sendReport` computes members once at line 304 and passes the result to `generateReportString` (line 305) and `processAlertsForReport` (line 313). The same pattern applies in `sendCombinedCatchUp` (line 252). No redundant computation within the pipeline.
- Why: This ensures all report generators and alert detection operate on the same data snapshot. The single-computation pattern is clean and prevents subtle bugs from stale data.

### [POSITIVE] Immutable snapshots eliminate cache invalidation complexity
- File: `src/data/snapshot.ts:52-72`
- What: Snapshots are written atomically (write temp + rename) and never mutated after saving. Report generators receive immutable data and produce output purely from it.
- Why: Immutability means snapshot identity (`===`) is a reliable cache key. No stale-cache bugs. The data flow is predictable: fetch → save → load → compute → format.

### [POSITIVE] Playwright browser session is cached and reused
- File: `src/api/uma-moe.ts:29-31,38-41`
- What: `UmaMoeClient` caches the browser session for 4 minutes (`SESSION_CACHE_MS = 240_000`) and reuses it across multiple `fetchCircleData` calls. `ensureSession` short-circuits when the session is valid.
- Why: Browser launch + Turnstile solve takes ~10-15 seconds. Caching avoids this cost for the 2-month pre-fetch at startup (4 API calls within seconds of each other).

### [POSITIVE] Message cache has bounded size with eviction
- File: `src/whatsapp/client.ts:147-149`
- What: `MESSAGE_CACHE_MAX = 2000` and `MESSAGE_CACHE_EVICT = 500` ensure the cache doesn't grow unbounded. Eviction runs in O(evictCount) time.
- Why: Prevents memory leaks from accumulated sent messages. The 2000-entry limit provides sufficient headroom for retry recovery (Baileys retries are typically within seconds).

## Modules Reviewed
- `src/db/database.ts`: 1 finding (HIGH — auto-save exports entire DB every 30s)
- `src/utils/logger.ts`: 2 findings (MEDIUM — statSync per line, MEDIUM — Intl.DateTimeFormat per line)
- `src/index.ts`: 1 finding (MEDIUM — JSON.stringify for config comparison)
- `src/api/server.ts`: 1 finding (MEDIUM — computeMembers per request)
- `src/data/snapshot.ts`: 2 findings (LOW — directory walk per call, LOW — sequential file reads)
- `src/data/member-history.ts`: 1 finding (LOW — full table query for diff)
- `src/whatsapp/client.ts`: 1 finding (LOW — FIFO eviction)
- `src/whatsapp/dispatch.ts`: clean — single computeMembers call per command
- `src/orchestrator/report-orchestrator.ts`: clean — single computeMembers per pipeline
- `src/config.ts`: clean — atomic write pattern is correct
- `src/reports/compute.ts`: clean — O(n) per member, O(n log n) for ghost sort
- `src/reports/daily.ts`: clean — uses pre-computed members
- `src/reports/weekly.ts`: clean — uses pre-computed members
- `src/reports/monthly.ts`: clean — uses pre-computed members
- `src/reports/stats.ts`: clean (minor redundant filter, correctness finding)
- `src/reports/ranks.ts`: clean — filter + sort + slice(0,10)
- `src/reports/bottom.ts`: clean — filter + sort + slice(0,10)
- `src/reports/members.ts`: clean — sort + iterate
- `src/reports/tier.ts`: clean — O(1) computation
- `src/reports/compare.ts`: clean — 2 member lookups + 2 rolling averages
- `src/reports/analyze.ts`: clean — 1 member lookup + rolling averages
- `src/reports/combined.ts`: clean — delegates to individual generators
- `src/scheduler/scheduler.ts`: clean — cron scheduling, no hot-path computation
- `src/scheduler/catchup.ts`: clean — O(n) for n missed report types
- `src/scheduler/helpers.ts`: clean — pure utility functions
- `src/alerts/alerts.ts`: clean — O(m) for m members, O(a) DB queries for a alerts
- `src/whatsapp/access.ts`: clean — O(1) JID lookups
- `src/whatsapp/commands.ts`: clean — O(m) for member name resolution
- `src/whatsapp/admin.ts`: clean — no computation
- `src/types/index.ts`: clean — type definitions only
- `src/runtime.ts`: clean — in-memory counters, O(1)
- `src/data/daily-fans.ts`: clean — O(32) per member, no allocation
- `src/data/ensure-snapshot.ts`: clean — cache-or-fetch with disk check
- `src/reports/format.ts`: clean — pure string formatting
- `src/reports/registry.ts`: clean — switch dispatch
- `src/utils/format.ts`: clean — pure string utilities
- `src/utils/timezone.ts`: clean — pure timezone functions
- `src/api/uma-moe.ts`: clean — session caching, retry logic
- `src/utils/index.ts`: clean — single re-export

## Low-Confidence Notes

- [index.ts:129-190] Config watcher reads the entire file every 5s. This is documented as an "accepted" pattern (polling-based, reliable on Windows). The performance cost is one `readFileSync` of a ~2KB YAML file every 5s — negligible. Not flagged as a finding.

- [logger.ts:183,189] Logger synchronous file I/O is documented as an accepted risk (architecture.md:623): "Acceptable at current scale (~100 lines per report cycle)." Not flagged as a finding, but the `statSync` and `Intl.DateTimeFormat` per-line issues are separate from the sync I/O and ARE flagged.

- [alerts.ts:78,96,120,137,161] `isAlertAlreadySent` is called twice per alert candidate — once in `detectAlerts` and once in `recordAlert` (via `processAlertsForReport`). The second call is redundant but harmless since the DB is in-memory WASM. The two-call pattern is a correctness guard (alert could be sent between detection and recording in theory), not a performance issue.

- [snapshot.ts:66] `saveSnapshot` uses `JSON.stringify(snapshot, null, 2)` with pretty-printing. The indented format adds ~30% more bytes than compact JSON. For a 34-member snapshot (~50-100KB), this adds ~15-30KB per save. Acceptable for human-readability of snapshot files.
