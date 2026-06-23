# Architecture Audit — Wave 1

**Scope:** Module boundaries, coupling, cohesion, separation of concerns, design patterns
**Files reviewed:** 16 source files (3,964 LOC total)

---

## Dependency Graph (verified)

```
types/ ──────────────────────────► (leaf — imported by all)
utils/ ─────────────────────────► (leaf — imported by many)
runtime.ts ─────────────────────► (leaf — whatsapp/client, whatsapp/dispatch, api/server, index)
config.ts ──────────────────────► types, utils/logger
data/daily-fans.ts ────────────► types
data/snapshot.ts ──────────────► types, daily-fans, utils/timezone, utils/logger
                                        ┌─────────────────────────┐
                                        │ type-only:              │
                                        │  api/uma-moe (UmaMoe)  │
                                        │  db/database (Database) │
                                        └─────────────────────────┘
api/uma-moe.ts ────────────────► types, utils/logger
api/server.ts ─────────────────► types, data/snapshot, reports/compute, reports/tier, utils/logger, runtime
db/database.ts ────────────────► types
reports/compute.ts ────────────► types, data/daily-fans, data/snapshot
reports/format.ts ─────────────► types, data/daily-fans, data/snapshot, utils/timezone
reports/tier.ts ───────────────► types, db/database, data/snapshot, reports/compute
reports/*.ts ──────────────────► types, db/database, data/snapshot, data/daily-fans, reports/compute
alerts/alerts.ts ──────────────► types, data/snapshot, reports/compute, reports/tier, reports/format,
                                 data/daily-fans, db/database, utils/timezone, utils/logger
whatsapp/client.ts ───────────► types, utils/logger, runtime
                                 └── DYNAMIC: reports/format (splitMessage)
whatsapp/dispatch.ts ──────────► types, db/database, whatsapp/client, whatsapp/commands,
                                 whatsapp/access, whatsapp/admin, reports/compute, utils/logger, runtime
                                 └── DYNAMIC: reports/daily, weekly, monthly, ranks, bottom,
                                              stats, members, tier, compare, analyze
whatsapp/access.ts ────────────► types
whatsapp/commands.ts ──────────► types (ComputedMember)
whatsapp/admin.ts ─────────────► types, config, reports/format
scheduler/scheduler.ts ────────► types, db/database, utils/timezone, utils/logger, helpers
scheduler/catchup.ts ──────────► types, db/database, utils/timezone, utils/logger, helpers
index.ts ──────────────────────► (imports everything)
```

### Circular Dependencies
**None detected.** `data/snapshot.ts → api/uma-moe.ts` is type-only (`import type { UmaMoeClient }`), and `UmaMoeClient` is received via dependency injection at call sites, not instantiated. No runtime cycle exists.

---

## Findings

### [HIGH] index.ts is a God Module — composition root with embedded business logic
**File:** src/index.ts:74–629 (555 lines of `main()` body)

**What:** `index.ts` serves as both the composition root (wiring modules together) and a business logic container. It defines 6 major functions inline within `main()`: `configChanged`, `deliverReport`, `deliverAlerts`, `alignSnapshotToMonth`, `generateReportString`, `processAlertsForReport`, and `sendReport`. The `sendReport` function alone (lines 364–414) contains month-alignment, stale-data pre-fetch, monthly offset logic, report generation dispatch, delivery, and alert processing.

**Why:** Business logic embedded in the entry point is untestable in isolation, invisible to the module graph, and impossible to reuse. The scheduler and catchup modules must re-implement or reach through `main()` to access report delivery logic. The catch-up code in `main()` (lines 549–601) contains 50+ lines of inline orchestration that duplicates patterns from the scheduler.

**How:** Extract the following into dedicated modules:
- `ReportDeliveryService` — `deliverReport()`, `deliverAlerts()` (currently lines 188–231)
- `ReportOrchestrator` — `sendReport()`, `alignSnapshotToMonth()`, `generateReportString()`, `processAlertsForReport()` (currently lines 238–413)
- `ConfigWatcher` — the `setInterval` polling block (currently lines 96–173)

Keep `main()` as a ~50-line composition root that instantiates and wires these services.

**Confidence:** HIGH

---

