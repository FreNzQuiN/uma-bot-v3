# Architecture Audit Findings

## Summary
15 findings: 0 CRITICAL, 3 HIGH, 7 MEDIUM, 2 LOW, 3 POSITIVE

---

## Findings

### [HIGH] Reversed dependency: data layer imports API layer
- File: `src/data/snapshot.ts:13`
- What: `data/snapshot.ts` imports `UmaMoeClient` from `api/uma-moe.ts` via the `ensureMonthSnapshot` function, creating a data → api dependency.
- Why: The data layer (persistence) should not depend on the API layer (network fetching). This violates the Dependency Inversion Principle — high-level persistence logic depends on a low-level network client. It makes the data module untestable without mocking the API, and prevents reusing snapshot logic in contexts without network access (e.g., offline report generation, testing).
- How: Move `ensureMonthSnapshot` to the orchestrator or a dedicated service module. The orchestrator already depends on both `data/snapshot` and `api/uma-moe`, so it's the natural home for this coordination logic. `data/snapshot.ts` should only handle file I/O and data validation.
- Confidence: HIGH

### [HIGH] Duplicated report generation dispatch (3 locations)
- File: `src/whatsapp/dispatch.ts:350-411`, `src/orchestrator/report-orchestrator.ts:160-178`
- What: Report type → generator function routing is implemented as a switch statement in both `dispatch.ts` (lines 360-411) and `report-orchestrator.ts` (lines 168-178). A third implicit dispatch exists in `index.ts` (lines 270-293) for combined reports.
- Why: Adding a new report type requires updating 3 separate locations with identical switch logic. This violates DRY and is a maintenance hazard — if one location is updated but not the others, reports will silently fail or return unknown type errors.
- How: Create a report registry module (e.g., `src/reports/registry.ts`) that maps type strings to generator functions. Both `dispatch.ts` and `report-orchestrator.ts` import from the registry. This reduces the 3 locations to 1.
- Confidence: HIGH

### [HIGH] `whatsapp/client.ts` is a god module (634 lines, 8+ responsibilities)
- File: `src/whatsapp/client.ts:129-634`
- What: This file handles connection lifecycle, QR authentication, libsignal error suppression (monkey-patching `console.error`), Baileys logger adapter, message receiving/normalizing, message sending/splitting, message editing, message caching with LRU eviction, heartbeat monitoring, exponential-backoff reconnection, chat accumulation, and group fetching.
- Why: Changes to any single responsibility risk breaking unrelated functionality. The 100+ lines of reconnection logic (lines 387-460) are interleaved with message handling, making both harder to reason about. The monkey-patch at lines 52-68 is a global side effect that silently affects all modules.
- How: Split into focused modules: `whatsapp/connection.ts` (connect/reconnect/auth), `whatsapp/messenger.ts` (send/edit/cache), `whatsapp/events.ts` (message receive/dispatch). Move the `console.error` monkey-patch to a documented setup function called at startup, not buried inside the class.
- Confidence: HIGH

### [MEDIUM] `data/snapshot.ts` mixes 3 distinct concerns (426 lines)
- File: `src/data/snapshot.ts:1-426`
- What: This module handles (1) snapshot file I/O (save/load/ensure paths), (2) member history database operations (`updateMemberHistory`, `getLeftMembers`), and (3) API data fetching (`ensureMonthSnapshot`).
- Why: Three different persistence mechanisms (JSON files, SQLite DB, HTTP API) are tangled in one module. Changes to member history logic risk breaking snapshot I/O. The DB import at line 206 is a mid-file import that suggests the concern was added later.
- How: Extract member history operations into `data/member-history.ts` (depends on `db/database` and `data/snapshot`). Extract `ensureMonthSnapshot` to the orchestrator layer. Leave `snapshot.ts` as pure file I/O for snapshot persistence.
- Confidence: HIGH

### [MEDIUM] Monthly offset calculation duplicated in 3+ locations
- File: `src/index.ts:279-283`, `src/whatsapp/dispatch.ts:268-283`, `src/orchestrator/report-orchestrator.ts:273-290`
- What: The pattern `let targetMonth = curMonth - absOffset; let targetYear = curYear; while (targetMonth <= 0) { targetMonth += 12; targetYear--; }` is copy-pasted in at least 3 locations.
- Why: If the offset logic needs to change (e.g., supporting multi-month offsets), all 3 locations must be updated identically. A bug in one copy but not others would cause inconsistent behavior between command-triggered and scheduled reports.
- How: Extract to a utility function like `getTargetMonth(currentYear, currentMonth, offsetMonths)` in `utils/timezone.ts`. All callers use the shared function.
- Confidence: HIGH

