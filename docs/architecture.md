# Architecture

Single Node.js process. No microservices, no cache layer — one process handles WhatsApp (Baileys), HTTP API, cron scheduling, and report generation.

**Why:** Data processing is arithmetic on arrays of ~34 integers. uma.moe data is static for 24h. Splitting adds operational friction without benefit.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Uma Club Bot v3                        │
│                     (Node.js)                            │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ WhatsApp │  │   HTTP   │  │ Scheduler│  │  Data  │ │
│  │ (Baileys)│  │   API    │  │(node-cron│  │ Fetch  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │              │             │      │
│       └──────────────┴──────┬───────┴─────────────┘      │
│                             │                            │
│                    ┌────────▼────────┐                   │
│                    │   Report Engine │                   │
│                    │  (daily/weekly/ │                   │
│                    │   monthly/etc.) │                   │
│                    └────────┬────────┘                   │
│                             │                            │
│              ┌──────────────┼──────────────┐             │
│              │              │              │             │
│         ┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐       │
│         │Snapshot │  │  SQLite   │  │ Config  │       │
│         │  Store  │  │  (sql.js) │  │ (YAML)  │       │
│         └─────────┘  └───────────┘  └─────────┘       │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### Inbound: Data Acquisition

```
uma.moe API → UmaMoeClient → Snapshot (JSON) → data/snapshots/YYYY/MM/DD.json
```

1. **UmaMoeClient** fetches circle data from uma.moe using Playwright-harvested tokens.
2. Token auto-refreshes on 401/403 (up to 3 retries).
3. Response is saved as an immutable snapshot: `data/snapshots/YYYY/MM/DD.json`.
4. Snapshots are never mutated after saving — reports recompute from the array each time.

**When data is fetched:**
- On startup (if snapshot is stale: 2+ days behind current day)
- On scheduled data fetch (same cron as daily report, before report generation)
- On-demand via `npm run fetch`
- On report request with month mismatch (auto-fetches current month)

### Outbound: Report Delivery

```
Snapshot → computeMembers() → ReportOrchestrator → generateReport() → deliverReport() → WhatsApp → Announcement Group
```

1. **computeMembers** (in `reports/compute.ts`) is called once per report pipeline by the orchestrator or dispatch layer. It transforms raw `daily_fans` arrays into `ComputedMember` objects with monthlyGain, latestDailyGain, weeklyGains, status, etc.
2. **ReportOrchestrator** (in `orchestrator/report-orchestrator.ts`) orchestrates the full pipeline: snapshot alignment, month pre-fetch, report generation, delivery, and alert processing.
3. **generateReport** (e.g., `reports/daily.ts`) receives pre-computed members and generates report-specific data.
4. **deliverReport** sends the message to all configured announcement groups via Baileys, splitting at newline boundaries (configurable).
5. If delivery fails, the scheduler marks the run as `failed` in the database.

### Alerts

```
Snapshot → detectAlerts() → recordAlert() → formatAlerts() → WhatsApp → Admin/Group
```

1. **detectAlerts** (in `alerts/alerts.ts`) runs after each report delivery.
2. Checks: performance drop, demotion risk, streak break, new transfer, rank drop.
3. Alerts are deduplicated via the database (`event_key` uniqueness).
4. During catch-up, alerts are collected and aggregated into a single message.

---

## Startup Sequence

```
1. Load config + init DB
2. Watch config.yaml for changes (polling every 5s)
3. Fetch fresh data if snapshot is stale
4. Pre-fetch previous 2 months
5. Update member history + rank history
6. Start HTTP API server (localhost only)
7. Start scheduler (cron tasks)
8. Connect WhatsApp (non-blocking)
   └── Once connected → run catch-up → start normal scheduling
```

**Why this order:**
- Config must load first (everything depends on it).
- Data must be available before reports can generate.
- API server starts before WhatsApp because it's independent.
- Scheduler starts before WhatsApp because it handles WA-not-connected gracefully.
- WhatsApp connects last because it needs QR scan on first run.
- Catch-up runs after WhatsApp connects because it needs to send messages.

---

## Key Components

### Snapshot Store (`data/snapshot.ts`)

**What:** Immutable JSON files at `data/snapshots/YYYY/MM/DD.json`.

**Why immutable:** Reports are pure functions on the `daily_fans` array. Recomputing from the same data always produces the same result. Mutating saved data would break this invariant.

**Path convention:** `YYYY/MM/DD` matches the data date (WIB), not the fetch date.

### SQLite Database (`db/database.ts`)

**What:** Operational state — schedule runs, alert dedup, member history, rank history.

**Why sql.js:** Pure WASM, no native compilation needed. Works in Docker without system deps. DB file is a binary blob loaded entirely into memory.

**Tables:**
- `schedule_runs` — tracks every report send attempt (status: pending/sent/failed)
- `alert_events` — dedup for alerts (event_key uniqueness)
- `member_history` — tracks member presence across months
- `rank_history` — daily rank snapshots for trend analysis
- `settings` — key-value store for runtime settings

**Auto-save:** DB is written to disk every 30 seconds, plus on critical events (catch-up completion).

### Config (`config.ts`)

**What:** YAML configuration with Zod validation.

**Why YAML:** Human-readable, supports comments, familiar to most developers. Better than JSON for a config file that gets edited manually.

**Why Zod:** Type-safe validation at load time. Invalid config throws immediately with field-level errors instead of cryptic runtime crashes.

**Hot-reload mechanism:** Polls `config.yaml` mtime every 5 seconds. Compares both mtime AND content hash to avoid false triggers on mtime-only changes (e.g., editors that touch mtime without content changes).

### Scheduler (`scheduler/scheduler.ts`)

**What:** Cron-based auto-delivery using node-cron.

**Why node-cron:** Simple, no external deps, works on all platforms. No need for a full task queue — the bot is a single process.

**Collision detection:** When daily + weekly are scheduled at the same time on the same day, only the daily handler fires. It detects the collision and sends a combined message. This prevents duplicate messages.

**Duplicate prevention:** Before sending, the scheduler checks the database for the last successful run of that report type. If it was already sent today, it skips.

### Catch-Up Manager (`scheduler/catchup.ts`)

**What:** Detects missed reports on restart and sends them.

**How it works:**
1. For each report type, checks the last successful run in the database.
2. Compares against the most recent scheduled day (not just "today").
3. If the last run is before the most recent scheduled day, the report is "missed".
4. Missed reports are grouped by collision (same time → combined message).
5. Sent oldest-first, respecting `maxReportsPerStartup`.

**Why it's needed:** The bot runs intermittently. Without catch-up, any report missed while offline is permanently lost.

### WhatsApp Client (`whatsapp/client.ts`)

**What:** Baileys-based WhatsApp Web connection.

**Why Baileys:** Unofficial WhatsApp Web API. No official API available. Baileys handles auth, reconnection, and message sending.

**Key behaviors:**
- QR code shown in terminal on first run for authentication.
- Session data persists in `data/auth/` (or `WA_SESSION_DIR`).
- Auto-reconnects on network errors.
- Rejected only for `loggedOut`/`badSession` (requires user action).

### Command Dispatch (`whatsapp/dispatch.ts`)

**What:** Routes incoming WhatsApp messages to report generators or admin handlers.

**Flow:** Message → Parse command → Access control → Generate report → Send

Uses static imports for all report generators (no dynamic `import()` — no circular dependencies exist).

**Access control** (`whatsapp/access.ts`):
- Report commands → allowed in `command` groups or by admins.
- Admin commands → only admins, only in `command` groups or private chats.
- Unauthorized sources → silently ignored (no error message to non-admins in non-command groups).

### REST API (`api/server.ts`)

**What:** HTTP API on `127.0.0.1:3000` for external access to reports and data.

**Why localhost only:** Security — the API has no auth. Binding to `127.0.0.1` means only the machine itself can access it.

**Rate limiting:** 50 requests per second per IP. Returns 429 on excess.

**Response envelope:** All responses use `{ success, data, error, meta }` format.

See `docs/api-reference.md` for endpoint details.

### Report Engine (`reports/`)

**What:** Generates report strings from snapshot data.

**Core function:** `computeMembers()` in `reports/compute.ts` transforms raw `daily_fans` arrays into rich `ComputedMember` objects. This is called once per pipeline by the orchestrator/dispatch layer and injected into each report generator — never called internally by generators.

**Report types:**
| Type | File | What it computes |
|------|------|-----------------|
| Daily | `daily.ts` | Today's gain per member, ranked |
| Weekly | `weekly.ts` | Week block gain, requirement check |
| Monthly | `monthly.ts` | Month-to-date gain, projections |
| Ranks | `ranks.ts` | Top 10 members |
| Bottom | `bottom.ts` | Members needing attention |
| Stats | `stats.ts` | Club-wide statistics |
| Members | `members.ts` | Full member list |
| Tier | `tier.ts` | Tier promotion/demotion analysis |
| Compare | `compare.ts` | Side-by-side member comparison |
| Analyze | `analyze.ts` | Deep single-member analysis |
| Combined | `combined.ts` | Multi-type combined report (for collision days) |

### Report Orchestrator (`orchestrator/report-orchestrator.ts`)

**What:** Encapsulates the full report pipeline — generation, delivery, and alert processing.

**Why:** Extracted from `index.ts` to separate business logic from the composition root. The orchestrator owns: snapshot alignment (month-boundary and stale-data handling), month pre-fetch, report generation dispatch, message delivery to WhatsApp groups, and alert detection/recording/delivery.

**Dependencies:** `getConfig`, `getSnapshot`, `UmaMoeClient`, `Database`, `WhatsAppClient` — all injected via constructor.

### String Utilities (`utils/format.ts`)

**What:** Pure string formatting utilities with no domain logic.

**Key function:** `splitMessage()` — splits WhatsApp messages at newline boundaries with "Part X/Y" markers. Used by both `reports/format.ts` (re-exported for backward compatibility) and `whatsapp/client.ts` (static import).

---

## The daily_fans Array

Everything revolves around this 32-element integer array:

```
Index:  0   1   2   3  ...  30  31
Day:    1   2   3   4  ...  31  (unused)
Value:  cumulative fans at end of each day
```

**Positive values:** Cumulative total fans at end of that day.
**Zero:** No data (member hasn't contributed or hasn't joined).
**Negative values:** Transfer indicator (member transferred from another club).

**Daily gain calculation:**
```
day_gain = daily_fans[today] - daily_fans[yesterday]
```

**Weekly gain:** Sum of daily gains within the week block.
**Monthly gain:** `daily_fans[today] - daily_fans[0]` (or `abs()` for transfers).

Every report type is different arithmetic on this same array. The report engine never mutates it — only reads.

---

## Message Splitting

WhatsApp has a 4096-character limit. Long reports are split:

1. Try to split at a newline boundary near the limit.
2. If no newline found, split at the character limit.
3. Each part is sent as a separate message.
4. Splitting is configurable (`message.splitAtNewline`).

**Why newline boundaries:** Splitting mid-sentence or mid-table produces unreadable messages.

---

## Error Recovery

| Scenario | Behavior |
|----------|----------|
| uma.moe API down | Logs error, uses existing snapshots |
| WhatsApp disconnected | Reports generated but not delivered; scheduler marks as `failed` |
| Config invalid | Bot refuses to start with field-level error messages |
| Database corrupted | sql.js handles gracefully; can be reset with `npm run db:reset` |
| Bot crashes mid-report | Scheduler marks run as `failed`; catch-up sends it on restart |
| Token expired | Auto-refreshes via Playwright (up to 3 retries) |

---

## Testing Architecture

Tests mirror `src/` structure in `tests/`:

```
src/reports/daily.ts     →  tests/reports/daily/daily.unit.test.ts
src/reports/daily.ts     →  tests/reports/daily/daily.format.test.ts
src/reports/daily.ts     →  tests/reports/daily/daily.dispatch.test.ts
src/reports/daily.ts     →  tests/reports/daily/daily.stale.test.ts
src/reports/daily.ts     →  tests/reports/daily/daily.edge.test.ts
```

**Test categories:**
- `*.unit.test.ts` — Pure logic tests (data computation)
- `*.format.test.ts` — Output formatting tests
- `*.dispatch.test.ts` — Integration tests (command routing)
- `*.stale.test.ts` — Stale data handling
- `*.edge.test.ts` — Edge cases (empty data, transfers, month boundaries)

**Shared helpers** in `tests/_helpers/`:
- `snapshot-loader.ts` — Load real snapshot JSON fixtures
- `mock-date.ts` — Freeze time for deterministic tests
- `constants.ts` — Shared test constants

**Real fixtures** in `tests/examples/`:
- `snapshot-june-12.json` — Actual uma.moe snapshot data

---

## Deployment

### PM2 (Recommended for Windows)

PM2 runs the bot as a background service with auto-restart, crash recovery, and boot persistence.

```bash
npm run pm2:install    # one-time: install PM2 + pm2-windows-startup
npm run pm2:start      # build + start as background service
npm run pm2:logs       # view logs
npm run pm2:stop       # stop the service
npm run pm2:restart    # rebuild + restart
```

**ecosystem.config.js** configures:
- Single instance (no clustering — the bot has WebSocket state)
- Auto-restart on crash
- Memory limit: 500MB (safety net, not expected usage)
- Logs: `data/logs/pm2-error.log`, `data/logs/pm2-out.log`
- `NODE_ENV=production`

**Boot persistence:** `pm2-windows-startup` registers PM2 as a Windows service. The bot starts automatically on system boot.

**Save process list:** `pm2 save` is called automatically by `pm2:start`. This persists the process list so PM2 knows what to restart on boot.

### Docker

```bash
npm run build                    # compile TypeScript
docker build -t uma-club-bot .   # build image
docker run -d --name uma-bot \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config.yaml:/app/config.yaml" \
  --env-file .env \
  uma-club-bot
```

**Why volume mounts:** Session data (`data/auth/`) and config must persist across container restarts. Snapshots (`data/snapshots/`) are cached to avoid re-fetching.

**Health check:** Dockerfile includes a health check hitting `http://127.0.0.1:3000/health` every 30 seconds.

### Direct

```bash
npm install
npm run build
npm start
```

Uses `data/bot.pid` for process management (`npm run stop`).

**Limitation:** No auto-restart on crash. No boot persistence. The terminal must stay open. Use PM2 or Docker for production.
