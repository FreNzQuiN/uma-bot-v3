# Architecture Audit Findings

## Summary
10 findings: 0 CRITICAL, 2 HIGH, 5 MEDIUM, 3 LOW

## Findings

### [HIGH] dispatch.ts bypasses orchestrator and registry for compare/analyze
- File: src/whatsapp/dispatch.ts:14-17
- What: `dispatch.ts` directly imports `generateCompareReport` and `generateAnalyzeReport` instead of routing through the registry or orchestrator.
- Why: The registry (`reports/registry.ts:25`) exists as the single source of truth for report type → generator mapping. Bypassing it means adding a new dispatch-only report type requires modifying both dispatch.ts AND the registry, creating two places to maintain the same kind of logic. It also duplicates the compute → generate pipeline that the orchestrator already provides.
- How: Extend the registry to include `compare` and `analyze` types, or create a secondary dispatch registry for member-resolution commands. The `dispatch.ts:generateReport()` function (line 336) re-implements orchestration logic that already exists in `ReportOrchestrator.sendReport()` — consider delegating to the orchestrator with a `{ interactive: true }` option that uses `sendOrEdit` instead of `sendMessage`.
- Confidence: HIGH

### [HIGH] dispatch.ts is 466 lines mixing routing, business logic, and presentation
- File: src/whatsapp/dispatch.ts:1-466
- What: This file handles command routing (line 310), report generation orchestration (line 336), member name resolution (line 359), admin command processing (line 393), help text formatting (line 163), uptime formatting (line 49), and loading message rotation (line 45). It's the second-largest file in the codebase.
- Why: High coupling makes the file hard to modify safely. A change to help text formatting risks breaking report dispatch. The file's responsibilities span 4 distinct concerns: routing, business logic, presentation, and state formatting.
- How: Extract `generateReport()` (lines 336-387) into a report dispatch service that both `dispatch.ts` and the orchestrator can share. Extract help/admin message formatting (lines 163-222, 430-461) into `whatsapp/admin.ts` or a new `whatsapp/help.ts`. Extract `formatUptime()` and loading message helpers into `utils/`. Target: dispatch.ts under 200 lines, handling only routing decisions.
- Confidence: HIGH

### [MEDIUM] Unused `db` parameter in 6 of 7 report generators creates unnecessary coupling
- File: src/reports/daily.ts:29, weekly.ts:51, monthly.ts:38, bottom.ts:27, stats.ts:27, tier.ts:24
- What: Six report generators accept `db?: Database` in their signature but never reference the parameter in the function body. Only `members.ts` actually uses it (for `getLeftMembers`).
- Why: Every unused parameter widens the type signature, making callers believe the function needs database access when it doesn't. This creates a false dependency graph: a reader looking at `generateDailyReport(snapshot, config, computedMembers, offset, db)` assumes daily reports query the database. It also forces `registry.ts` and `combined.ts` to thread `Database` through every call path even when the target report doesn't need it.
- How: Remove the `db?: Database` parameter from daily, weekly, monthly, bottom, stats, and tier generators. Only `members.ts` should accept it. Update `registry.ts:generateReportString` to pass `db` only to `generateMembersReport`. This also removes 6 unnecessary `import type { Database }` statements.
- Confidence: HIGH

### [MEDIUM] alerts module depends on reports module for tier data computation
- File: src/alerts/alerts.ts:11
- What: `alerts.ts` imports `computeTierData` from `reports/compute.ts` to check demotion risk.
- Why: This creates a cross-layer coupling: alerts → reports → data. The `computeTierData` function (defined in `reports/compute.ts:112`) is pure computation on snapshot data — it doesn't depend on any report-specific logic. Its natural home is the data layer, not the report layer. When alerts import from reports, it implies alerts are downstream of reports, when in reality they run in parallel after `computeMembers()`.
- How: Move `computeTierData` to `data/daily-fans.ts` (alongside other pure computation on snapshot data) or create `data/tier.ts`. Both `reports/compute.ts` and `alerts/alerts.ts` would import from the data layer. This aligns with the existing pattern where `computeMembers` already lives in `reports/compute.ts` but only depends on data-layer functions.
- Confidence: MEDIUM

