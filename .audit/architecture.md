# Architecture Map: Uma Club Bot v3

> Generated: 2026-06-24
> Scope: Full codebase (`src/` — 40 TypeScript files, 7,883 lines)

---

## 1. Entry Points and How They Connect

### Primary Entry Point
- **`src/index.ts`** (354 lines) — Composition root. Wires all modules together and orchestrates startup.
  - `main()` is the only async entry function, called at the bottom of the file
  - Writes PID to `data/bot.pid` for stop script
  - Registers global error handlers (`unhandledRejection`, `uncaughtException`)

### Secondary Entry Points
- **`src/whatsapp/dispatch.ts:setupCommandHandler()`** — Registers as WhatsApp message handler; all user interaction flows through here.
- **`src/api/server.ts:ApiServer.start()`** — HTTP API on `127.0.0.1:3000`; external consumers hit this.
- **`src/scheduler/scheduler.ts:Scheduler.start()`** — Cron-based auto-delivery; triggers report generation on schedule.
- **`src/config.ts:loadConfig()`** — Called by entry point and config watcher; validates YAML → BotConfig.

### Startup Sequence (verified in `src/index.ts:76-348`)
```
1. Load config + init DB                    (lines 87-92)
2. Watch config.yaml for changes            (lines 98-191)
3. Create WhatsApp client (not connected)   (line 116)
4. Create ReportOrchestrator                (line 119)
5. Register command dispatch                (lines 121-124)
6. Fetch fresh data if stale                (lines 194-226)
7. Pre-fetch previous 2 months              (lines 228-239)
8. Update member history + rank history     (lines 241-255)
9. Start HTTP API server                    (lines 257-265)
10. Start scheduler                         (lines 279-302)
11. Connect WhatsApp (non-blocking)         (lines 306-333)
12. After WA connects → catch-up → normal   (lines 306-329)
13. Graceful shutdown on SIGINT/SIGTERM     (lines 336-346)
```

---

## 2. Main Modules/Components and Their Responsibilities

### Core Infrastructure

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **Entry** | `src/index.ts` | 354 | Composition root, startup orchestration, config watcher, graceful shutdown |
| **Config** | `src/config.ts` | 229 | YAML loading, Zod validation, immutable updates, atomic save |
| **Types** | `src/types/index.ts` | 334 | All shared TypeScript interfaces, type definitions, constants |
| **Runtime** | `src/runtime.ts` | 93 | Module-level mutable state for uptime, reconnects, message counts |
| **Logger** | `src/utils/logger.ts` | 262 | Structured logging with file rotation, configurable timezone |
| **Timezone** | `src/utils/timezone.ts` | 173 | JST data timezone + WIB display timezone via Intl API |
| **Format** | `src/utils/format.ts` | 128 | Pure string utilities: formatNumber, sanitizeName, splitMessage |

### Data Layer

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **Snapshot** | `src/data/snapshot.ts` | 278 | Immutable JSON save/load/path management (`data/snapshots/YYYY/MM/DD.json`) |
| **Ensure Snapshot** | `src/data/ensure-snapshot.ts` | 66 | Cache-or-fetch for month snapshots (bridges data ↔ API) |
| **Daily Fans** | `src/data/daily-fans.ts` | 313 | Core arithmetic on the 32-element `daily_fans` array |
| **Member History** | `src/data/member-history.ts` | 103 | Track member join/leave by diffing snapshots against DB |
| **Database** | `src/db/database.ts` | 482 | SQLite via sql.js: settings, schedule_runs, alert_events, member_history, rank_history |

### API Layer

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **UmaMoe Client** | `src/api/uma-moe.ts` | 137 | Playwright-based HTTP client for uma.moe (Turnstile bypass) |
| **API Server** | `src/api/server.ts` | 374 | REST API on localhost: reports, members, tier, snapshots, groups, chats |

