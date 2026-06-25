# Maintainability Audit Findings

## Summary
13 findings: 0 CRITICAL, 0 HIGH, 7 MEDIUM, 3 LOW, 3 POSITIVE

## Findings

### [MEDIUM] Report type knowledge scattered across 6+ files
- File: `src/reports/registry.ts`, `src/scheduler/scheduler.ts`, `src/scheduler/catchup.ts`, `src/scheduler/helpers.ts`, `src/whatsapp/dispatch.ts`, `src/reports/combined.ts`
- What: Adding a new report type requires coordinated changes across at least 6 files: registry (generator routing), scheduler (cron generation + collision detection), catchup (isReportMissed switch + isReportEnabled switch), helpers (isScheduledToday + getCollidingTypes + groupByCollision), dispatch (REPORT_COMMANDS set + offset max mapping), and combined (switch statement).
- Why: A developer adding a new report type must remember to update all 6 locations. Missing one causes silent failures — e.g., a report type that generates but can't be scheduled, or one that's scheduled but has no collision handling. The report type string is repeated as literal values in each file with no single source of truth for "all known types."
- How: Create a `REPORT_TYPE_REGISTRY` constant (or expand the existing `REPORT_TYPES` in registry.ts) that defines each type's metadata: generator function, default offset max, whether it supports offset, its cron schedule key, and collision group. Then have scheduler, catchup, and dispatch consume this registry instead of maintaining independent switch statements.

### [MEDIUM] Database adapter row mapping is duplicated across SQLite and MySQL
- File: `src/db/database.ts:389-461`, `src/db/mysql-database.ts:202-447`
- What: Both adapters implement near-identical row-to-object mapping for `ScheduleRunRow`, `MemberHistoryRow`, and `RankHistoryRow`. SQLite uses a generic `mapColumns` helper (line 408) while MySQL does manual inline mapping. The SQL column lists are identical across both files.
- Why: When the schema changes (e.g., adding a column to `schedule_runs`), both files must be updated in lockstep. The mapping logic is 60+ lines of boilerplate that's easy to get wrong independently. If one adapter maps a field correctly and the other doesn't, the bug surfaces only when switching backends.
- How: Extract row mapping functions into a shared module (e.g., `src/db/mappers.ts`) that both adapters import. The mappers take a row object and return the typed result. Each adapter only needs to implement the query execution layer.

### [MEDIUM] `detectAlerts` is 200 lines with repeated structural patterns across 5 alert types
- File: `src/alerts/alerts.ts:35-203`
- What: The function contains 5 sequential if-blocks (performance_drop, demotion_risk, streak_break, new_transfer, rank_drop), each following the same pattern: check enabled → loop members / compute condition → build eventKey → push to candidates. The quiet-hours suppression logic at lines 162-199 is also a long nested block.
- Why: Adding a new alert type requires copying the pattern and remembering to append to both `candidateKeys` and `candidateAlerts`. The quiet-hours block at lines 162-199 (40 lines) handles suppression but mixes hour-parsing, timezone formatting, and DB recording in one block.
- How: Extract each alert type into its own detector function that returns `{ keys: string[], alerts: Alert[] }`. The main `detectAlerts` function becomes a coordinator: call each detector, merge results, filter duplicates, apply quiet-hours. This makes each detector independently testable and reduces the cognitive load of the main function.

### [MEDIUM] `setupCommandHandler` parameter threading explosion (7-9 parameters through deep call chain)
- File: `src/whatsapp/dispatch.ts:54-61`, `src/whatsapp/dispatch.ts:88-96`, `src/whatsapp/dispatch.ts:273-282`
- What: `setupCommandHandler` takes 7 parameters, which it threads into `dispatchMessage` (8 params), which threads into `generateAndSend` (9 params). Each level adds one more parameter (`onConfigUpdate`, `prefetchSnapshot`) but the core data (`client`, `config`, `db`, `getSnapshot`) is passed unchanged through all three levels.
- Why: Adding any new dependency (e.g., a new callback or service) requires modifying the function signature at all three levels plus every caller. The 9-parameter `generateAndSend` is near the point where positional parameters become unreadable.
- How: Group related parameters into an options/context object. For example: `{ client, config, db, getSnapshot, prefetchSnapshot, onConfigUpdate }`. The dispatch functions then take 2-3 params (context + parsed command + chat info) instead of 7-9. This also makes it trivial to add new dependencies without signature changes.