### [MEDIUM] Config getter pattern is inconsistent across modules
- File: src/whatsapp/dispatch.ts:70, src/api/server.ts:63
- What: Some modules accept `BotConfig | (() => BotConfig)` and resolve internally (dispatch.ts:77-81, ApiServer constructor:68), while others accept only `() => BotConfig` (Scheduler, CatchUpManager, ReportOrchestrator, WhatsAppClient).
- Why: The dual-type pattern forces every consumer to check `typeof config === 'function'` and handle both paths. It also means the type signature doesn't communicate whether the config is reactive. If a caller passes a static `BotConfig` object, config hot-reload won't affect that module.
- How: Standardize on the getter pattern `() => BotConfig` everywhere. The composition root (`index.ts`) already provides a `getConfig` closure. Remove the dual-type overloads from `ApiServer` and `setupCommandHandler`. This makes all modules reactive to config changes by default.
- Confidence: MEDIUM

### [MEDIUM] orchestrator mixes snapshot freshness management with report delivery
- File: src/orchestrator/report-orchestrator.ts:104-143
- What: `alignSnapshotToMonth()` performs network fetches (line 115, 133) and disk writes (line 116, 134) inline. The orchestrator imports `saveSnapshot` and `ensureMonthSnapshot` from the data layer.
- Why: The orchestrator's stated purpose is "report pipeline: generation + delivery + alerts" (architecture.md:95). Snapshot freshness (fetching fresh data when stale) is a data acquisition concern. Mixing I/O-heavy data fetching into the report delivery pipeline makes the orchestrator harder to test and reason about — a `sendReport()` call can trigger network requests with unpredictable latency.
- How: Extract `alignSnapshotToMonth` into a dedicated `data/freshness.ts` or fold it into `ensure-snapshot.ts`. The orchestrator would call `ensureFreshSnapshot(type, snapshot, config)` as a pre-step, keeping the orchestrator focused on the generate → deliver → alert pipeline.
- Confidence: MEDIUM

### [LOW] reports/format.ts re-exports formatDateWIB creating dual import paths
- File: src/reports/format.ts:13
- What: `reports/format.ts` does `export { formatDateWIB }` which re-exports the function from `utils/timezone.ts`. Consumers can import `formatDateWIB` from either `utils/timezone` or `reports/format`.
- Why: Dual import paths create confusion about the canonical source. New contributors may import from `reports/format` when they should import from `utils/timezone`, creating an implicit dependency on the reports module for a pure utility.
- How: Remove the re-export at `reports/format.ts:13`. Report files that need `formatDateWIB` should import it directly from `utils/timezone`. The `reports/format.ts` module should only contain report-specific formatting helpers (`getStaleDataWarning`, `buildDateStr`, `buildFooter`, `buildDataLine`).
- Confidence: HIGH

### [LOW] utils/index.ts barrel file is unused dead code
- File: src/utils/index.ts:1
- What: The barrel file only re-exports `./timezone`. No source file imports from `utils/index.ts` — all consumers import specific submodules (`utils/timezone`, `utils/logger`, `utils/format`).
- Why: An unused barrel file creates a maintenance obligation (must be updated when adding new utils) without providing value. It also creates a false impression that the project uses barrel imports.
- How: Delete `src/utils/index.ts`. No callers need updating since nothing imports from it.
- Confidence: HIGH

### [POSITIVE] Clean DAG dependency graph with no circular imports
- File: Full codebase
- What: The dependency graph is a clean directed acyclic graph. All modules flow downward: `types` and `utils/*` are leaf nodes, `data/*` depends on leaves, `reports/*` depends on data and leaves, `scheduler/whatsapp/alerts` depend on types/utils/db, and `orchestrator` sits at the top integrating everything.
- Why: Zero circular dependencies across 40 files means the codebase can be understood, tested, and refactored module-by-module without surprise breakage. The composition root (`index.ts`) correctly wires all dependencies explicitly.
- How: Maintain this pattern. New modules should follow the existing layering: leaves → data → reports → orchestrator.
- Confidence: HIGH

### [POSITIVE] Dependency injection via getter functions enables testability and hot-reload
- File: src/orchestrator/report-orchestrator.ts:20-41, src/scheduler/scheduler.ts:21-40
- What: Core services accept `() => BotConfig` and `() => Snapshot | null` getter functions rather than static config objects. This is applied consistently across Scheduler, CatchUpManager, ReportOrchestrator, WhatsAppClient, and ApiServer.
- Why: Getter functions enable two critical behaviors: (1) config hot-reload works without restarting services — the getter returns the latest config each time, and (2) tests can inject mock config without instantiating the full config system. This is a well-executed pattern that supports the intermittent-runtime design constraint.
- How: No change needed — this is a pattern to preserve and extend to new modules.
- Confidence: HIGH

