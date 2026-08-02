# Architecture

## What This Bot Does

A WhatsApp bot for Uma Musume circle leaders. It tracks ~30 members' daily fan progress and sends automated reports — daily, weekly, monthly — so leaders don't have to manually check spreadsheets or mental math.

**Who it's for:** Circle leaders who need to know who's contributing, who's falling behind, and whether the club is promoting or demoting.

**What it replaces:** Manual tracking of member performance against requirements. Without this, a leader checks uma.moe once a day, screenshots the numbers, and mentally compares who's meeting the 20M monthly fan requirement. The bot does this automatically and sends the result to WhatsApp.

## The Core Insight

Everything revolves around one data structure: the `daily_fans` array. It's 32 cumulative integers — one per day of the month. Every report type (daily, weekly, monthly, ranks, bottom, stats) is different arithmetic on this same array.

This is not a coincidence. It's how uma.moe provides data. The API gives you one snapshot per day with cumulative fans. The bot's job is to turn that into every question a leader might ask: "Who gained the most today?" "Who's on track for the month?" "Who's about to get kicked?"

## Why Single Process

No microservices, no cache layer, no message queue. One Node.js process handles everything: WhatsApp (Baileys), HTTP API, cron scheduling, report generation.

Data processing is arithmetic on arrays of ~34 integers. uma.moe data is static for 24h. Splitting adds operational friction without benefit. The bot runs intermittently — it starts, catches up on missed reports, runs scheduled reports, and shuts down. A single process keeps this simple.

## Data Flow

```
uma.moe API → Snapshot (immutable JSON) → computeMembers() → Report → WhatsApp
```

1. **Fetch:** Playwright opens uma.moe, solves Cloudflare Turnstile, gets circle data.
2. **Snapshot:** Saved as `data/snapshots/YYYY/MM/DD.json`. Immutable once written — reports recompute from the array each time.
3. **Compute:** `computeMembers()` transforms raw `daily_fans` arrays into `ComputedMember` objects with gains, status, weekly breakdowns.
4. **Report:** 11 generator functions produce WhatsApp-formatted strings from computed members.
5. **Deliver:** Split at newline boundaries (WhatsApp 4096 char limit), send to announcement groups.

**When data is fetched:** On startup (if stale), on schedule (before daily report), on-demand (`npm run fetch`), on month mismatch.

## Startup Order

```
1. Load config + init DB
2. Watch config.yaml (polling every 5s)
3. Fetch fresh data if snapshot is stale
4. Pre-fetch previous 2 months
5. Update member history + rank history
6. Start HTTP API server (localhost only)
7. Start scheduler (cron tasks)
8. Connect WhatsApp (non-blocking)
   └── Once connected → run catch-up → start normal scheduling
```

**Why this order:**

- Config first — everything depends on it.
- Data before reports — can't generate without it.
- API before WhatsApp — independent, can start immediately.
- Scheduler before WhatsApp — handles WA-not-connected gracefully.
- WhatsApp last — needs QR scan on first run.
- Catch-up after WhatsApp — needs to send messages.

## Key Components

### Snapshot Store

Immutable JSON files at `data/snapshots/YYYY/MM/DD.json`. The `YYYY/MM/DD` path matches the data date (WIB), not the fetch date.

**Why immutable:** Reports are pure functions on the `daily_fans` array. Recomputing from the same data always produces the same result. Mutating saved data would break this invariant.

`ensureMonthSnapshot` (in `data/ensure-snapshot.ts`) fetches missing month data from uma.moe. It was extracted from `snapshot.ts` to fix a reversed dependency — the data layer should not depend on the API layer.

### Database

Operational state — schedule runs, alert dedup, member history, rank history. Pluggable via `IDatabase` interface: SQLite (default, zero-config) or MySQL/TiDB (production).

**Why pluggable:** Different deployments have different needs. SQLite works everywhere with no setup. MySQL/TiDB is better for multiple instances, external monitoring, existing infrastructure. The interface makes the switch transparent.

Tables: `schedule_runs`, `alert_events`, `member_history`, `rank_history`.

### Config

YAML with Zod validation. Hot-reloaded every 5 seconds via mtime polling.

**Why YAML:** Human-readable, supports comments. Better than JSON for a file that gets edited manually.

**Why Zod:** Type-safe validation at load time. Invalid config throws immediately with field-level errors instead of cryptic runtime crashes.

### Scheduler + Catch-Up

Cron-based auto-delivery using node-cron. When daily + weekly collide at the same time, they're combined into a single message.

**Why catch-up exists:** The bot runs intermittently. Without it, any report missed while offline is permanently lost. On restart, it detects missed reports by comparing last database run against most recent scheduled day, then sends them oldest-first.

### Alerts

Five alert types, each detecting a different problem:

- **Performance drop:** Today's gain < 50% of 7-day average
- **Demotion risk:** Club buffer < 3 days of current pace
- **Streak break:** Member's consecutive active days interrupted
- **New transfer:** Member joined from another club
- **Rank drop:** Club rank dropped > 10 positions

Deduplicated via database `event_key` uniqueness. Quiet hours suppress delivery but still record for dedup.

### WhatsApp Client + Command Dispatch