### [HIGH] Redundant `computeMembers()` calls per request — O(N) recomputation
**File:** src/alerts/alerts.ts:54, src/reports/daily.ts:37, src/api/server.ts:257

**What:** `computeMembers(snapshot, config)` is called independently by every consumer that needs member data: alert detection (alerts.ts:54), every report generator (daily.ts:37, weekly.ts:61, monthly.ts:60, ranks.ts:27, bottom.ts:31, stats.ts:31, members.ts:32, compare.ts:21, analyze.ts:25, tier.ts:11), the API server (server.ts:257,287,314), and dispatch.ts (lines 390, 411). For a scheduled report with alerts, the snapshot is computed at least 3 times (once in sendReport's generateReportString → daily, once in alerts → computeMembers, once in the report generator itself).

**Why:** `computeMembers` iterates all members, computes daily/weekly/monthly gains, classifies status, and runs ghost detection. With ~34 members, this is cheap today. But the architectural pattern means every new consumer must re-discover this function, and the "compute once, pass everywhere" convention is violated. If member count grows or computation becomes more complex (e.g., historical comparisons), this becomes a real performance issue.

**How:** Compute `ComputedMember[]` once in `sendReport()` or at the orchestrator level and pass it as a parameter to report generators and alert detection. Report generator signatures would change from `(snapshot, config, db)` to `(snapshot, config, computedMembers, db?)`.

**Confidence:** HIGH

---

### [MEDIUM] Combined report generation logic duplicated across scheduler and catch-up
**File:** src/index.ts:508–539, src/index.ts:566–580

**What:** The combined report callback (daily+weekly+monthly in one message) is implemented twice with near-identical switch statements. Lines 508–539 handle the scheduler path; lines 566–580 handle the catch-up path. Both contain:
```
switch (type) {
  case 'daily': parts.push(generateDailyReport(...)); break;
  case 'weekly': parts.push(generateWeeklyReport(...)); break;
  case 'monthly': parts.push(generateMonthlyReport(...)); break;
}
```

**Why:** DRY violation. If a new report type is added or the combined report logic changes, both sites must be updated. The catch-up path also lacks monthly offset handling that the scheduler path has (line 534 hardcodes `-1`).

**How:** Extract a shared `generateCombinedReport(types, snapshot, config, db)` function and use it from both the scheduler callback and catch-up callback.

**Confidence:** HIGH

---

### [MEDIUM] alerts.ts has widest coupling surface — 9 imports from 6 modules
**File:** src/alerts/alerts.ts:9–21

**What:** `alerts.ts` imports from: `types`, `data/snapshot`, `reports/compute`, `reports/tier`, `reports/format`, `data/daily-fans`, `db/database`, `utils/timezone`, `utils/logger`. This is the widest import surface of any module. It depends on both the data layer (`data/`) and the reports layer (`reports/`), crossing the pipeline boundary.

**Why:** The alert module is coupled to the compute pipeline (`reports/compute`, `reports/tier`) for member status and tier data. This means alerts cannot be tested without the full compute chain. It also creates a hidden dependency: changing `computeMembers` or `computeTierData` signatures breaks alert detection.

**How:** Accept pre-computed data as parameters instead of computing internally:
```typescript
// Current: alerts computes internally
export function detectAlerts(snapshot: Snapshot, config: BotConfig, db: Database): Alert[] {
  const members = computeMembers(snapshot, config);  // ← coupling
  const tierData = computeTierData(snapshot);          // ← coupling
}

// Proposed: receive computed data
export function detectAlerts(
  members: ComputedMember[],
  tierData: TierData,
  snapshot: Snapshot,
  config: BotConfig,
  db: Database
): Alert[]
```

**Confidence:** HIGH

---

### [MEDIUM] WhatsApp client crosses layer boundary — imports `splitMessage` from reports
**File:** src/whatsapp/client.ts:474

**What:** `WhatsAppClient.sendMessage()` dynamically imports `splitMessage` from `../reports/format`. The WhatsApp delivery layer depends on the reports formatting layer.

**Why:** This creates an inverted dependency: the delivery layer (bottom of the stack) depends on the presentation layer (middle of the stack). If `reports/format.ts` changes its export, the WhatsApp client breaks. It also makes the client harder to test in isolation.

**How:** `splitMessage` is a pure string utility (no domain logic). Move it to `utils/format.ts` or `utils/string.ts`, and have both `reports/format.ts` and `whatsapp/client.ts` import from there. Alternatively, accept a `splitter` function in the `WhatsAppClient` constructor.

**Confidence:** HIGH

---

### [MEDIUM] dispatch.ts dynamic imports are unjustified — no circular deps exist
**File:** src/whatsapp/dispatch.ts:349–419

**What:** The `generateReport` function in dispatch.ts uses `await import('../reports/daily')`, `await import('../reports/weekly')`, etc. for every report type. The comment on line 348 says "Dynamic imports to avoid circular dependencies and keep bundle size small."

**Why:** This is a CommonJS project (per tsconfig: `"module": "commonjs"`). Dynamic `import()` in CommonJS is transpiled to synchronous `require()` — it doesn't achieve lazy loading or bundle splitting. There are no circular dependencies between `dispatch.ts` and the report generators. Meanwhile, `index.ts` statically imports all the same generators (lines 28–35), making the dynamic imports in dispatch inconsistent and adding unnecessary complexity.

**How:** Replace with static imports at the top of dispatch.ts, matching the pattern used by index.ts. If circular dependency concerns arise in the future, the dependency graph should be refactored rather than masked with dynamic imports.

**Confidence:** HIGH

---

### [MEDIUM] API server uses setter injection — implicit initialization order
**File:** src/api/server.ts:63–72, src/index.ts:484–487

**What:** `ApiServer` requires 3 setter calls after construction to wire WhatsApp capabilities:
```typescript
api.setWhatsAppConnected(() => waClient.isConnected());
api.setWhatsAppGroups(() => waClient.getGroups());
api.setWhatsAppChats(() => waClient.getChats());
```

**Why:** The server object is usable but incomplete between construction and setter calls. If `start()` is called before setters, endpoints return wrong data (default `() => false` / `() => []`). There's no compile-time guarantee that setters were called.

**How:** Pass WhatsApp capabilities through the constructor or an options object:
```typescript
const api = new ApiServer(apiPort, getSnapshot, getConfig, {
  waConnected: () => waClient.isConnected(),
  waGroups: () => waClient.getGroups(),
  waChats: () => waClient.getChats(),
});
```
This makes dependencies explicit and the object fully initialized at construction.

**Confidence:** HIGH

---

### [MEDIUM] Config state is global mutable state managed through closures
**File:** src/index.ts:85,130,182

**What:** `config` is a `let` variable (line 85) that is captured by closure in `getConfig = () => config` (line 177). It is reassigned by: the config watcher (line 130), the command handler's config update callback (line 182). All consumers access the latest config through the closure.

**Why:** This pattern makes config state invisible — you can't trace which code path set the current config value. It's effectively global mutable state. The `configChanged()` function (lines 49–71) uses `JSON.stringify` for deep comparison, which is fragile (key order dependent, no undefined handling).

**How:** This is acceptable for a single-process app but should be acknowledged as a design trade-off. Consider wrapping in a `ConfigStore` class with explicit `get()` and `update()` methods, which would also encapsulate the deep comparison and change detection logic.

**Confidence:** MEDIUM

---

### [MEDIUM] `ensureMonthSnapshot` in data layer couples persistence to API client
**File:** src/data/snapshot.ts:390–426

**What:** `ensureMonthSnapshot` takes `UmaMoeClient` as a parameter and calls `umaMoe.fetchCircleData()` (line 413). This function lives in the data persistence layer but performs API fetching — a responsibility that belongs in the API or orchestration layer.

**Why:** The data layer (`data/snapshot.ts`) is supposed to handle snapshot persistence (save/load/path management). By adding fetch-or-cache logic, it gains a dependency on `api/uma-moe.ts` (even if type-only) and becomes responsible for both storage and retrieval. This blurs the layer boundary.

**How:** Move `ensureMonthSnapshot` to the orchestration layer (index.ts or a new `DataOrchestrator` module) where `UmaMoeClient` is already available. The data layer should only expose `loadMonthSnapshots` and `saveSnapshot`.

**Confidence:** HIGH

---

### [MEDIUM] `Database` passed as wide-interface dependency to all report generators
**File:** src/reports/daily.ts, src/reports/weekly.ts, etc.

**What:** All report generators accept `db?: Database` as a parameter, even though most don't use it directly. The full `Database` class exposes 15+ methods (schedule runs, alert events, member history, rank history, raw SQL). Reports only need `getLeftMembers()` from member history or `getRankHistory()` for rank data.

**Why:** This is Interface Segregation Principle violation. Report generators depend on the entire database interface when they only need 1–2 specific queries. Testing requires a full database mock even for reports that don't use it.

**How:** Create narrow interfaces/data access objects:
```typescript
interface MemberDataProvider { getLeftMembers(snapshot: Snapshot): MemberHistoryRow[] }
interface RankDataProvider { getRankHistory(circleId: number, days: number): RankHistoryRow[] }
```
Or pre-fetch the needed data and pass it directly (e.g., `leftMembers` as a parameter).

**Confidence:** MEDIUM

---

### [POSITIVE] No circular dependencies — type-only imports used correctly
**File:** src/data/snapshot.ts:13, src/data/snapshot.ts:206

**What:** `data/snapshot.ts` imports `UmaMoeClient` and `Database` using `import type`, meaning these are erased at compile time. The actual dependency is injected at call sites (`ensureMonthSnapshot(umaMoe, ...)` and `updateMemberHistory(snapshot, db)`).

**Why:** This is the correct pattern for avoiding circular dependencies while maintaining type safety. The data layer defines the interface (`UmaMoeClient` parameter type) without importing the implementation. This enables testing with mocks and prevents module initialization order issues.

**How:** This pattern should be documented as the project standard for cross-layer type references.

**Confidence:** HIGH

---

### [POSITIVE] Pipeline pattern is consistently applied across reports
**File:** src/reports/compute.ts, src/reports/daily.ts, src/reports/weekly.ts, etc.

**What:** All report generators follow the same pattern: `(snapshot, config, db?) → string`. The `computeMembers` function serves as the shared computation hub, transforming raw `Snapshot` into `ComputedMember[]`. Every report generator calls `computeMembers` then applies report-specific logic.

**Why:** Consistent pipeline pattern means new report types can be added by following the established template. The separation between computation (`compute.ts`) and formatting (each report file) is clean.

**How:** Document this as the standard report development pattern in a CONTRIBUTING guide.

**Confidence:** HIGH

---

### [POSITIVE] Dependency injection used consistently for config access
**File:** src/whatsapp/client.ts:149, src/scheduler/scheduler.ts:28, src/scheduler/catchup.ts:28

**What:** `WhatsAppClient`, `Scheduler`, and `CatchUpManager` all accept `getConfig: () => BotConfig` as a constructor parameter rather than importing config directly. This enables config hot-reload without module re-initialization.

**Why:** This pattern decouples consumers from config management. Each module reads the latest config lazily, so config changes propagate without restarting individual components.

**How:** This is a good pattern — continue applying it to new modules.

**Confidence:** HIGH

---

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | —      |
| HIGH     | 3     | warn   |
| MEDIUM   | 7     | info   |
| LOW      | 0     | —      |
| POSITIVE | 3     | good   |

**Verdict: REQUEST_CHANGES** — 3 HIGH issues should be addressed before the architecture stabilizes further.

### Priority Order
1. **index.ts god module** — Extract business logic into services. This is the highest-impact refactor.
2. **Redundant computeMembers** — Compute once, pass everywhere. Low effort, high consistency gain.
3. **Combined report duplication** — Extract shared function. Small change, eliminates a maintenance trap.

### Items Confirmed Safe (Not Issues)
- **Circular dependencies:** None exist. The `data/snapshot.ts → api/uma-moe.ts` path is type-only.
- **types/index.ts as hub:** 334 lines for a ~6K LOC project is acceptable. Splitting would create import churn without meaningful cohesion gains at this scale.
- **Config hot-reload polling:** Pragmatic choice for Windows. The 5s poll interval and readFileSync blocking are acceptable for a bot process.
- **Dynamic imports in WhatsAppClient:** client.ts:474 uses `await import('../reports/format')` for `splitMessage` — this IS a layer boundary violation (finding #5 above), but the dynamic import itself is fine (avoids circular if reports/format ever imported from whatsapp/).