### Report Engine

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **Compute** | `src/reports/compute.ts` | 173 | Transform raw snapshots → ComputedMember[] with gains, status, weekly breakdowns |
| **Registry** | `src/reports/registry.ts` | 43 | Type string → generator function mapping (single source of truth) |
| **Format (reports)** | `src/reports/format.ts` | 86 | Shared report helpers: stale warnings, date strings, footer, data line |
| **Daily** | `src/reports/daily.ts` | 150 | Daily performance summary |
| **Weekly** | `src/reports/weekly.ts` | 173 | Weekly performance summary |
| **Monthly** | `src/reports/monthly.ts` | 190 | Monthly performance summary |
| **Ranks** | `src/reports/ranks.ts` | 65 | Top 10 leaderboard |
| **Bottom** | `src/reports/bottom.ts` | 103 | Members needing attention |
| **Stats** | `src/reports/stats.ts` | 170 | Club-wide statistics |
| **Members** | `src/reports/members.ts` | 89 | Full member listing |
| **Tier** | `src/reports/tier.ts` | 79 | Tier promotion/demotion intelligence |
| **Compare** | `src/reports/compare.ts` | 113 | Side-by-side member comparison |
| **Analyze** | `src/reports/analyze.ts` | 115 | Deep single-member analysis |
| **Combined** | `src/reports/combined.ts` | 47 | Multi-type combined report (collision days) |

### Orchestration

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **Report Orchestrator** | `src/orchestrator/report-orchestrator.ts` | 315 | Full report pipeline: alignment, pre-fetch, generation, delivery, alerts |

### Scheduler

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **Scheduler** | `src/scheduler/scheduler.ts` | 321 | Cron-based auto-delivery with collision detection |
| **CatchUp** | `src/scheduler/catchup.ts` | 291 | Detect missed reports on restart, send catch-up reports |
| **Helpers** | `src/scheduler/helpers.ts` | 52 | `isScheduledToday`, `getCollidingTypes`, `groupByCollision` |

### WhatsApp

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **Client** | `src/whatsapp/client.ts` | 635 | Baileys connection lifecycle, QR auth, reconnection, message sending |
| **Dispatch** | `src/whatsapp/dispatch.ts` | 466 | Command routing: parse → access control → generate → send |
| **Commands** | `src/whatsapp/commands.ts` | 192 | Command parser + Levenshtein member name resolution |
| **Admin** | `src/whatsapp/admin.ts` | 234 | Admin command handlers: /setreq, /config, /status, /catchup, /alerts |
| **Access** | `src/whatsapp/access.ts` | 96 | Access control: admin vs command group vs announcement group |

### Alerts

| Module | Path | Lines | Purpose |
|--------|------|-------|---------|
| **Alerts** | `src/alerts/alerts.ts` | 333 | Detection (5 types), dedup via DB, formatting, quiet hours, catch-up aggregation |

---

## 3. Data Flow Through the System

### Inbound: Data Acquisition

```
uma.moe API
    │
    ▼
UmaMoeClient.fetchCircleData()     ← src/api/uma-moe.ts:77
    │  (Playwright → Turnstile → same-origin fetch)
    ▼
saveSnapshot()                     ← src/data/snapshot.ts:52
    │
    ▼
data/snapshots/YYYY/MM/DD.json    (immutable after save)
```

**Triggers:**
- On startup if snapshot is stale (`src/index.ts:194-226`)
- On scheduled data fetch (`src/scheduler/scheduler.ts:158-169`)
- On-demand via `npm run fetch`
- On report request with month mismatch (`src/orchestrator/report-orchestrator.ts:104-143`)

### Outbound: Report Delivery

```
Snapshot (JSON)
    │
    ▼
computeMembers()                   ← src/reports/compute.ts:33
    │  (daily_fans[] → ComputedMember[])
    │  Called ONCE per pipeline by orchestrator or dispatch
    ▼
generateReportString()             ← src/reports/registry.ts:25
    │  (registry dispatches to daily/weekly/monthly/etc.)
    ▼
ReportOrchestrator.deliverReport() ← src/orchestrator/report-orchestrator.ts:49
    │
    ▼
WhatsAppClient.sendMessage()       ← src/whatsapp/client.ts:471
    │  (splits at newline boundaries)
    ▼
Announcement Groups (WhatsApp)
```

### Alert Flow

```
ComputedMember[] + Snapshot + Config
    │
    ▼
detectAlerts()                     ← src/alerts/alerts.ts:43
    │  (5 types: performance_drop, demotion_risk, streak_break, new_transfer, rank_drop)
    ▼
db.recordAlert()                   ← dedup via event_key uniqueness
    │
    ▼
formatAlerts() / aggregateAlerts() ← src/alerts/alerts.ts:229, 285
    │
    ▼
WhatsApp → Admin JIDs or alertAdmin groups
```