Baileys-based WhatsApp Web connection. Commands are parsed from incoming messages, access-controlled (admin vs command group), then routed to report generators or admin handlers.

**DispatchContext:** Groups related parameters (client, config, db, getSnapshot) into a context object. The `setupCommandHandler` public signature is unchanged — it creates the context internally per message.

### Report Engine

11 generator functions, each producing a WhatsApp-formatted string from computed members. 8 are registered in `reports/registry.ts`; `generateCompareReport` (compare), `generateAnalyzeReport` (analyze), and `generateCombinedReport` (combined) stay outside the registry — compare/analyze take extra member-name arguments and are dispatched directly from `whatsapp/dispatch.ts`, combined is a wrapper joining daily/weekly/monthly into one message.

`computeMembers()` is called once per pipeline and injected into generators, with two exceptions: historical-offset reports (`monthly`, `analyze`) recompute from their own snapshot via `loadHistoricalSnapshot()` in `reports/helpers.ts`, and the REST API computes per request (`api/server.ts`).

| Type     | What it computes                            |
| -------- | ------------------------------------------- |
| Daily    | Today's gain per member, ranked             |
| Weekly   | Week block gain, requirement check          |
| Monthly  | Month-to-date gain, projections             |
| Ranks    | Top 10 members                              |
| Bottom   | Members needing attention                   |
| Stats    | Club-wide statistics                        |
| Members  | Full member list                            |
| Tier     | Tier promotion/demotion analysis            |
| Compare  | Side-by-side member comparison              |
| Analyze  | Deep single-member analysis                 |
| Combined | Multi-type combined report (collision days) |

### REST API

Local HTTP API on `127.0.0.1:3000` for external access to reports and data. Binds to localhost only — security boundary. Optional bearer token auth via `API_TOKEN` env var.

## The daily_fans Array

```
Index:  0   1   2   3  ...  30  31
Day:    1   2   3   4  ...  31  (unused)
Value:  cumulative fans at end of each day
```

**Positive values:** Cumulative total fans at end of that day.
**Zero:** No data (member hasn't contributed or hasn't joined).
**Negative values:** Transfer indicator (member transferred from another club).

**Daily gain:** `daily_fans[today] - daily_fans[yesterday]`
**Weekly gain:** Sum of daily gains within the week block.
**Monthly gain:** `daily_fans[today] - daily_fans[0]` (or `abs()` for transfers).

Every report type is different arithmetic on this same array. The report engine never mutates it — only reads.

## Error Recovery

| Scenario               | Behavior                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| uma.moe API down       | Logs error, uses existing snapshots                              |
| WhatsApp disconnected  | Reports generated but not delivered; scheduler marks as `failed` |
| Config invalid         | Bot refuses to start with field-level error messages             |
| Database corrupted     | sql.js handles gracefully; reset with `npm run db:reset`         |
| Bot crashes mid-report | Scheduler marks run as `failed`; catch-up sends it on restart    |
| Token expired          | Auto-refreshes via Playwright (up to 3 retries)                  |

## Deployment

### PM2 (Recommended for Windows)

```bash
npm run pm2:install    # one-time: install PM2 + pm2-windows-startup
npm run pm2:start      # build + start as background service
npm run pm2:logs       # view logs
npm run pm2:stop       # stop the service
npm run pm2:restart    # rebuild + restart
```

Single instance (no clustering — the bot has WebSocket state). Auto-restart on crash. Memory limit: 400MB (safety net). Boot persistence via `pm2-windows-startup`.

### Docker

```bash
npm run build
docker build -t uma-club-bot .
docker run -d --name uma-bot \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config.yaml:/app/config.yaml" \
  --env-file .env \
  uma-club-bot
```

Volume mounts for session data (`data/auth/`), config, and snapshots. Health check hits `/health` every 30 seconds.

## Testing

Tests mirror `src/` structure. Categories: `*.unit.test.ts` (logic), `*.format.test.ts` (output), `*.dispatch.test.ts` (integration), `*.stale.test.ts` (stale data), `*.edge.test.ts` (boundary conditions). E2E validation via golden-file snapshots and 56 adversarial fuzz inputs.

Coverage thresholds: 70% branches, 80% functions/lines/statements.

## Design Decisions

The following are intentional. Do not flag these as issues in future reviews.

- **Rate limiter Map is unbounded** — API binds to `127.0.0.1` only, max 2 entries.
- **WA_SESSION_DIR not path-sanitized** — env var set by bot operator; attacker with env access already has process-level access.
- **Security headers minimal** — API serves only JSON, binds to localhost, no browser-rendered content.
- **Runtime stats use module-level mutable state** — standard Node.js singleton pattern for single-process apps.
- **Logger uses synchronous file I/O** — acceptable at current scale (~100 log lines per report cycle).
- **Catch-up persistence has narrow crash window** — ~10ms between saving combined run and individual records. Negligible risk.
- **computeRollingAverage excludes zero-gain days** — computes "average when active" not "average over time." Downstream thresholds should account for this.
- **Ghost detection edge case** — transfer members with low gain could theoretically be misclassified. Doesn't manifest with real data (34 members, ghostCount=4).
- **WhatsApp client is a large file** — connection lifecycle concerns are inherently coupled to Baileys' state machine. Splitting would increase cross-module coupling without reducing complexity.