### [MEDIUM] Cross-module coupling: alerts depends on reports/tier for computation
- File: `src/alerts/alerts.ts:11`
- What: `alerts.ts` imports `computeTierData` from `reports/tier.ts`. Alert detection (a domain concern) depends on a report module (a presentation concern).
- Why: The `computeTierData` function is pure computation on snapshot data, but it lives in a report module. This means alerts → reports, creating an inappropriate dependency. If `reports/tier.ts` is refactored for presentation changes, alerts could break.
- How: Move `computeTierData` to a shared computation module (e.g., `reports/compute.ts` or a new `domain/tier.ts`). Both alerts and tier report import from the shared location.
- Confidence: HIGH

### [MEDIUM] Alert delivery duplicated between orchestrator and index.ts catch-up flow
- File: `src/orchestrator/report-orchestrator.ts:85-104`, `src/index.ts:337-353`
- What: Catch-up alert delivery in `index.ts` (lines 337-353) manually iterates over alert targets and sends messages, duplicating the logic in `ReportOrchestrator.deliverAlerts()` (lines 85-104).
- Why: If alert delivery logic changes (e.g., adding retry, changing target resolution), the catch-up path will silently diverge from the normal path. This is already partially evidenced by the catch-up flow using `waClient.sendMessage()` directly while the orchestrator uses `this.waClient.sendMessage()`.
- How: Extract the catch-up alert delivery to use `orchestrator.deliverAlerts()` directly, or create a shared `AlertDeliveryService` used by both paths.
- Confidence: HIGH

### [MEDIUM] `reports/format.ts` is a grab-bag utility module
- File: `src/reports/format.ts:1-135`
- What: This module mixes number formatting, date formatting (re-exports from `utils/timezone`), stale data warnings, name sanitization, date string building, footer building, and message splitting re-exports from `utils/format`. It has 12 dependents — the 4th most-imported module in the codebase.
- Why: Changes to any concern (e.g., adding a new date format) risk breaking unrelated functionality. The re-exports at lines 39-40 and 135 create implicit dependencies — modules import from `reports/format` when they should import from `utils/timezone` or `utils/format` directly.
- How: Split into focused modules: keep `formatNumber` and `sanitizeName` in `reports/format.ts` (report-specific formatting), move `getStaleDataWarning`/`buildDateStr`/`buildFooter`/`buildDataLine` to a new `reports/helpers.ts`, and remove re-exports so callers import directly from source modules.
- Confidence: MEDIUM

### [MEDIUM] `configChanged()` uses JSON.stringify for deep comparison
- File: `src/index.ts:42-65`
- What: Config change detection compares old and new configs using `JSON.stringify()` (lines 54-63). This works only because Zod produces consistent key ordering.
- Why: If any code path produces a config object with different key ordering (e.g., manual construction in tests), the comparison will produce false positives. It's also semantically unclear — `JSON.stringify` treats `undefined` values differently than `null`.
- How: Use a proper deep equality check (e.g., a small `deepEqual` utility, or structuredClone + comparison). The existing `deepMerge` in `config.ts` already handles deep objects — a matching `deepEqual` would be consistent.
- Confidence: MEDIUM

### [LOW] `runtime.ts` uses module-level mutable state with no reset mechanism
- File: `src/runtime.ts:21-39`
- What: All runtime stats are stored in a module-level `stats` object. There's no `reset()` function.
- Why: In tests, runtime state leaks between test cases. The `getRuntimeStats()` function returns a shallow copy with one deep-copied field (`lastConfigChangeFields`), but the rest are primitives — fine for now, but if any field becomes an object, it would leak.
- How: Add a `resetRuntimeStats()` function for test isolation. Consider wrapping in a class for better encapsulation.
- Confidence: MEDIUM

### [LOW] `logger.ts` uses synchronous file I/O on every log line
- File: `src/utils/logger.ts:183,189`
- What: `appendFileSync` is called for every log line. In high-throughput scenarios (e.g., processing 30+ member messages rapidly), this blocks the event loop.
- Why: Under normal operation the impact is minimal (log lines are small, SSDs are fast). But if the log file is on a network mount or the disk is under heavy I/O, this could cause noticeable latency spikes in message processing.
- How: This is acceptable for the current scale (~100 log lines per report cycle). If throughput increases, switch to a buffered async writer (write queue with periodic flush). No action needed now.
- Confidence: MEDIUM