### Command Flow (WhatsApp → Report)

```
WhatsApp message
    │
    ▼
WhatsAppClient.onMessage()         ← src/whatsapp/client.ts:298
    │
    ▼
setupCommandHandler()              ← src/whatsapp/dispatch.ts:68
    │
    ▼
parseCommand()                     ← src/whatsapp/commands.ts:73
    │
    ▼
canUseCommand()                    ← src/whatsapp/access.ts:59
    │  (admin check, group check, command type check)
    ▼
dispatchMessage()                  ← src/whatsapp/dispatch.ts:102
    ├─► ping/help/admin reference commands
    ├─► handleReportCommand()       (daily/weekly/monthly/ranks/bottom/stats/members/tier/compare/analyze)
    └─► handleAdminCommand()        (setreq/config/status/catchup/alerts/debug)
```

---

## 4. External Dependencies (APIs, Databases, Services)

### External APIs
| Service | Protocol | Purpose | Client |
|---------|----------|---------|--------|
| **uma.moe** | HTTPS (via Playwright browser context) | Circle data, member stats, tier thresholds | `src/api/uma-moe.ts` |
| **WhatsApp Web** | WebSocket (via Baileys library) | Message sending, group management | `src/whatsapp/client.ts` |

### Data Stores
| Store | Technology | Path | Purpose |
|-------|-----------|------|---------|
| **Snapshots** | JSON files | `data/snapshots/YYYY/MM/DD.json` | Immutable daily data snapshots |
| **Database** | SQLite via sql.js (WASM) | `data/bot.db` | Schedule runs, alert dedup, member history, rank history |
| **Config** | YAML | `config.yaml` | All bot configuration (hot-reloaded every 5s) |
| **WA Session** | Multi-file auth state | `data/auth/` | WhatsApp connection persistence |
| **Logs** | Rotating text files | `data/logs/bot.log` | Application logs (5MB, 3 rotated files) |

### Runtime Dependencies (from `package.json`)
| Package | Version | Purpose |
|---------|---------|---------|
| `@whiskeysockets/baileys` | ^7.0.0-rc13 | WhatsApp Web multi-device API |
| `node-cron` | ^3.0.3 | Cron-based scheduling |
| `playwright` | ^1.52.0 | Browser automation for uma.moe Turnstile bypass |
| `sql.js` | ^1.12.0 | In-memory SQLite (WASM, no native deps) |
| `yaml` | ^2.7.1 | YAML parsing and serialization |
| `zod` | ^3.25.67 | Runtime schema validation for config |
| `pino` | ^9.6.0 | Listed but NOT used in production code (custom logger instead) |
| `qrcode-terminal` | ^0.12.0 | QR code display in terminal for WhatsApp auth |

### Dev Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.8.3 | TypeScript compiler (ES2022 target, CommonJS) |
| `jest` | ^29.7.0 | Test framework |
| `ts-jest` | ^29.3.4 | TypeScript support for Jest |
| `ts-node-dev` | ^2.0.0 | Hot-reload dev server |

---

## 5. Configuration and Environment Handling

### Configuration Loading
- **File:** `config.yaml` (gitignored, copied from `config.example.yaml`)
- **Schema:** Zod validation at load time (`src/config.ts:26-122`)
- **Hot-reload:** Polling every 5s via mtime + content hash (`src/index.ts:129-191`)
- **Persistence:** Atomic write via temp file + rename (`src/config.ts:213-229`)
- **Updates:** Immutable — `updateConfig()` returns new validated object (`src/config.ts:198-201`)

### Environment Variables
| Variable | Default | Source |
|----------|---------|--------|
| `API_PORT` | `3000` | `.env` or shell |
| `API_TOKEN` | *(none)* | `.env` or shell — bearer token for API auth |
| `WA_SESSION_DIR` | `data/auth` | `.env` or shell — WhatsApp session directory |
| `NODE_ENV` | `production` | Dockerfile, PM2 ecosystem |

