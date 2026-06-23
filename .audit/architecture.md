# Architecture Map: Uma Club Bot v3

> Generated from codebase exploration on 2026-06-23
> Scope: `src/` directory — all TypeScript source files

---

## 1. Entry Points

### Primary Entry Point
- **`src/index.ts`** (382 lines) — Composition root. Wires all modules together, starts services, handles config hot-reload, orchestrates startup sequence.
  - Startup order: config → DB → data fetch → API server → scheduler → WhatsApp connection → catch-up → graceful shutdown.

### HTTP API Entry Point
- **`src/api/server.ts`** (363 lines) — REST API server on `127.0.0.1:3000`. Endpoints: `/health`, `/reports/*`, `/members`, `/members/:id`, `/tier`, `/snapshots`, `/groups`, `/chats`. Binds localhost only (security).

### WhatsApp Entry Point
- **`src/whatsapp/client.ts`** (634 lines) — Baileys WebSocket connection. Handles QR auth, message receive/send, reconnection with exponential backoff, session persistence.

### Cron Entry Point
- **`src/scheduler/scheduler.ts`** (321 lines) — node-cron tasks for daily (22:05), weekly (22:05 on day 7/14/21/28), and monthly (22:12 on day 1) auto-delivery.

---

## 2. Main Modules/Components

### Entry/Composition (`src/index.ts`)
- Path: `src/`
- Purpose: Application bootstrap, dependency wiring, config hot-reload, startup orchestration
- Key files: `index.ts` (382 lines), `config.ts` (229 lines), `runtime.ts` (93 lines)
- Depends on: All modules (composition root)
- Depended on by: Nothing (terminal entry point)
- Risk signals: None — clean composition root pattern

### Types (`src/types/`)
- Path: `src/types/`
- Purpose: Shared TypeScript type definitions for all domain objects
- Key files: `index.ts` (334 lines), `sql.js.d.ts` (26 lines)
- Depends on: Nothing
- Depended on by: Every module
- Risk signals: None — pure type definitions

### Orchestrator (`src/orchestrator/`)
- Path: `src/orchestrator/`
- Purpose: Report pipeline — generation + delivery + alert processing as a unified flow
- Key files: `report-orchestrator.ts` (304 lines)
- Depends on: types, db, api/uma-moe, whatsapp/client, alerts, data/snapshot, utils/timezone, reports/compute, reports/combined, reports/daily, reports/weekly, reports/monthly, reports/ranks, reports/bottom, reports/stats, reports/members, reports/tier, utils/logger
- Depended on by: src/index.ts
- Risk signals: Central orchestrator — any bug here affects all report delivery

### API (`src/api/`)
- Path: `src/api/`
- Purpose: HTTP API server (localhost-only) and uma.moe data fetcher (Playwright-based)
- Key files: `server.ts` (363 lines), `uma-moe.ts` (137 lines)
- Depends on: types, data/snapshot, reports/compute, reports/tier, utils/logger, utils/format (re-exported via reports/format), runtime
- Depended on by: src/index.ts, orchestrator
- Risk signals: `uma-moe.ts` uses Playwright for Cloudflare bypass — fragile if uma.moe changes Turnstile; rate limiter is in-memory (resets on restart)

