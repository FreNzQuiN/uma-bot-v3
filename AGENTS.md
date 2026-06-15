# Uma Club Bot v3

> Read this at the start of every session. This is the single source of truth.

---

## What

A WhatsApp bot that helps Uma Musume club leaders manage their club. It tracks member performance, sends automated reports, and provides intelligence about tier promotion/demotion.

## Who

Club leaders managing 30+ members. They need to know who's contributing, who's falling behind, and whether the club is promoting or demoting.

## Where

- Data source: uma.moe (scrapes game data once daily at 22:00 WIB)
- Delivery: WhatsApp groups
- Storage: SQLite + snapshot files

---

## Architecture

Single Node.js service. One process handles everything: WhatsApp connection, HTTP API, scheduling, data processing.

**Why single service:** The "data processing" is arithmetic on arrays of 34 integers. Node.js handles this trivially. Splitting into multiple services adds deployment and debugging friction without benefit.

**Why no cache layer:** uma.moe data is static for 24 hours. One snapshot file per day serves all requests. No TTL, no invalidation, no stale logic needed.

---

## Data Model

The core data is a `daily_fans` array — 32 cumulative integers representing each day's total fans. One API response contains the entire month. Every command (daily, weekly, monthly, ranks, bottom, stats) is different arithmetic on this same array.

See `examples/snapshot-june-12.json` for a real snapshot.
See `docs/uma-moe-api.md` for the full API documentation.

---

## Intermittent Operation

The bot does NOT run 24/7. It may be on all day, off 2 days, on 1 day, off again.

This is the most important constraint. The system must:
- Detect which reports were missed while off
- Send catch-up reports on restart
- Preserve all data across restarts
- Recover full month data with one API fetch (because the array is cumulative)
- Handle month boundaries without losing previous month's data

---

## User Stories (55)

**MUST (31):** Daily/weekly/monthly reports, auto-delivery, transfer badges, tier intelligence (promotion/demotion tracking), performance drop alerts, demotion alerts, catch-up on restart, snapshot preservation, single-service deployment, admin controls, message splitting.

**SHOULD (21):** Member comparison/analysis, transfer impact, streaks, rolling averages, trend detection, club rankings, remaining alerts, configurable schedules/alerts, REST API, UX polish.

**COULD (3):** Tier band peers, rank movement history, rank drop alert.

**WON'T:** Cross-club comparison, multiple data sources, activity/shame tracking, career patterns, trainer profiles.

---

## Key Behaviors

**Reports:** All commands read the same snapshot file. Different arithmetic produces different reports. Loading message is edited in-place to the final report.

**Auto-delivery:** Daily at 22:05 WIB, weekly on days 7/14/21/28, monthly on day 1 at 22:12 WIB. On collision days (daily + weekly), a combined daily+weekly report is sent.

**Catch-up:** On restart, the bot checks which scheduled reports were missed, fetches data, and sends them tagged as `[catch-up]`. Can be disabled by admin.

**Tier intelligence:** Uses `fans_to_next_tier` and `fans_to_lower_tier` from the API. Calculates daily pace needed to promote. Flags demotion risk when buffer is less than 3 days of current pace.

**Alerts:** Performance drop (daily gain < 50% of 7-day average), demotion imminent (buffer < 3 days pace), streak break, new transfer, rank drop >10 positions.

---

## Access Control

- Admin commands: restricted to JIDs in config
- Report commands: restricted to command groups or admin
- Announcements: auto-delivery goes to announcement groups only

---

## Future

AI integration is architecturally ready (single Node.js, HTTP APIs, snapshot data) but not in v3 scope. Would use 9router or similar OpenAI-compatible endpoint.

---

## Files

- `plans/v3-spec.md` — Full specification (user stories, requirements, MoSCoW, data flow)
- `docs/game-context.md` — What Uma Musume is, how circles/fans/tiers work
- `docs/uma-moe-api.md` — uma.moe API documentation
- `examples/snapshot-june-12.json` — Real snapshot data (June 12, 2026)