### Config Sections
| Section | Key Fields | Hot-reload behavior |
|---------|-----------|---------------------|
| `circleId` | Required | In-memory update |
| `admins` | WhatsApp JIDs | In-memory update |
| `groups` | command, announcement, alertAdmin JIDs | In-memory update |
| `requirements` | monthlyFans, weeklyFans | In-memory update |
| `schedule` | daily/weekly/monthly times | **Scheduler restart** |
| `catchUp` | enabled, maxReportsPerStartup | In-memory update |
| `alerts` | 5 alert types, quietHours | In-memory update |
| `memberStatus` | stale thresholds | In-memory update |
| `message` | maxLength, splitAtNewline, language | In-memory update |
| `logging` | level, logFile, rotation | In-memory update |

---

## 6. Key File List with Roles and Line Counts

### Source Files (7,883 lines total)

| File | Lines | Role |
|------|------:|------|
| `src/index.ts` | 354 | Entry point, composition root, startup orchestration |
| `src/config.ts` | 229 | YAML config + Zod validation + hot-reload + atomic save |
| `src/runtime.ts` | 93 | Runtime stats singleton (uptime, reconnects, messages) |
| `src/types/index.ts` | 334 | All shared interfaces, types, constants |
| `src/types/sql.js.d.ts` | 26 | Type declarations for sql.js and qrcode-terminal |
| **Data** | | |
| `src/data/daily-fans.ts` | 313 | Core arithmetic on 32-element daily_fans array |
| `src/data/snapshot.ts` | 278 | Snapshot save/load/path/stale-messaging |
| `src/data/ensure-snapshot.ts` | 66 | Cache-or-fetch bridge for month snapshots |
| `src/data/member-history.ts` | 103 | Member join/leave tracking via snapshot diffing |
| **Database** | | |
| `src/db/database.ts` | 482 | SQLite via sql.js: 5 tables, CRUD, auto-save |
| **API** | | |
| `src/api/uma-moe.ts` | 137 | Playwright-based uma.moe HTTP client |
| `src/api/server.ts` | 374 | REST API (localhost-only, rate-limited, bearer auth) |
| **Reports** | | |
| `src/reports/compute.ts` | 173 | Snapshot → ComputedMember[] (ghost detection, tier data) |
| `src/reports/registry.ts` | 43 | Type → generator mapping |
| `src/reports/format.ts` | 86 | Report-specific formatting helpers |
| `src/reports/daily.ts` | 150 | Daily report generator |
| `src/reports/weekly.ts` | 173 | Weekly report generator |
| `src/reports/monthly.ts` | 190 | Monthly report generator |
| `src/reports/ranks.ts` | 65 | Top 10 leaderboard |
| `src/reports/bottom.ts` | 103 | Members needing attention |
| `src/reports/stats.ts` | 170 | Club-wide statistics |
| `src/reports/members.ts` | 89 | Full member listing |
| `src/reports/tier.ts` | 79 | Tier intelligence |
| `src/reports/compare.ts` | 113 | Side-by-side member comparison |
| `src/reports/analyze.ts` | 115 | Deep single-member analysis |
| `src/reports/combined.ts` | 47 | Multi-type combined report |
| **Orchestration** | | |
| `src/orchestrator/report-orchestrator.ts` | 315 | Full report pipeline orchestration |
| **Scheduler** | | |
| `src/scheduler/scheduler.ts` | 321 | Cron-based auto-delivery + collision detection |
| `src/scheduler/catchup.ts` | 291 | Missed report detection + catch-up execution |
| `src/scheduler/helpers.ts` | 52 | Schedule utility functions |
| **WhatsApp** | | |
| `src/whatsapp/client.ts` | 635 | Baileys connection lifecycle, QR, reconnection, sending |
| `src/whatsapp/dispatch.ts` | 466 | Command routing: parse → access → generate → send |
| `src/whatsapp/commands.ts` | 192 | Command parser + Levenshtein name resolution |
| `src/whatsapp/admin.ts` | 234 | Admin command handlers |
| `src/whatsapp/access.ts` | 96 | Access control logic |
| **Alerts** | | |
| `src/alerts/alerts.ts` | 333 | 5-type alert detection, dedup, formatting, quiet hours |
| **Utils** | | |
| `src/utils/format.ts` | 128 | Pure string utilities (formatNumber, sanitizeName, splitMessage) |
| `src/utils/logger.ts` | 262 | Structured logger with file rotation |
| `src/utils/timezone.ts` | 173 | JST/WIB timezone conversion via Intl API |
| `src/utils/index.ts` | 1 | Re-exports timezone |