### [MEDIUM] `executeCatchUp` is 125 lines with 3 divergent code paths
- File: `src/scheduler/catchup.ts:179-304`
- What: The function handles three scenarios: (1) single report type — record + send + update status, (2) combined reports with `onCombinedReport` callback — record combined + record individual types + handle alerts, (3) combined reports without callback — fallback to sending each type individually. Paths 2 and 3 share the same outer structure but differ in the inner loop.
- Why: The three paths share ~60% of their logic (run recording, error handling, status updates, alert collection) but are written as three separate code blocks. This makes the function hard to follow and easy to introduce bugs when modifying the error handling or recording logic — a fix in one path may be missed in another.
- How: Extract the common "record run → execute → update status → collect alerts" pattern into a helper function. The main `executeCatchUp` then becomes: group by collision → for each group, determine strategy (single / combined / fallback) → call the helper. This reduces the function to ~50 lines and makes each path independently clear.

### [MEDIUM] `configChanged` in index.ts manually compares schedule fields
- File: `src/index.ts:59-82`
- What: The `configChanged` function manually lists 8 individual schedule field comparisons (`daily.time`, `daily.enabled`, `weekly.time`, `weekly.enabled`, `weekly.days`, `monthly.time`, `monthly.enabled`, `monthly.day`) plus `deepEqual` calls for 7 config sections. Adding a new config section or schedule field requires updating this function.
- Why: The function duplicates knowledge about the config schema that already exists in the Zod schema (`config.ts:22-135`). If a field is added to the config but forgotten here, config hot-reload won't detect changes to that field.
- How: Replace the manual field-by-field comparison with a single `deepEqual(oldConfig, newConfig)` check. If the full deep-equal is too coarse (triggering false reloads on reference changes), compare `JSON.stringify(oldConfig)` vs `JSON.stringify(newConfig)` — this captures all fields automatically and is safe at the 1KB config size.

### [MEDIUM] `generateReportString` method name shadows the imported function
- File: `src/orchestrator/report-orchestrator.ts:146-166`
- What: The `ReportOrchestrator.generateReportString` method (line 146) has the same name as the imported `generateReportString` from `reports/registry.ts` (line 17). The method internally calls the import at line 153, which TypeScript resolves correctly but is confusing to read.
- Why: A developer reading line 153 (`await generateReportString(type, ...)`) may think it's a recursive call. The shadowing makes it unclear which function is being called without checking imports. This is a common source of bugs during refactoring.
- How: Rename the method to something distinct like `buildReportString` or `renderReport`, or rename the import via `import { generateReportString as registryGenerateReportString }`.

