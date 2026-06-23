# Refactoring Plan: Maintainability Phase

**Date:** 2026-06-24
**Goal:** Improve day-to-day maintainability through targeted, safe refactors
**Context:** Post-audit remediation complete (7 bugs fixed, tests reorganized, helpers deduplicated, daily-fans split)

---

## Executive Summary

Analyzed 5 deferred audit findings across the codebase. Ranked by **maintenance impact × safety**:

| Rank | Task | Impact | Safety | Effort |
|:----:|------|:------:|:------:|:------:|
| 1 | `index.ts` catch-up deduplication | High | High | Small |
| 2 | `index.ts` configChanged → deep-equal | Low | High | Tiny |
| 3 | `reports/format.ts` re-export cleanup | Medium | High | Small |
| 4 | `snapshot.ts` DB extraction | Medium | Medium | Medium |
| 5 | `whatsapp/client.ts` decomposition | Medium | Low | Large |

**Recommendation:** Ship tasks 1-3 in a single PR. Leave 4-5 as future work unless day-to-day pain demands it.

---

## Task 1: Deduplicate catch-up alert delivery in index.ts

### Problem

`src/index.ts:297-341` implements catch-up logic that partially duplicates `ReportOrchestrator.sendReport()`. The catch-up callback (`sendReportCollectingAlerts`) manually constructs report options, calls `orchestrator.sendReport`, and collects alerts — logic that already exists in the orchestrator. The combined report catch-up callback (lines 318-331) also duplicates `orchestrator.generateCombinedReportString` + manual alert processing.

### Current Code

```typescript
// index.ts:309-316 — manual option construction
const sendReportCollectingAlerts = async (type: string, options?: { isCatchUp?: boolean }) => {
  const reportOptions = { ...options, collectAlerts: true };
  if (type === 'monthly') { reportOptions.offset = -1; }
  const alerts = await orchestrator.sendReport(type, reportOptions);
  allCatchUpAlerts.push(...alerts);
};
```

### Proposed Change

Move catch-up execution entirely into `CatchUpManager` or `ReportOrchestrator`. The orchestrator already has `sendReport` with `collectAlerts` support. The catch-up flow should be:

```typescript
// index.ts — simplified
const catchUp = new CatchUpManager(db, getConfig);
const result = await catchUp.executeCatchUp(
  (type, opts) => orchestrator.sendReport(type, { ...opts, isCatchUp: true, collectAlerts: true }),
  async (types) => orchestrator.sendCombinedCatchUp(types)
);
if (result.alerts.length > 0) {
  await orchestrator.deliverAlerts(result.alerts, true);
}
```

### Files Affected

| File | Change |
|------|--------|
| `src/index.ts` | Remove ~30 lines of catch-up glue code |
| `src/scheduler/catchup.ts` | Add `alerts` to return type of `executeCatchUp` |
| `src/orchestrator/report-orchestrator.ts` | Add `sendCombinedCatchUp()` method |

### Metrics

- **Lines saved:** ~30 lines from index.ts, ~10 added to orchestrator (net -20)
- **Callers affected:** 1 (index.ts catch-up block)
- **Test coverage:** `tests/scheduler/catchup-regression.test.ts`, `tests/orchestrator/report-orchestrator.unit.test.ts`
- **Risk:** Low — orchestrator already handles all this logic; we're just consolidating the call site

---

## Task 2: Replace JSON.stringify config comparison

### Problem

`src/index.ts:42-65` uses `JSON.stringify` to compare config objects. This is order-dependent (object key insertion order affects equality), fragile (arrays compared as strings), and verbose (12 lines of stringify comparisons).

### Current Code

```typescript
function configChanged(oldCfg: BotConfig, newCfg: BotConfig) {
  const scheduleChanged = (
    oldCfg.schedule.daily.time !== newCfg.schedule.daily.time ||
    // ... 8 more field comparisons
    JSON.stringify(oldCfg.schedule.weekly.days) !== JSON.stringify(newCfg.schedule.weekly.days) ||
    // ...
  );
  const anyChanged = scheduleChanged ||
    JSON.stringify(oldCfg.groups) !== JSON.stringify(newCfg.groups) ||
    // ... 8 more stringify comparisons
  return { changed: anyChanged, scheduleChanged };
}
```