### Configuration Files

| File | Lines | Role |
|------|------:|------|
| `config.example.yaml` | 157 | Config template (all fields documented) |
| `tsconfig.json` | 20 | TypeScript: ES2022, CommonJS, strict mode |
| `package.json` | 60 | Dependencies, scripts, project metadata |
| `jest.config.js` | 23 | Jest: ts-jest preset, coverage thresholds |
| `ecosystem.config.js` | 21 | PM2: single instance, 500MB memory limit |
| `Dockerfile` | 54 | node:22-slim + Playwright chromium |
| `docker-compose.yml` | 21 | Volume mounts for config, data, auth |

### Tests (62 test files)

| Directory | File Count | Categories |
|-----------|-----------|------------|
| `tests/reports/` | 28 | unit, format, stale, edge, dispatch, regression, golden, e2e |
| `tests/data/` | 14 | daily-fans (12 files), snapshot, left-members |
| `tests/whatsapp/` | 7 | dispatch, commands, access, admin, client, regression, fuzz |
| `tests/api/` | 3 | server, server-auth, uma-moe |
| `tests/alerts/` | 2 | unit, regression |
| `tests/db/` | 2 | integration, regression |
| `tests/scheduler/` | 2 | unit, catchup regression |
| `tests/orchestrator/` | 1 | unit |
| `tests/utils/` | 2 | timezone, logger |
| `tests/` (root) | 1 | config.unit.test.ts |

---

## 7. Module Dependency Graph

### Legend
```
A → B  means "A imports from B"
```

### Core Dependencies

```
src/index.ts
  → config
  → types
  → db/database
  → api/uma-moe
  → api/server
  → scheduler/scheduler
  → scheduler/catchup
  → whatsapp/client
  → whatsapp/dispatch
  → data/snapshot
  → data/member-history
  → utils/timezone
  → utils/logger
  → runtime
  → reports/compute
  → orchestrator/report-orchestrator

src/config.ts
  → types
  → utils/logger

src/runtime.ts
  (no internal imports — standalone module)

src/types/index.ts
  (no internal imports — standalone module)
```

### Data Layer Dependencies

```
src/data/snapshot.ts
  → types
  → data/daily-fans
  → utils/timezone
  → utils/logger

src/data/ensure-snapshot.ts
  → api/uma-moe (type only)
  → types
  → data/snapshot
  → utils/timezone
  → utils/logger

src/data/daily-fans.ts
  → types (WEEK_BLOCKS constant)

src/data/member-history.ts
  → types
  → db/database
  → utils/timezone
  → utils/logger
```

### Report Layer Dependencies

```
src/reports/compute.ts
  → types
  → data/daily-fans
  → data/snapshot

src/reports/registry.ts
  → types
  → db/database
  → reports/daily, weekly, monthly, ranks, bottom, stats, members, tier

src/reports/format.ts
  → utils/timezone
  → types
  → data/daily-fans
  → data/snapshot

src/reports/daily.ts
  → types
  → db/database
  → data/snapshot
  → data/daily-fans
  → utils/format
  → reports/format

src/reports/weekly.ts
  → types
  → db/database
  → data/snapshot
  → data/daily-fans
  → utils/format
  → reports/format

src/reports/monthly.ts
  → types
  → db/database
  → data/snapshot
  → data/daily-fans
  → utils/format
  → reports/format
  → utils/timezone

src/reports/combined.ts
  → types
  → db/database
  → reports/daily, weekly, monthly

src/reports/ranks.ts → types, data/snapshot, utils/format, reports/format
src/reports/bottom.ts → types, db/database, data/snapshot, data/daily-fans, utils/format, reports/format
src/reports/stats.ts → types, db/database, data/snapshot, data/daily-fans, utils/format, reports/format
src/reports/members.ts → types, db/database, data/member-history, utils/format, reports/format
src/reports/tier.ts → types, db/database, data/snapshot, utils/format, reports/format, reports/compute
src/reports/compare.ts → types, data/snapshot, data/daily-fans, utils/format, reports/format
src/reports/analyze.ts → types, data/snapshot, data/daily-fans, utils/format, reports/format
```

### Scheduler Dependencies