### [LOW] `settings` table DDL exists in both adapters but has no IDatabase methods
- File: `src/db/database.ts:105-112`, `src/db/mysql-database.ts:133-140`
- What: Both database adapters create a `settings` table on initialization (with a comment noting it's "for future use"), but the `IDatabase` interface has no read/write methods for this table.
- Why: Dead schema code adds visual noise to the initialization logic. A developer reading `createTables` may wonder what the `settings` table is for and whether it's actually used.
- How: Remove the DDL from both adapters. When the `settings` table is actually needed, add it back alongside the corresponding IDatabase methods. If kept for forward-planning, move the DDL to a separate `migrations/` directory.

### [LOW] `Database` backward-compat aliases are unused dead code
- File: `src/db/database.ts:464-466`
- What: Lines 464-466 export `Database` as both a type alias and a value alias for `SqliteDatabase`. Neither the type nor the value is imported anywhere in the codebase — all consumers import either `SqliteDatabase` directly or `IDatabase` from types.
- Why: Dead code adds noise and creates confusion about which name to use. A new developer may import `Database` thinking it's the canonical name, only to find it's just an alias.
- How: Remove lines 464-466. The comment says "will be removed once all consumers migrate to IDatabase" — that migration is already complete.

### [LOW] `isStaleMember` is deprecated but still exported
- File: `src/data/daily-fans.ts:211-220`
- What: The function has a `@deprecated` JSDoc tag directing users to `isStaleForReport`, and no production code imports it. However, it's still exported and tested by 4 test files.
- Why: Deprecated exports create ambiguity about which function to use. Test files importing a deprecated function may give false confidence that it's still part of the supported API.
- How: Since this is test-only, add a comment clarifying it's retained exclusively for backward-compatible test assertions. Alternatively, migrate the 4 test files to use `isStaleForReport` and remove the export.

### [POSITIVE] Report generators are self-contained pure functions with well-factored shared helpers
- File: `src/reports/daily.ts`, `src/reports/weekly.ts`, `src/reports/ranks.ts`, etc.
- What: Each report generator is a single exported function (46-159 lines) that takes data in, returns a string out. Shared logic (header building, stale section, footer, date formatting) is extracted into `reports/format.ts` (114 lines) and `utils/format.ts`.
- Why: This is the correct decomposition for report generators. Each file is independently readable, testable, and modifiable. The shared helpers prevent copy-paste across generators while keeping each generator's output logic visible in one place.

### [POSITIVE] Database IDatabase interface provides a clean adapter boundary
- File: `src/db/types.ts:1-87`
- What: All 16 database methods are defined in `IDatabase` as async operations. Every consumer imports `IDatabase` from types — no code depends on `SqliteDatabase` or `MysqlDatabase` directly (except the factory). The adapter swap is a single config change.
- Why: This is textbook adapter pattern. The clean interface boundary means adding a third adapter (e.g., PostgreSQL) requires only a new class implementing `IDatabase` plus a factory case — zero changes to any consumer.

### [POSITIVE] Test structure mirrors src/ with descriptive naming conventions
- File: `tests/` directory
- What: Test files mirror the src/ path exactly (e.g., `src/reports/daily.ts` → `tests/reports/daily/daily.unit.test.ts`). Test categories are distinguished by suffix: `.unit.test.ts`, `.integration.test.ts`, `.edge.test.ts`, `.regression.test.ts`, `.format.test.ts`, `.dispatch.test.ts`.
- Why: This structure makes it trivial to find the test for any source file. The naming convention is self-documenting — you know exactly what kind of test you're reading without opening it. The 1,632 tests across 67 suites demonstrate thorough coverage.

## Modules Reviewed
- `src/reports/` (12 files): 1 finding (report type scattered knowledge)
- `src/db/` (4 files): 2 findings (adapter duplication, dead schema + aliases)
- `src/alerts/alerts.ts`: 1 finding (detectAlerts size/pattern)
- `src/whatsapp/dispatch.ts`: 1 finding (parameter threading)
- `src/scheduler/catchup.ts`: 1 finding (executeCatchUp complexity)
- `src/index.ts`: 1 finding (configChanged duplication)
- `src/orchestrator/report-orchestrator.ts`: 1 finding (name shadowing)
- `src/data/daily-fans.ts`: 1 finding (deprecated export)
- `src/data/snapshot.ts`: clean
- `src/data/member-history.ts`: clean
- `src/api/server.ts`: clean
- `src/config.ts`: clean
- `src/utils/logger.ts`: clean
- `src/utils/timezone.ts`: clean
- `src/utils/format.ts`: clean
- `src/whatsapp/client.ts`: clean (large file accepted per docs)
- `src/whatsapp/commands.ts`: clean
- `src/whatsapp/access.ts`: clean
- `src/whatsapp/admin.ts`: clean
- `src/scheduler/scheduler.ts`: clean
- `src/scheduler/helpers.ts`: clean
- `src/reports/format.ts`: clean
- `src/reports/compute.ts`: clean
- `src/reports/registry.ts`: clean
- `src/reports/combined.ts`: clean

## Low-Confidence Notes

- `src/index.ts:367 lines` — The entry point has grown to include config watching, data fetching, member history updates, scheduler creation, and WhatsApp connection. The config watcher alone (lines 132-198) is 66 lines of inline logic. This isn't flagged as HIGH because the file is the composition root and the logic is mostly sequential wiring. However, if more features are added, extracting the config watcher into its own module would be prudent.

- `src/whatsapp/client.ts:287-343` — The `messages.upsert` event handler is 56 lines of inline processing (normalization, logging, handler dispatch). This is within the documented acceptance of the large file but adds to the cognitive load of an already-complex file.

- `src/scheduler/scheduler.ts:198-304` — The `start()` method is 106 lines setting up 3 cron tasks with interleaved collision logic. Each task's callback duplicates the pattern of "get today, check collisions, decide whether to send or skip." This could be extracted into a helper but is acceptable at current scale.