---

## Positive Findings

### [POSITIVE] Clean composition root pattern
- File: `src/index.ts:67-382`
- What: `index.ts` serves as a proper composition root — it instantiates all modules, wires dependencies, and starts services. No business logic is exported from it.
- Why: This pattern makes the application's dependency graph explicit and testable. Each module receives its dependencies through constructor injection, making mocking straightforward.
- Confidence: HIGH

### [POSITIVE] Zero circular dependencies across 37 source files
- File: N/A (codebase-wide)
- What: The dependency graph is fully acyclic. The analysis confirms no circular imports exist across all 37 source files.
- Why: Circular dependencies cause initialization order bugs, make refactoring risky, and prevent tree-shaking. An acyclic graph is a strong architectural foundation.
- Confidence: HIGH

### [POSITIVE] Pure report functions enable easy testing
- File: `src/reports/daily.ts`, `src/reports/weekly.ts`, `src/reports/monthly.ts`, etc.
- What: Every report generator is a pure function: `(snapshot, config, computedMembers, ...) → string`. No side effects, no I/O, no mutation.
- Why: This makes reports trivially testable — provide inputs, assert on output string. It also means reports can be generated in any context (HTTP API, WhatsApp, tests) without setup.
- Confidence: HIGH

---

## Modules Reviewed

- `src/types/`: clean (pure type definitions, zero imports)
- `src/utils/logger.ts`: 1 LOW finding
- `src/utils/timezone.ts`: clean
- `src/utils/format.ts`: clean
- `src/utils/index.ts`: clean (re-export only)
- `src/runtime.ts`: 1 LOW finding
- `src/config.ts`: 1 MEDIUM finding (JSON.stringify comparison)
- `src/data/daily-fans.ts`: clean (pure arithmetic)
- `src/data/snapshot.ts`: 2 findings (HIGH reversed dep + MEDIUM mixed concerns)
- `src/db/database.ts`: clean (focused SQLite wrapper)
- `src/api/uma-moe.ts`: clean
- `src/api/server.ts`: clean
- `src/reports/compute.ts`: clean
- `src/reports/format.ts`: 1 MEDIUM finding (grab-bag)
- `src/reports/daily.ts` through `src/reports/analyze.ts`: clean (pure functions)
- `src/reports/combined.ts`: clean
- `src/reports/tier.ts`: 0 direct findings (but `computeTierData` location is flagged under alerts coupling)
- `src/alerts/alerts.ts`: 1 MEDIUM finding (cross-module coupling to reports/tier)
- `src/scheduler/scheduler.ts`: clean
- `src/scheduler/catchup.ts`: clean
- `src/scheduler/helpers.ts`: clean
- `src/whatsapp/access.ts`: clean
- `src/whatsapp/commands.ts`: clean
- `src/whatsapp/admin.ts`: clean
- `src/whatsapp/client.ts`: 1 HIGH finding (god module)
- `src/whatsapp/dispatch.ts`: 1 HIGH finding (duplicated dispatch)
- `src/orchestrator/report-orchestrator.ts`: 2 findings (HIGH duplicated dispatch + MEDIUM duplicated alert delivery)
- `src/index.ts`: 3 findings (MEDIUM offset duplication, MEDIUM JSON.stringify, POSITIVE composition root)

---

## Low-Confidence Notes

- [src/whatsapp/client.ts:52-68] The `console.error` monkey-patch for libsignal suppression is global and permanent. If Baileys is ever upgraded and the suppressed patterns change, this could silently mask real errors. Recommend wrapping in a flag that can be disabled at runtime.
- [src/scheduler/scheduler.ts:236-306] The collision detection logic in the weekly/monthly handlers is complex with nested conditionals. I suspect the collision resolution could be unified into a single pre-computation step at `start()` time rather than computed inside each cron callback, but this needs more analysis.
- [src/reports/monthly.ts:55] `loadMonthSnapshots` is called directly inside a report generator, making it do I/O. All other report generators are pure. This is a minor inconsistency — the monthly report can silently use different data than what was passed in if snapshots changed between computation and report generation.