### Data (`src/data/`)
- Path: `src/data/`
- Purpose: Snapshot persistence (JSON files) and daily fan arithmetic (core data model)
- Key files: `snapshot.ts` (426 lines), `daily-fans.ts` (313 lines)
- Depends on: types, utils/timezone, api/uma-moe (for ensureMonthSnapshot), db/database (for updateMemberHistory), utils/logger
- Depended on by: reports/*, orchestrator, whatsapp/dispatch, alerts, api/server
- Risk signals: Snapshot immutability is critical — once saved, never mutated. `ensureMonthSnapshot` mixes data fetching with persistence.

### Database (`src/db/`)
- Path: `src/db/`
- Purpose: SQLite persistence via sql.js (WASM) for operational state (schedule runs, alerts, member history, rank history)
- Key files: `database.ts` (482 lines)
- Depends on: types, sql.js (external)
- Depended on by: src/index.ts, orchestrator, scheduler, alerts, reports/*, data/snapshot
- Risk signals: sql.js is in-memory with periodic file save — data loss possible on crash between saves (30s interval). No WAL mode.

### Reports (`src/reports/`)
- Path: `src/reports/`
- Purpose: All report generation (daily, weekly, monthly, ranks, bottom, stats, members, tier, compare, analyze, combined) and shared formatting
- Key files: `compute.ts` (107 lines), `format.ts` (135 lines), `daily.ts` (149 lines), `weekly.ts` (172 lines), `monthly.ts` (186 lines), `ranks.ts` (64 lines), `bottom.ts` (102 lines), `stats.ts` (169 lines), `members.ts` (88 lines), `tier.ts` (141 lines), `compare.ts` (112 lines), `analyze.ts` (114 lines), `combined.ts` (47 lines)
- Depends on: types, data/daily-fans, data/snapshot, utils/timezone, utils/format, db/database
- Depended on by: orchestrator, whatsapp/dispatch, api/server, alerts
- Risk signals: `compute.ts` ghost detection logic (member_count gap) is heuristic — may misclassify members. Each report function is pure (snapshot+config → string) which is good.

### Alerts (`src/alerts/`)
- Path: `src/alerts/`
- Purpose: Alert detection (performance drop, demotion risk, streak break, new transfer, rank drop), deduplication, formatting, and aggregation
- Key files: `alerts.ts` (333 lines)
- Depends on: types, data/snapshot, data/daily-fans, reports/tier, reports/format, db/database, utils/timezone, utils/logger
- Depended on by: orchestrator, src/index.ts
- Risk signals: Quiet hours alert suppression records alerts as "sent" to prevent re-firing — behavior may surprise users. Alert event_key uniqueness is the dedup mechanism.

### Scheduler (`src/scheduler/`)
- Path: `src/scheduler/`
- Purpose: Cron-based auto-delivery scheduling and catch-up missed report detection/execution
- Key files: `scheduler.ts` (321 lines), `catchup.ts` (287 lines), `helpers.ts` (52 lines)
- Depends on: types, db/database, utils/timezone, utils/logger
- Depended on by: src/index.ts
- Risk signals: Collision detection (daily+weekly on same day/time) is critical — sends combined message. `catchup.ts` uses `db.save()` after each report for crash recovery, but batch operations are not atomic.

### WhatsApp (`src/whatsapp/`)
- Path: `src/whatsapp/`
- Purpose: WhatsApp connection lifecycle, command parsing, dispatch routing, access control, admin command handlers
- Key files: `client.ts` (634 lines), `dispatch.ts` (491 lines), `commands.ts` (192 lines), `admin.ts` (234 lines), `access.ts` (96 lines)
- Depends on: types, config, db/database, reports/*, utils/format, utils/logger, runtime
- Depended on by: src/index.ts, orchestrator, api/server
- Risk signals: `client.ts` is largest file (634 lines) — connection management + message handling + reconnection + cache. libsignal error suppression monkey-patches `console.error`. Message cache (2000 entries) for retry recovery.

### Utils (`src/utils/`)
- Path: `src/utils/`
- Purpose: Shared utilities — logging, timezone conversion, string formatting
- Key files: `logger.ts` (262 lines), `timezone.ts` (143 lines), `format.ts` (87 lines), `index.ts` (1 line)
- Depends on: Nothing (leaf utilities)
- Depended on by: Every module
- Risk signals: None — pure utility functions. Logger has file rotation logic. Timezone uses `Intl.DateTimeFormat` (no hardcoded offsets).

---

## 3. Data Flow

### 3a. Data Ingestion Flow
```
uma.moe API → UmaMoeClient.fetchCircleData() [src/api/uma-moe.ts:77]
  → Playwright browser → page.evaluate(fetch) → HTTP GET
  → Snapshot JSON validated
  → saveSnapshot() [src/data/snapshot.ts:53] → data/snapshots/YYYY/MM/DD.json
  → updateMemberHistory() [src/data/snapshot.ts:222] → DB member_history table
  → db.saveRankHistory() [src/index.ts:236] → DB rank_history table
```

### 3b. Report Generation Flow (Command)
```
WhatsApp message → WhatsAppClient.messages.upsert [src/whatsapp/client.ts:297]
  → dispatchMessage() [src/whatsapp/dispatch.ts:108]
  → parseCommand() [src/whatsapp/commands.ts:73]
  → canUseCommand() [src/whatsapp/access.ts:59]
  → handleReportCommand() [src/whatsapp/dispatch.ts:230]
  → generateReport() [src/whatsapp/dispatch.ts:350]
    → computeMembers(snapshot, config) [src/reports/compute.ts:33]
    → generate*Report(snapshot, config, computedMembers, ...) [src/reports/*.ts]
  → client.sendOrEdit() [src/whatsapp/client.ts:495]
    → splitMessage() [src/utils/format.ts:22]
    → sock.sendMessage() [Baileys]
```

### 3c. Report Generation Flow (Scheduled)
```
node-cron fires → Scheduler.recordAndSend() [src/scheduler/scheduler.ts:50]
  → orchestrator.sendReport(type) [src/orchestrator/report-orchestrator.ts:255]
    → alignSnapshotToMonth() [src/orchestrator/report-orchestrator.ts:113]
    → computeMembers(snapshot, config) [src/reports/compute.ts:33]
    → generateReportString(type, ...) [src/orchestrator/report-orchestrator.ts:160]
    → deliverReport() [src/orchestrator/report-orchestrator.ts:58]
      → waClient.sendMessage() [src/whatsapp/client.ts:470]
    → processAlertsForReport() [src/orchestrator/report-orchestrator.ts:205]
      → detectAlerts() [src/alerts/alerts.ts:43]
      → db.recordAlert() [src/db/database.ts:234]
      → deliverAlerts() [src/orchestrator/report-orchestrator.ts:85]
```

### 3d. Catch-Up Flow
```
WhatsApp connects → waClient.connect().then() [src/index.ts:299]
  → CatchUpManager.detectMissedReports() [src/scheduler/catchup.ts:48]
    → db.getLastSuccessfulRun() for each type
    → Compare last run date vs scheduled date
  → CatchUpManager.executeCatchUp() [src/scheduler/catchup.ts:146]
    → groupByCollision() [src/scheduler/helpers.ts:33]
    → For each group: sendReport or onCombinedReport
    → Aggregate alerts → aggregateAlerts() [src/alerts/alerts.ts:285]
    → Send aggregated alerts to admin/group
```

### 3e. Config Hot-Reload Flow
```
setInterval (5s) [src/index.ts:120]
  → statSync(configPath) + readFileSync()
  → If mtime or content changed:
    → loadConfig() [src/config.ts:146]
    → configChanged() [src/index.ts:42] — deep comparison
    → log.configure() [src/utils/logger.ts:72]
    → scheduler.stop() + scheduler.start() [src/scheduler/scheduler.ts:312,200]
    → recordConfigReload() [src/runtime.ts:54]
```

### 3f. Alert Detection Flow
```
detectAlerts() [src/alerts/alerts.ts:43]
  → For each ComputedMember:
    → performance_drop: todayGain < avg7d * threshold
    → streak_break: had streak but todayGain == 0
    → new_transfer: member.isTransfer == true
  → For club:
    → demotion_risk: tierData.riskLevel == 'HIGH'
    → rank_drop: rank diff > config threshold
  → Quiet hours check → suppress if in range
  → Return Alert[] → deduplicated via db.isAlertAlreadySent()
```

---

## 4. External Dependencies

### APIs
| Service | Client | Method | Purpose |
|---------|--------|--------|---------|
| uma.moe | `src/api/uma-moe.ts` | Playwright browser → fetch | Circle member data (daily_fans arrays) |

### Databases
| Engine | File | Purpose |
|--------|------|---------|
| sql.js (WASM SQLite) | `data/bot.db` | Schedule runs, alert dedup, member history, rank history |
| JSON files | `data/snapshots/YYYY/MM/DD.json` | Immutable snapshot storage |

### WhatsApp
| Library | Purpose |
|---------|---------|
| @whiskeysockets/baileys | WhatsApp Web multi-device connection |

### Scheduling
| Library | Purpose |
|---------|---------|
| node-cron | Cron-based scheduled tasks |

### Browser Automation
| Library | Purpose |
|---------|---------|
| playwright | Chromium headless for Cloudflare Turnstile bypass on uma.moe |

### Configuration
| Library | Purpose |
|---------|---------|
| yaml | YAML config parsing |
| zod | Config schema validation |

### Logging
| Library | Purpose |
|---------|---------|
| pino | Listed in package.json but NOT used in src/ — custom logger at `src/utils/logger.ts` |

### Other
| Library | Purpose |
|---------|---------|
| qrcode-terminal | QR code display in terminal for WhatsApp auth |

---

## 5. Configuration and Environment Handling

### Config File
- **`config.yaml`** — YAML, validated with Zod at load time. Hot-reloaded every 5s via mtime polling.
- **`config.example.yaml`** (157 lines) — Template with all fields documented.
- **`src/config.ts`** (229 lines) — `loadConfig()`, `validateConfig()`, `updateConfig()`, `saveConfig()`, `getDefaultConfig()`.

### Environment Variables (`.env`)
| Variable | Default | Purpose |
|----------|---------|---------|
| `API_PORT` | `3000` | HTTP API server port |
| `WA_SESSION_DIR` | `data/auth` | WhatsApp session data directory |

### Auto-Generated Files
| File | Purpose |
|------|---------|
| `data/bot.pid` | PID file for stop script |
| `data/bot.db` | SQLite database (sql.js binary blob) |
| `data/snapshots/` | Snapshot JSON files |
| `data/auth/` | WhatsApp session data (Baileys multi-file auth) |
| `data/logs/bot.log` | Application logs with rotation |

### Deployment Options
- **PM2**: `ecosystem.config.js` — single instance, auto-restart, 500MB memory limit
- **Docker**: `Dockerfile` (55 lines) — Node 22 slim + Playwright chromium + system deps
- **Direct**: `npm run start` / `npm run dev` (ts-node) / `npm run dev:watch` (hot-reload)

---

## 6. Key File List

| File | Lines | Role |
|------|------:|------|
| `src/index.ts` | 382 | Composition root, startup, config watcher, graceful shutdown |
| `src/config.ts` | 229 | YAML loading, Zod validation, immutable updates, atomic save |
| `src/runtime.ts` | 93 | Runtime stats (uptime, reconnects, message counts) |
| `src/types/index.ts` | 334 | All shared TypeScript types and constants |
| `src/types/sql.js.d.ts` | 26 | Type declarations for sql.js and qrcode-terminal |
| `src/orchestrator/report-orchestrator.ts` | 304 | Report pipeline: generate → deliver → alert |
| `src/api/uma-moe.ts` | 137 | Playwright-based uma.moe API client |
| `src/api/server.ts` | 363 | HTTP REST API (localhost only) |
| `src/data/snapshot.ts` | 426 | Snapshot save/load/ensure + member history updates |
| `src/data/daily-fans.ts` | 313 | Core daily fan arithmetic (gains, averages, stale detection) |
| `src/db/database.ts` | 482 | SQLite via sql.js — all CRUD operations |
| `src/reports/compute.ts` | 107 | Shared member computation engine |
| `src/reports/format.ts` | 135 | Shared formatting helpers (numbers, dates, stale warnings) |
| `src/reports/daily.ts` | 149 | Daily report generator |
| `src/reports/weekly.ts` | 172 | Weekly report generator |
| `src/reports/monthly.ts` | 186 | Monthly report generator |
| `src/reports/ranks.ts` | 64 | Top 10 leaderboard report |
| `src/reports/bottom.ts` | 102 | Bottom performers report |
| `src/reports/stats.ts` | 169 | Aggregate statistics report |
| `src/reports/members.ts` | 88 | Full member listing report |
| `src/reports/tier.ts` | 141 | Tier intelligence report |
| `src/reports/compare.ts` | 112 | Two-member comparison report |
| `src/reports/analyze.ts` | 114 | Single member deep-dive report |
| `src/reports/combined.ts` | 47 | Combined multi-type report |
| `src/alerts/alerts.ts` | 333 | Alert detection, dedup, formatting, aggregation |
| `src/scheduler/scheduler.ts` | 321 | Cron scheduling with collision detection |
| `src/scheduler/catchup.ts` | 287 | Missed report detection and catch-up execution |
| `src/scheduler/helpers.ts` | 52 | Schedule helpers (collision detection, grouping) |
| `src/whatsapp/client.ts` | 634 | Baileys connection, message send/receive, reconnection |
| `src/whatsapp/dispatch.ts` | 491 | Command routing and report generation dispatch |
| `src/whatsapp/commands.ts` | 192 | Command parser and member name resolution |
| `src/whatsapp/admin.ts` | 234 | Admin command handlers (setreq, config, status, catchup, alerts) |
| `src/whatsapp/access.ts` | 96 | Access control (admin vs command group permissions) |
| `src/utils/logger.ts` | 262 | Structured logger with file rotation |
| `src/utils/timezone.ts` | 143 | Timezone utilities (JST data, WIB display) |
| `src/utils/format.ts` | 87 | Message splitting for WhatsApp limits |
| `src/utils/index.ts` | 1 | Re-exports timezone utilities |

**Total source lines:** ~6,400 (across 35 files)

---

## 7. Module Dependency Graph

```
src/types (leaf — no imports)
    ↑
    ├── src/utils/logger (leaf — only fs imports)
    ├── src/utils/timezone (leaf — no internal imports)
    ├── src/utils/format (leaf — no internal imports)
    │
    ├── src/data/daily-fans → types
    │
    ├── src/db/database → types
    │
    ├── src/config → types, utils/logger
    │
    ├── src/runtime (leaf — no internal imports)
    │
    ├── src/data/snapshot → types, data/daily-fans, utils/timezone, api/uma-moe, db/database, utils/logger
    │
    ├── src/reports/format → types, utils/timezone, data/daily-fans, data/snapshot, utils/format
    │
    ├── src/reports/compute → types, data/daily-fans, data/snapshot
    │
    ├── src/reports/daily → types, db/database, data/snapshot, data/daily-fans, reports/format
    ├── src/reports/weekly → types, db/database, data/snapshot, data/daily-fans, reports/format
    ├── src/reports/monthly → types, db/database, data/snapshot, data/daily-fans, reports/format, utils/timezone
    ├── src/reports/ranks → types, data/snapshot, reports/format
    ├── src/reports/bottom → types, db/database, data/snapshot, reports/format, data/daily-fans
    ├── src/reports/stats → types, db/database, data/snapshot, data/daily-fans, reports/format
    ├── src/reports/members → types, db/database, data/snapshot, reports/format
    ├── src/reports/tier → types, db/database, data/snapshot, reports/format
    ├── src/reports/compare → types, data/snapshot, reports/format, data/daily-fans
    ├── src/reports/analyze → types, data/snapshot, reports/format, data/daily-fans
    ├── src/reports/combined → types, db/database, reports/daily, reports/weekly, reports/monthly
    │
    ├── src/alerts/alerts → types, data/snapshot, data/daily-fans, reports/tier, reports/format, db/database, utils/timezone, utils/logger
    │
    ├── src/api/uma-moe → types, utils/logger (external: playwright)
    ├── src/api/server → types, data/snapshot, reports/compute, reports/tier, utils/logger, runtime, utils/format
    │
    ├── src/scheduler/helpers → types, utils/logger
    ├── src/scheduler/catchup → types, db/database, utils/timezone, utils/logger, scheduler/helpers
    ├── src/scheduler/scheduler → types, db/database, utils/timezone, utils/logger, scheduler/helpers
    │
    ├── src/whatsapp/access → types
    ├── src/whatsapp/commands → types
    ├── src/whatsapp/admin → types, config, reports/format
    ├── src/whatsapp/client → types, utils/format, utils/logger, runtime
    ├── src/whatsapp/dispatch → types, db/database, whatsapp/client, whatsapp/commands, whatsapp/access, whatsapp/admin, reports/*, utils/logger, runtime
    │
    ├── src/orchestrator/report-orchestrator → types, db/database, api/uma-moe, whatsapp/client, alerts/alerts, data/snapshot, utils/timezone, reports/compute, reports/combined, reports/*, utils/logger
    │
    └── src/index → ALL modules (composition root)
```

---

## 8. Observations

### Architecture Strengths
- **Clean composition root** — `index.ts` wires everything, no circular dependencies
- **Pure report functions** — each report is `(snapshot, config, computedMembers) → string`, easily testable
- **Immutable snapshots** — write-once JSON files, never mutated after save
- **Graceful degradation** — stale data fallback, catch-up on restart, reconnection with backoff

### Risk Signals
1. **`whatsapp/client.ts` (634 lines)** — largest file, handles connection + messaging + reconnection + cache + heartbeat. Could benefit from splitting.
2. **sql.js in-memory + periodic save** — 30s auto-save interval means up to 30s of data loss on crash. `catchup.ts` uses immediate `db.save()` after each report, but `scheduler.ts` does not.
3. **Playwright dependency for uma.moe** — Cloudflare Turnstile bypass is inherently fragile. Any Turnstile update could break data fetching.
4. **`pino` in package.json but unused** — `src/utils/logger.ts` is a custom implementation. pino is a dead dependency.
5. **Config watcher uses polling** (5s interval with mtime + content hash) — reliable on Windows but slightly wasteful.
6. **No rate limiting on WhatsApp message sending** — only the HTTP API has rate limiting.
7. **`computeMembers` ghost detection** — reclassifies bottom-N members as "left" based on member_count gap. This is a heuristic that could misclassify if member_count is stale.
8. **Combined reports use offset=-1 for monthly** — hardcoded in `combined.ts:42`, not configurable.