### Proposed Change

Use a simple deep-equal helper or structured comparison. Since this is config (small, well-known shape), a targeted field comparison is most explicit:

```typescript
function configChanged(oldCfg: BotConfig, newCfg: BotConfig) {
  const scheduleChanged = (
    oldCfg.schedule.daily.time !== newCfg.schedule.daily.time ||
    oldCfg.schedule.daily.enabled !== newCfg.schedule.daily.enabled ||
    oldCfg.schedule.weekly.time !== newCfg.schedule.weekly.time ||
    oldCfg.schedule.weekly.enabled !== newCfg.schedule.weekly.enabled ||
    !arraysEqual(oldCfg.schedule.weekly.days, newCfg.schedule.weekly.days) ||
    oldCfg.schedule.monthly.time !== newCfg.schedule.monthly.time ||
    oldCfg.schedule.monthly.enabled !== newCfg.schedule.monthly.enabled ||
    oldCfg.schedule.monthly.day !== newCfg.schedule.monthly.day
  );
  const anyChanged = scheduleChanged ||
    !deepEqual(oldCfg.groups, newCfg.groups) ||
    !deepEqual(oldCfg.admins, newCfg.admins) ||
    // ...
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b); // fine for config-size objects
}
```

### Files Affected

| File | Change |
|------|--------|
| `src/index.ts` | Replace configChanged function (~20 lines) |
| `src/utils/index.ts` | Add `deepEqual` and `arraysEqual` utilities |

### Metrics

- **Lines changed:** ~20 (net neutral, but more correct)
- **Callers affected:** 1 (config watcher in index.ts)
- **Test coverage:** `tests/config.unit.test.ts`
- **Risk:** Low — config comparison is only used for scheduler restart decisions

---

## Task 3: Clean up reports/format.ts re-exports

### Problem

`src/reports/format.ts` re-exports 4 symbols from other modules:
- `INDONESIAN_MONTHS`, `formatDateWIB` from `utils/timezone` (line 40)
- `splitMessage` from `utils/format` (line 135)

These re-exports exist for backward compatibility but create a confusing import graph. Callers importing from `reports/format` get symbols from 3 different modules. Non-report callers (`alerts.ts`, `admin.ts`) import `formatNumber` — a function that has nothing to do with reports specifically.

### Current Import Graph

```
reports/format.ts
  ├── exports formatNumber, sanitizeName, getStaleDataWarning, buildDateStr, buildFooter, buildDataLine
  ├── re-exports { INDONESIAN_MONTHS, formatDateWIB } from utils/timezone
  └── re-exports { splitMessage } from utils/format

alerts/alerts.ts     → imports formatNumber from reports/format
whatsapp/admin.ts    → imports formatNumber from reports/format
10 report files       → import various from reports/format
```

### Proposed Change