```
src/scheduler/scheduler.ts
  → types
  → db/database
  → utils/timezone
  → utils/logger
  → scheduler/helpers

src/scheduler/catchup.ts
  → types
  → db/database
  → utils/timezone
  → utils/logger
  → scheduler/helpers

src/scheduler/helpers.ts
  → types
  → utils/logger
```

### WhatsApp Dependencies

```
src/whatsapp/client.ts
  → types
  → utils/logger
  → utils/format
  → runtime

src/whatsapp/dispatch.ts
  → types
  → db/database
  → whatsapp/client
  → whatsapp/commands
  → whatsapp/access
  → whatsapp/admin
  → reports/compute
  → reports/registry
  → reports/compare
  → reports/analyze
  → utils/logger
  → runtime
  → utils/timezone

src/whatsapp/commands.ts
  → types

src/whatsapp/admin.ts
  → types
  → config
  → utils/format

src/whatsapp/access.ts
  → types
```

### Orchestrator Dependencies

```
src/orchestrator/report-orchestrator.ts
  → types
  → db/database
  → api/uma-moe
  → whatsapp/client
  → alerts/alerts
  → data/snapshot
  → utils/timezone
  → reports/compute
  → reports/combined
  → reports/registry
  → utils/logger
```

### Alert Dependencies

```
src/alerts/alerts.ts
  → types
  → data/snapshot
  → reports/compute
  → utils/format
  → data/daily-fans
  → db/database
  → utils/timezone
  → utils/logger
```

### Utility Dependencies

```
src/utils/format.ts    (no internal imports)
src/utils/logger.ts    (no internal imports)
src/utils/timezone.ts  (no internal imports)
src/utils/index.ts     → utils/timezone
```

### Inverted Tree (who depends on what)

```
types          ← used by: ALL modules (18 consumers)
utils/logger   ← used by: 14 modules
utils/format   ← used by: 9 modules
utils/timezone ← used by: 11 modules
data/snapshot  ← used by: 8 modules
data/daily-fans← used by: 7 modules
db/database    ← used by: 9 modules
reports/compute← used by: 4 modules
config         ← used by: 2 modules (index, admin)
runtime        ← used by: 3 modules (index, client, dispatch)
```

---

## 8. Documented Design Decisions

These are intentional choices documented in `docs/architecture.md:390-418`. They have been reviewed and accepted. Do not flag these as issues.

### Rate limiter Map is unbounded (`api/server.ts:56`)
`requestTimestamps` Map is never pruned. Acceptable because API binds exclusively to `127.0.0.1` — at most 2 loopback entries.

### WA_SESSION_DIR is not path-sanitized (`whatsapp/client.ts:139`)
Env var used directly as filesystem path. Acceptable because the operator controls env vars — an attacker with env access already has process-level access.

### Security headers are minimal (`api/server.ts:32-34`)
Only `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store, no-cache`. HSTS and X-XSS-Protection omitted because API serves only JSON, binds to localhost.

### Runtime stats use module-level mutable state (`runtime.ts:21-39`)
Module-level singleton. Standard Node.js pattern for single-process apps. No reset mechanism needed.

### Logger uses synchronous file I/O (`utils/logger.ts:183,189`)
`appendFileSync` on every log line. Acceptable at current scale (~100 lines per report cycle).

### Catch-up persistence has a narrow window (`scheduler/catchup.ts:217-233`)
~10ms window between combined run save and individual record saves. Real-world risk is negligible.

### computeRollingAverage excludes zero-gain days (`data/daily-fans.ts:249`)
`gain > 0` filter is documented in JSDoc. Computes "average when active" not "average over time."

### Ghost detection edge case (`reports/compute.ts:90-104`)
Transfer members with low gain could theoretically be misclassified as "left" when `ghostCount` exceeds zero-gain + stale members. Requires `ghostCount > (zero-gain + stale)` to manifest — doesn't happen with real data.

### WhatsApp client is a large file (`whatsapp/client.ts`, 635 lines)
Connection lifecycle, QR auth, reconnection, heartbeat, message caching, and send logic are inherently coupled to Baileys' state machine. Splitting would increase cross-module coupling.

### Single-process architecture (`docs/architecture.md:3`)
No microservices, no cache layer. Data processing is arithmetic on ~34 integers. uma.moe data is static for 24h. Splitting adds operational friction without benefit.

### Snapshot immutability (`docs/architecture.md:49`)
Snapshots are never mutated after saving. Reports recompute from the `daily_fans` array each time. This ensures pure-function report generators.