### [POSITIVE] ensure-snapshot.ts cleanly bridges data and API layers
- File: src/data/ensure-snapshot.ts:1-66
- What: This 66-line module bridges the data layer (snapshot I/O) and API layer (uma.moe fetch) using a type-only import for `UmaMoeClient`. The file comment explicitly documents why it exists: "to avoid a data → api dependency."
- Why: This is textbook dependency inversion. The function signature accepts an interface (`UmaMoeClient`) rather than the module depending on the concrete API client. It keeps the data layer clean while providing the cache-or-fetch pattern that multiple callers need.
- How: No change needed — this is the correct pattern for cross-layer bridging.
- Confidence: HIGH

## Modules Reviewed
- `src/index.ts`: Clean composition root, inline config watcher is acceptable for startup logic
- `src/config.ts`: Clean, well-structured with Zod validation
- `src/runtime.ts`: Minimal singleton, no issues
- `src/types/index.ts`: Comprehensive shared types, no issues
- `src/db/database.ts`: Solid data access layer, `rawRun` for transactions is pragmatic
- `src/data/snapshot.ts`: Clean immutable snapshot management
- `src/data/daily-fans.ts`: Pure computation, well-documented
- `src/data/ensure-snapshot.ts`: Clean bridge pattern (positive)
- `src/data/member-history.ts`: Proper transaction handling with rollback
- `src/api/uma-moe.ts`: Isolated Playwright client, clean interface
- `src/api/server.ts`: Acceptable for localhost-only API, consistent response envelope
- `src/reports/compute.ts`: Clean transformation engine (note: `computeTierData` belongs in data layer)
- `src/reports/registry.ts`: Clean pattern, should include compare/analyze
- `src/reports/format.ts`: Has unnecessary re-export (LOW finding)
- `src/reports/daily.ts`: Clean, unused `db` param (MEDIUM finding)
- `src/reports/weekly.ts`: Clean, unused `db` param (MEDIUM finding)
- `src/reports/monthly.ts`: Clean, unused `db` param (MEDIUM finding)
- `src/reports/ranks.ts`: Clean, no issues
- `src/reports/bottom.ts`: Clean, unused `db` param (MEDIUM finding)
- `src/reports/stats.ts`: Clean, unused `db` param (MEDIUM finding)
- `src/reports/members.ts`: Only report that actually uses `db` parameter correctly
- `src/reports/tier.ts`: Clean, unused `db` param (MEDIUM finding)
- `src/reports/compare.ts`: Clean, but bypassed via direct import in dispatch.ts
- `src/reports/analyze.ts`: Clean, but bypassed via direct import in dispatch.ts
- `src/reports/combined.ts`: Clean aggregation pattern
- `src/orchestrator/report-orchestrator.ts`: Good pipeline design, snapshot freshness logic should be extracted
- `src/scheduler/scheduler.ts`: Clean cron management with collision detection
- `src/scheduler/catchup.ts`: Well-structured missed report detection
- `src/scheduler/helpers.ts`: Pure utility functions, clean
- `src/whatsapp/client.ts`: Large but documented as accepted (architecture.md:635)
- `src/whatsapp/dispatch.ts`: Oversized, mixes concerns (HIGH finding)
- `src/whatsapp/commands.ts`: Clean parser with fuzzy matching
- `src/whatsapp/access.ts`: Clean access control logic
- `src/whatsapp/admin.ts`: Clean admin command handlers
- `src/alerts/alerts.ts`: Clean alert detection, cross-module dependency on reports/compute (MEDIUM finding)
- `src/utils/format.ts`: Pure string utilities, no issues
- `src/utils/logger.ts`: Self-contained structured logger, clean
- `src/utils/timezone.ts`: Clean timezone handling via Intl API
- `src/utils/index.ts`: Unused barrel file (LOW finding)

## Low-Confidence Notes

- [reports/compute.ts:33-107] `computeMembers` does ghost detection by sorting all members by monthlyGain and reclassifying the bottom N as 'left'. This is a heuristic that could misclassify in edge cases (documented in architecture.md:633). Not flagged as a finding because it's an accepted design choice.

- [index.ts:121-123] `setupCommandHandler` receives both a config getter AND an `onConfigUpdate` callback AND a `prefetchSnapshot` function. This triple callback pattern is necessary for the composition root to wire hot-reload, but the function signature has grown to 7 parameters. Not flagged because it's the composition root's job to wire dependencies, and refactoring would require a builder pattern that adds complexity without clear benefit at this scale.

- [whatsapp/client.ts:52-69] Global `console.error` monkey-patching affects the entire process. The architecture.md documents this as accepted (line 674). Not flagged because the Baileys library generates high-volume noise that cannot be intercepted through normal logging channels.