1. Move `formatNumber` to `utils/format.ts` (it's a pure number formatter, not report-specific)
2. Move `sanitizeName` to `utils/format.ts` (it's a string sanitizer)
3. Remove re-exports from `reports/format.ts` — callers import directly from source modules
4. `reports/format.ts` keeps only report-specific helpers: `getStaleDataWarning`, `buildDateStr`, `buildFooter`, `buildDataLine`

### Files Affected

| File | Change |
|------|--------|
| `src/utils/format.ts` | Add `formatNumber`, `sanitizeName` |
| `src/reports/format.ts` | Remove re-exports, update internal imports |
| `src/alerts/alerts.ts` | Change import to `utils/format` |
| `src/whatsapp/admin.ts` | Change import to `utils/format` |
| 10 report files | Update imports (same symbols, different path) |

### Metrics

- **Lines changed:** ~30 across 13 files (mostly import path updates)
- **Callers affected:** 12 (2 non-report + 10 report files)
- **Test coverage:** `tests/reports/formatters.unit.test.ts`, `tests/reports/formatters-regression.test.ts`
- **Risk:** Low — pure import path changes, no logic changes. TypeScript catches any missed references.

---

## Task 4: Extract DB operations from snapshot.ts

### Problem

`src/data/snapshot.ts` mixes two concerns:
1. **File I/O** — saveSnapshot, loadSnapshot, loadLatestSnapshot, loadMonthSnapshots, snapshotExists, getDataDayFromSnapshot, getLatestSnapshotDate, staleSnapshotMessage
2. **DB operations** — `updateMemberHistory` (lines 221-271), `getLeftMembers` (lines 284-297)

The `ensureMonthSnapshot` was already extracted to `ensure-snapshot.ts`, but the DB functions remain. This creates a hidden `data → db` dependency in a module that's primarily about file I/O.

### Current Dependency Chain

```
data/snapshot.ts
  ├── imports Database type from db/database (line 205)
  ├── exports updateMemberHistory (DB write)
  └── exports getLeftMembers (DB read)

Called by:
  ├── index.ts:235 — updateMemberHistory
  └── reports/members.ts:72 — getLeftMembers
```

### Proposed Change

Create `src/data/member-history.ts`:

```typescript
// src/data/member-history.ts
import type { Snapshot } from '../types';
import type { Database } from '../db/database';
import { getDataDate } from '../utils/timezone';
import { log } from '../utils/logger';

export function updateMemberHistory(snapshot: Snapshot, db: Database): void { ... }
export function getLeftMembers(snapshot: Snapshot, db: Database): MemberHistoryRow[] { ... }
```

Update imports in `index.ts` and `reports/members.ts`.

### Files Affected

| File | Change |
|------|--------|
| `src/data/member-history.ts` | New file (~80 lines) |
| `src/data/snapshot.ts` | Remove ~80 lines (updateMemberHistory + getLeftMembers) |
| `src/index.ts` | Change import path |
| `src/reports/members.ts` | Change import path |

### Metrics

- **Lines saved:** 0 (moved, not deleted) but cleaner module boundaries
- **Callers affected:** 2 (index.ts, reports/members.ts)
- **Test coverage:** `tests/data/snapshot.integration.test.ts`, `tests/data/left-members.unit.test.ts`
- **Risk:** Medium — no logic change, but creating new module requires updating imports and verifying test paths still work

---

## Task 5: Decompose whatsapp/client.ts (DEFERRED)

### Problem

`src/whatsapp/client.ts` is 635 lines with 8+ responsibilities. The `connect()` method alone is 270 lines (lines 196-465) handling:
- Dynamic imports
- Auth state setup
- Socket creation with callbacks
- Message normalization and logging
- Connection state machine with 5 disconnect reasons
- Reconnection with exponential backoff
- QR code display
- Heartbeat lifecycle

### Proposed Decomposition

```
whatsapp/
├── client.ts              # WhatsAppClient class (slimmed to ~200 lines)
├── baileys-logger.ts      # createBaileysLogger() + suppressLibsignalErrors() (~70 lines)
├── connection-handler.ts  # Connection state machine + reconnect logic (~150 lines)
└── message-handler.ts     # messages.upsert processing + normalization (~100 lines)
```

### Why Deferred

1. **Low test coverage for connect()** — `tests/whatsapp/client.test.ts` (504 lines) mocks Baileys entirely. The connection state machine is untested.
2. **High coupling** — `connect()` modifies `this.sock`, `this.connectionState`, `this.reconnectAttempts`, `this.messageCache`, `this.chats` all within nested closures. Extracting requires careful state management.
3. **Dynamic imports** — Baileys is dynamically imported inside `connect()`. This complicates extraction.
4. **Risk/reward** — The file is large but stable. The connection logic hasn't changed since the audit. Splitting it risks introducing bugs in the most critical path (WhatsApp connection).

### When to Revisit

- If connection-related bugs recur
- If Baileys upgrade requires touching connect() logic
- If a second developer needs to work on WhatsApp code simultaneously

---

## Import Graph Analysis

### Circular Imports

**None found.** The dependency graph is a clean DAG:

```
index.ts → orchestrator → reports → data/snapshot
         → scheduler → helpers
         → whatsapp/client
         → db/database
```

No module imports from a module that imports it back.

### Dead Exports

**`src/data/snapshot.ts`:**
- `staleSnapshotMessage` — only called in `index.ts:210` (startup error path). Not dead, but rarely exercised.
- `getLatestSnapshotDate` — only called in `index.ts:209`. Same.
- All other exports are actively imported.

**`src/reports/format.ts`:**
- All exports actively imported. No dead code.

### Functions That Do Too Much

| Function | File | Lines | Issue |
|----------|------|:-----:|-------|
| `WhatsAppClient.connect()` | `whatsapp/client.ts:196-465` | 270 | 6+ responsibilities in one method |
| `Scheduler.start()` | `scheduler/scheduler.ts:200-307` | 107 | 3 schedule setups with nested conditionals |
| `configChanged()` | `index.ts:42-65` | 23 | Verbose but focused — minor |

The scheduler `start()` method's complexity is already mitigated by `getCollidingTypes()` in `helpers.ts`. The remaining nesting is inherent to the 3-way collision logic (daily×weekly, daily×monthly, weekly×monthly).

---

## Dependency Graph

```
Task 3 (format.ts cleanup)
    │
    ├── No dependencies — can ship independently
    │
Task 2 (configChanged)
    │
    ├── No dependencies — can ship independently
    │
Task 1 (catch-up dedup)
    │
    ├── Depends on: orchestrator already working (it is)
    ├── Touches: index.ts, catchup.ts, report-orchestrator.ts
    │
Task 4 (snapshot DB extraction)
    │
    ├── No code dependencies, but logically follows Task 3
    ├── (Both clean up module boundaries)
    │
Task 5 (client decomposition)
    │
    └── No dependencies — fully independent, deferred
```

**Parallel-safe:** Tasks 1, 2, 3 are fully independent and can be developed in parallel.

---

## Recommended Batching

### PR 1: Quick Wins (Tasks 1 + 2 + 3) — **SHIP TOGETHER**

**Why together:** All three are small, low-risk, improve code clarity. The import path changes in Task 3 are mechanical and verify instantly via `tsc --noEmit`.

| Task | Lines Changed | Files Touched |
|------|:------------:|:-------------:|
| 1 — catch-up dedup | ~40 | 3 |
| 2 — configChanged | ~20 | 2 |
| 3 — format.ts cleanup | ~30 | 13 |
| **Total** | **~90** | **16** |

**Verification:**
```bash
npm run lint:check    # TypeScript compilation
npm test              # All 1580 tests pass
```

### PR 2: Module Boundary Cleanup (Task 4) — **SEPARATE**

**Why separate:** Creates a new file, changes import graph structure. Easier to review in isolation.

| Task | Lines Changed | Files Touched |
|------|:------------:|:-------------:|
| 4 — snapshot DB extraction | ~80 | 4 |

### Deferred: Task 5

No action needed. Document in codebase notes for future reference.

---

## What NOT to Refactor

1. **Scheduler collision logic** — Already well-extracted to `helpers.ts`. The nesting in `start()` is the minimum complexity for 3-way collision handling. Simplification would require a generic collision engine — over-engineering for 3 report types.

2. **Report generators** — Each is 100-200 lines, focused, well-tested. Splitting them further adds file count without reducing cognitive load.

3. **Database module** — 482 lines but entirely CRUD operations. Each method is small and focused. The SQL is the complexity, not the structure.

4. **`utils/timezone.ts`** — 173 lines of timezone helpers. Small, stable, well-tested. Leave it.

---

## Verification Checklist

After each PR:

- [ ] `npm run lint:check` — zero type errors
- [ ] `npm test` — all tests pass (currently 1580)
- [ ] `npm run build` — dist/ builds cleanly
- [ ] Manual: `npm run dev` starts without errors
- [ ] Manual: Send a command in WhatsApp, verify report generates
- [ ] Review: No new `any` types introduced
- [ ] Review: No new `require()` calls (all ESM imports)