### sql.js over sqlite3 (`docs/architecture.md:122`)
Pure WASM, no native compilation. Works in Docker without system deps. DB file is a binary blob loaded into memory.

### node-cron for scheduling (`docs/architecture.md:147`)
Simple, no external deps, works on all platforms. No need for a task queue in a single-process bot.

### Baileys for WhatsApp (`docs/architecture.md:170`)
Unofficial WhatsApp Web API. No official API available. Handles auth, reconnection, and message sending.

### Collision handling in scheduler (`docs/architecture.md:149`)
When daily + weekly are scheduled at the same time, only the daily handler fires. It detects the collision and sends a combined message.

### Config hot-reload via mtime + content hash (`docs/architecture.md:141`)
Avoids false triggers from editors that touch mtime without content changes.

### `ensureMonthSnapshot` extracted from `snapshot.ts` (`docs/architecture.md:116`)
Lives in `data/ensure-snapshot.ts` to avoid a data → api dependency. Bridges data layer and API layer.

---

## 9. Risk Signals (NOT documented as accepted)

> Items below are observations from code exploration. These are NOT flagged as issues — they are factual observations about the codebase.

### pino listed but unused
`pino` (^9.6.0) is in `package.json:40` dependencies but the project uses a custom logger (`src/utils/logger.ts`). Pino is never imported in any source file.

### `src/utils/index.ts` is a single re-export
`src/utils/index.ts:1` only re-exports `./timezone`. No consumers import from `utils/index.ts` directly — all imports target specific submodules.

### Baileys monkey-patching
`src/whatsapp/client.ts:52-69` suppresses `console.error` globally for libsignal noise. This affects the entire process, not just Baileys.

### No graceful shutdown for API server
`src/index.ts:336-346` cleans up scheduler, WhatsApp client, and database, but does not call `api.stop()`. The HTTP server is not explicitly closed.

### Database auto-save timer not cleaned up on error paths
`src/db/database.ts:47-49` sets an interval for auto-save. If `initialize()` throws partway through, the timer might not be set, but the error path doesn't explicitly clear it.

---

## 10. Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    Uma Club Bot v3 (7,883 LOC)                  │
│                    Single Node.js Process                        │
│                                                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ WhatsApp   │  │  HTTP API  │  │  Scheduler  │  │  Config  │  │
│  │ (Baileys)  │  │ (localhost)│  │ (node-cron) │  │  (YAML)  │  │
│  │ 635 LOC    │  │  374 LOC   │  │  664 LOC    │  │ 229 LOC  │  │
│  └─────┬──────┘  └─────┬──────┘  └──────┬──────┘  └────┬─────┘  │
│        │               │                │              │         │
│        └───────────────┴────────┬───────┴──────────────┘         │
│                                 │                                │
│                    ┌────────────▼────────────┐                   │
│                    │   Report Orchestrator   │                   │
│                    │        315 LOC          │                   │
│                    └────────────┬────────────┘                   │
│                                 │                                │
│         ┌───────────────────────┼───────────────────────┐        │
│         │                       │                       │        │
│   ┌─────▼─────┐  ┌─────────────▼─────────────┐  ┌──────▼─────┐ │
│   │  Reports   │  │       Data Layer          │  │   Alerts   │ │
│   │  1,433 LOC │  │  snapshot (278)           │  │  333 LOC   │ │
│   │ 12 types   │  │  daily-fans (313)         │  │ 5 types    │ │
│   │ registry   │  │  ensure-snapshot (66)     │  │ dedup+DB   │ │
│   │ compute    │  │  member-history (103)     │  │ quiet hrs  │ │
│   └────────────┘  └──────────────────────────┘  └────────────┘ │
│                                 │                                │
│                    ┌────────────▼────────────┐                   │
│                    │  SQLite (sql.js WASM)   │                   │
│                    │       482 LOC           │                   │
│                    │  5 tables, 30s auto-save│                   │
│                    └─────────────────────────┘                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Shared: types (334) │ utils (564) │ config (229)         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

External connections:
  • uma.moe ──(Playwright/Turnstile)──► circle data
  • WhatsApp Web ──(Baileys WebSocket)──► message delivery
  • SQLite file on disk ──(sql.js WASM)──► operational state
```
