# Uma Club Bot v4 — Product Specification

> WhatsApp bot for Uma Musume club leaders.
> This document defines product behavior, data interpretation, and user-facing contracts.
> It does not prescribe internal code structure or implementation details.

---

## 1. Product Summary

Uma Club Bot v4 helps Uma Musume club leaders manage member performance through WhatsApp.

The bot:

- Fetches club data from uma.moe
- Saves immutable daily snapshots
- Generates reports: daily, weekly, monthly, ranks, bottom, stats, members, tier, compare, analyze
- Sends reports manually through commands or automatically on schedule
- Recovers from downtime by detecting and sending missed reports
- Tracks tier promotion/demotion risk
- Alerts leaders about performance drops, demotion risk, streak breaks, transfers, and rank drops

Primary constraint:

> The bot may not run 24/7. It must recover correctly after being offline.

---

## 2. Users and Stories

Primary users are Uma Musume club leaders managing around 30 members.

They need to answer:

- Who contributed today?
- Who is below requirement?
- Who is inactive, stale, or falling behind?
- Is the club likely to promote, stay, or demote?
- What reports were missed while the bot was offline?
- What changed since yesterday?

Secondary users are club members who want visibility into club performance.

---

## 3. Data Model

### 3.1 Snapshot

A snapshot is one saved raw uma.moe response for a specific circle, year, month, and data day.

Path: `data/snapshots/YYYY/MM/DD.json`

Rules:

- Snapshots are immutable once saved
- Snapshots are the source of truth for historical reports
- Reports are derived from snapshots whenever possible
- Live API fetches happen only when the required snapshot is missing or fresh data is needed

A snapshot contains raw source data including: `circle`, `members`, `club_rank`, `fans_to_next_tier`, `fans_to_lower_tier`, `yesterday_fans_to_next_tier`, `yesterday_fans_to_lower_tier`.

### 3.2 `daily_fans`

Each member has a cumulative monthly fan array:

```json
"daily_fans": [number, number, ...]
```

Rules:

- 32-element array
- Index `0` = day 1 of the month, index `30` = day 31, index `31` = padding / unused
- Values are cumulative fan totals, not daily gains
- `value > 0` = usable cumulative value
- `0` = no usable data for that day
- Negative value = transfer-related historical marker, not negative performance

Example:

```text
daily_fans[9]  = cumulative fans at end of day 10
daily_fans[10] = cumulative fans at end of day 11
day 11 gain    = daily_fans[10] - daily_fans[9]
```

### 3.3 Latest Data Day

The latest usable data day for a snapshot is:

```text
latest index where at least one active member has daily_fans[index] > 0
```

Then `data_day = index + 1`.

Reports use the latest available data day, not the current wall-clock day.

### 3.4 Transfer Data Handling

Transfer data is configurable via `requirements.includeTransferDataInCalculation`.

**When `false` (default):** Negative `daily_fans` values are skipped entirely. The first positive value is the baseline. Transfer members appear with a badge but their early values do not affect rankings.

**When `true`:** Negative values are converted to `abs()` before subtraction. Gains include data from before the transfer boundary.

---

## 4. Time Rules

The bot uses uma.moe, which updates once per day around `00:00 JST` (= `22:00 WIB` on the previous calendar day). Between updates, data is static. A single monthly API response contains enough cumulative data to compute all reports for that month.

### 4.1 Timezone Architecture

**Internal timezone: JST (Asia/Tokyo, UTC+9)** — All date logic (snapshot naming, data day calculation, stale windowing) uses JST because uma.moe scrapes at 00:00 JST.

**Display timezone: configurable via `config.timezone`** — Default is `Asia/Jakarta` (WIB, UTC+7). Only used for user-facing output (report headers, footer timestamps, alert messages). Never affects internal logic.

### 4.2 Date Display

Snapshot filenames use the JST data day: `data/snapshots/YYYY/MM/DD.json`

The JST data day for a scrape at 00:00 JST on June 12 is `2026/06/12`. This corresponds to 22:00 WIB on June 11 — the WIB calendar day is one behind.

User-facing wording: `Data: 11 Juni 2026, 22:00 WIB`

Footer format: `Sync at: D/M HH:MM` (rendered in display timezone).

---

## 5. Commands Reference

All commands require a configured prefix. Default prefix is `/`; multiple prefixes may be configured. No-prefix commands are disabled by default.

All reports exclude left members unless explicitly noted.

Member lookup for `/analyze` and `/compare` uses this resolution order:

1. Exact case-sensitive match
2. Exact case-insensitive match
3. Unique partial match
4. Fuzzy match
5. If ambiguous, ask the user to choose from numbered options

The bot must not silently choose when multiple reasonable matches exist.

### 5.1 /daily

```text
/daily          — latest data day
/daily 0        — latest data day
/daily 1        — one data day back
/daily -1       — one data day back
```

**Purpose:** Show member fan gains for a specific data day.

**Sections (in order):**

1. **Title** — report name with data date
2. **Club info** — club name, tier, rank
3. **Data line** — data date and update time
4. **Context** — promotion gap, demotion buffer
5. **Summary** — contributor count, total gain
6. **Ranked members** — sorted by daily gain descending, transfer badges
7. **Stale section** — members with zero gain on viewed day who have been active before
8. **Stale data warning** — when snapshot is outdated
9. **Footer** — sync timestamp

**Offset rules:** `/daily 0` and `/daily` mean latest. Positive and negative offsets both mean past by absolute magnitude. Future data must never be queried. If offset exceeds configured maximum, return a friendly error.

### 5.2 /weekly

```text
/weekly         — current week
/weekly 1       — previous week
/weekly -1      — previous week
```

**Purpose:** Show fixed 7-day block growth.

**Week blocks:**

```text
Week 1: days 1-7
Week 2: days 8-14
Week 3: days 15-21
Week 4: days 22-28
Week 5: days 29-31
```

**Sections (in order):**

1. **Title** — report name with week number
2. **Club info** — club name, tier, rank
3. **Data line** — data date and update time
4. **Period** — block range (e.g., "Periode: Hari 8-14")
5. **Context** — promotion gap, demotion buffer
6. **Summary** — contributor count, total gain
7. **Ranked members** — sorted by weekly gain descending, transfer badges
8. **Below requirement** — ALL members below target, including zero-gain members
9. **Stale section** — members exceeding weekly stale threshold
10. **Stale data warning** — when snapshot is outdated
11. **Footer** — sync timestamp

### 5.3 /monthly

```text
/monthly        — current month
/monthly 1      — previous month
/monthly -1     — previous month
```

**Purpose:** Show current or previous month progress.

**Sections (in order):**

1. **Title** — report name with month and year
2. **Club info** — club name, tier, rank
3. **Data line** — data date and update time
4. **Context** — promotion gap, demotion buffer
5. **Summary** — contributor count, total gain, projected month-end
6. **Ranked members** — sorted by monthly gain descending, transfer badges
7. **Requirement section** — pass/fail count, per-member deficit list
8. **Stale section** — members exceeding monthly stale threshold
9. **Stale data warning** — when snapshot is outdated
10. **Footer** — sync timestamp

### 5.4 /ranks

```text
/ranks
```

**Purpose:** Show top 10 members by monthly gain with medals for top 3.

**Sections:** Title, club info, data line, medal rankings (🥇🥈🥉), footer.

### 5.5 /bottom

```text
/bottom
```

**Purpose:** Show up to 10 members below requirement.

**Sections:** Title, club info, data line, monthly/weekly targets, ranked by gain ascending with deficit amounts, stale section, footer.

### 5.6 /stats

```text
/stats
```

**Purpose:** Show club-level summary.

**Sections:** Title, club info, data line, member counts, averages (monthly, median, daily), active days, zero-gain count, top/lowest member, projected month-end, tier projection, requirement pass rate, footer.

### 5.7 /members

```text
/members
```

**Purpose:** Show full member list.

**Sections:** Title, club info, active members with gains and transfer badges, stale members, left members with "last seen" date.

**Note:** This is the ONLY command that shows left members. Members report has no sync footer (it is a list, not a performance report).

### 5.8 /compare

```text
/compare MemberA MemberB
```

**Purpose:** Compare two members side by side.

**Sections:** Title with date, member stats (monthly gain, daily gain, weekly gain), winner declaration, footer.

### 5.9 /analyze

```text
/analyze MemberName
```

**Purpose:** Deep analysis of a single member.

**Sections:** Title with date, monthly gain vs target, daily gain, 3-day average, 7-day average, consistency score, active days, projected month-end, requirement status, transfer info, trend direction, footer.

### 5.10 /tier

```text
/tier
```

**Purpose:** Show tier intelligence — promotion gap, demotion buffer, pace analysis, risk level, projected outcome.

**Sections:** Title, club info, data line, promotion/demotion context, current pace, required pace, days left, risk level with projection, footer.

### 5.11 /ping

```text
/ping
```

**Purpose:** Check if the bot is alive and receiving messages.

**Rules:**

- Same access control as report commands (command groups or admin DMs only)
- Requires no snapshot
- Returns a simple acknowledgment: `🏓 pong — bot aktif dan menerima pesan`
- No data fetched or computed — purely a connectivity check

### 5.12 /help

```text
/help
```

**Purpose:** Show available commands.

**Rules:**

- Same access control as report commands (command groups or admin DMs only)
- Does NOT bypass access control — unconfigured groups and announcement groups see no response
- Requires no snapshot
- Admin-specific commands only shown when sender is admin

### 5.13 Admin Commands

```text
/setreq monthly <amount>    — set monthly requirement
/setreq weekly <amount>     — set weekly requirement
/config                     — show current configuration
/status                     — show bot status
/catchup on|off             — toggle catch-up
/alerts on|off              — toggle alerts
/schedule                   — not yet implemented (placeholder)
```

**Rules:**

- Restricted to configured admin JIDs
- Available in command groups and private chats
- Config changes read latest from disk before applying (preserves manual edits)
- Changes persist to config.yaml and apply without restart

---

## 6. Formatting Contract

All user-facing WhatsApp messages use WhatsApp's built-in formatting syntax. Reports must apply these styles for mobile readability.

### 6.1 Available Styles

| Style | Syntax | Use |
|-------|--------|-----|
| Bold | `*text*` | Headers, emphasis, key values, member names |
| Italics | `_text_` | Secondary info, labels |
| Strikethrough | `~text~` | Deprecated values |
| Monospace | `` `text` `` | Code, alignment-sensitive data |
| Combined | `*_text_*` | Bold + italic |

WhatsApp does not support nested bold. Avoid `**double asterisks**`.

### 6.2 Shared Header Pattern

All performance reports (daily, weekly, monthly, ranks, bottom, stats, tier) follow this header:

```text
*{emoji} {Report Title}*

{Club Name} | {Tier} (#{Rank})
Data: {date}, {time} {timezone}
Promosi: {gap} fans lagi
Degradasi: buffer {buffer}

👥 {contributors} kontribusi dari {total} anggota | Total: {gain}
```

Exception: `/members` has no data line or sync footer (it is a list).

### 6.3 Shared Member List Pattern

Ranked members use numbered lists with bold names:

```text
1. *{Name}* — +{gain}
2. *{Name}* 🔄 — +{gain}
```

Transfer badge `🔄` appears after the member name, before the dash.

### 6.4 Shared Stale Section Pattern

```text
*⚠️ Belum aktif {period}:*
• {member1}
• {member2}
```

Period words: "hari ini" (daily), "minggu ini" (weekly), "bulan ini" (monthly).

### 6.5 Shared Footer Pattern

```text
⸻
Sync at: {D/M HH:MM}
```

Footer is omitted from `/members` (list format).

### 6.6 Formatting Reference Table

| Element | Style | Example |
|---------|-------|---------|
| Report title | Bold, emoji inside | `*📊 Daily Report — 11 Juni 2026*` |
| Club info | Plain, rank in parens | `Hol＿Horse \| A+ (#431)` |
| Data line | Plain | `Data: 11 Juni 2026, 22:00 WIB` |
| Context lines | Plain | `Promosi: 349.2M fans lagi` |
| Summary line | Plain with emoji | `👥 27 kontribusi dari 30 anggota \| Total: 32.3M` |
| Section headers | Bold with emoji | `*⚠️ Belum aktif hari ini:*` |
| Member name | Bold | `1. *Ryu* — +1.2M` |
| Transfer badge | Suffix | `*Sairen* 🔄 — +14.3M` |
| Requirement | Emoji prefix | `✅ pass` / `❌ kurang X` |
| Footer | Separator + plain | `⸻\nSync at: 11/6 22:05` |

### 6.7 Message Constraints

- Maximum length: `message.maxLength` (default 4096 characters)
- Messages exceeding limit split at newline boundaries with `Part X/Y` markers
- Formatting markers count toward the character limit
- Bold markers are invisible in rendered WhatsApp

---

## 7. Calculation Rules

### 7.1 Daily Gain

For day `D`:

```text
current  = daily_fans[D - 1]
previous = daily_fans[D - 2]
```

If both positive: `daily_gain = current - previous`

If current is positive but previous is 0, missing, or unusable: `daily_gain = 0` (baseline, not real performance).

When `includeTransferDataInCalculation` is `true`, negative previous values become `abs()` before subtraction.

### 7.2 Weekly Gain

Fixed blocks: W1=d1-7, W2=d8-14, W3=d15-21, W4=d22-28, W5=d29-31.

```text
weekly_gain = last positive value in block - first positive value in block (or value before block)
```

Returns 0 if no positive values or only one positive value in the block.

When `includeTransferDataInCalculation` is `false`, skip negative values. When `true`, use `abs()`.

### 7.3 Monthly Gain

```text
monthly_gain = latest positive value - first positive value
```

Returns 0 if only one positive value exists (baseline only).

### 7.4 Offsets

- `/daily` and `/daily 0` = latest available data day
- Positive and negative offsets both mean past reports by absolute magnitude
- Future data must never be queried
- If offset exceeds configured maximum, return a friendly error

---

## 8. Member Classification

Each member is classified before report generation. There are exactly three statuses: `active`, `stale`, and `left`. Transfer is NOT a status — it is a boolean attribute displayed as a badge.

### 8.1 Active

A member is active when present in the current snapshot, has at least one positive `daily_fans` value, and is not stale by the relevant report-type threshold.

### 8.2 Stale (Report-Specific)

Stale detection uses a configurable rolling-window threshold per report type.

**Thresholds:**

| Report | Condition | Default |
|--------|-----------|---------|
| Daily | Gain = 0 on viewed day AND has been active before | 0 (stale on zero day) |
| Weekly | Consecutive zero-gain days at end >= threshold | 3 |
| Monthly | Consecutive zero-gain days at end >= threshold | 7 |

**Rolling window rules:**

- NOT bounded by weekly or monthly block boundaries
- Counting consecutive zero-gain days crosses block boundaries
- A member off 2 days at end of Week 3 + 1 day at start of Week 4 = 3 consecutive = stale for weekly
- Streak resets to zero on any day with positive gain

### 8.3 Left

Detected by ghost detection: `snapshot.members.length - circle.member_count` extra members are classified as left. Among stale members, the bottom N by monthly gain are reclassified as left.

Left members are ONLY displayed in `/members`. NOT shown in any other report.

### 8.4 Transfer (Badge)

A member has `isTransfer = true` when:

- `previous_circle_id` is present, OR
- `previous_circle_name` is present, OR
- Negative early `daily_fans` values exist

Display: `Name 🔄` or `Name 🔄 (dari PreviousClub)` in context-rich reports.

---

## 9. Alerts

Alerts are deduplicated and admin-only by default. They go to configured admin targets, not announcement groups.

### 9.1 Performance Drop

**Trigger:** `today_gain < 50% of member_7_day_average`

Only when member has enough history, is active, and is not a transfer member (transfer baseline artifacts cause false positives).

### 9.2 Demotion Imminent

**Trigger:** `demotion buffer < 3 days of current pace`

Uses tier intelligence risk level calculation.

### 9.3 Streak Break

Trigger when a current active member had an active streak and latest valid day gain is 0.

Do not trigger for stale data, missing snapshots, transfer members, or known left members.

### 9.4 New Transfer

Trigger when a member appears with `previous_circle_name` and has not already been seen in alert state.

### 9.5 Rank Drop

**Trigger:** `monthly_rank - yesterday_rank > configured threshold`

Default threshold: 10 positions.

### 9.6 Quiet Hours

Quiet hours suppress all alerts during a configurable time window (default 23:00-06:00 in display timezone).

Rules:

- All alert types are suppressed
- Suppressed alerts are not queued or resent — they are dropped
- Alert deduplication state DOES update during quiet hours (alerts recorded as sent) to prevent duplicates when quiet hours end

### 9.7 Catch-Up Alerts

Alerts detected during catch-up are aggregated into a single grouped message:

```text
_[catch-up alerts]_

7 Penurunan performa terdeteksi
1 Streak terputus terdeteksi
6 Transfer baru terdeteksi
```

---

## 10. Scheduling and Catch-Up

### 10.1 Auto-Delivery Schedule

All schedule times use the display timezone (default WIB).

```text
22:05 — Daily report
22:05 — Weekly report on days 7, 14, 21, 28
22:12 — Monthly report on day 1
```

### 10.2 Collision Rule

If two or more report types are scheduled at the same time on the same day, send one combined report. Supported collision pairs: daily+weekly, daily+monthly, weekly+monthly.

### 10.3 Catch-Up on Restart

On startup, the bot must:

1. Load schedule history
2. Determine last successful report delivery
3. Determine which scheduled reports were missed
4. Fetch or reuse snapshots
5. Send missed reports chronologically (tagged `[catch-up]`)
6. Mark them as delivered
7. Aggregate and send catch-up alerts

**Rules:**

- Send missed reports oldest first
- Send at most `maxReportsPerStartup` (default 10)
- Colliding reports grouped as one unit
- If catch-up is disabled, do not send, but update state so old reports are not retried forever
- Single-fetch recovery: one current-month fetch can recover several missed daily reports

### 10.4 Month Boundary Rules

- Previous month data must remain available
- `/monthly -1` reads the previous month snapshot
- Current month snapshots must not overwrite previous month data
- Catch-up around month boundaries may require both previous and current month snapshots

---

## 11. Access Control

### 11.1 Command Categories

| Category | Commands | Who | Where |
|----------|----------|-----|-------|
| Ping | `/ping` | Everyone | Command groups, admin DMs only |
| Help | `/help` | Everyone | Command groups, admin DMs only |
| Report | `/daily`, `/weekly`, `/monthly`, `/ranks`, `/bottom`, `/stats`, `/members`, `/compare`, `/analyze`, `/tier` | Public in command groups, admin in DMs | Command groups, admin DMs only |
| Admin | `/setreq`, `/config`, `/status`, `/catchup`, `/alerts`, `/schedule` | Admin JIDs only | Command groups, admin DMs only |

**No command responds outside configured groups or admin DMs.** Unconfigured groups, announcement groups, and non-admin private chats receive no response — the bot stays completely silent.

### 11.2 Automatic Delivery

- Reports go only to configured announcement groups
- Alerts go only to configured admin targets (default: admin JIDs)

---

## 12. Configuration

### 12.1 Config Schema

```yaml
circleId: 232229195
timezone: Asia/Jakarta

commands:
  prefixes: ["/"]
  maxDailyOffset: 31
  maxWeeklyOffset: 5
  maxMonthlyOffset: 12

admins: ["628xxxxxxxx@s.whatsapp.net"]

groups:
  command: ["xxxx@g.us"]
  announcement: ["yyyy@g.us"]
  alertAdmin: ["zzzz@g.us"]

requirements:
  monthlyFans: 20000000
  weeklyFans: 7000000
  weeksInMonthEquivalent: 4
  includeTransferDataInCalculation: false

schedule:
  daily: { enabled: true, time: "22:05" }
  weekly: { enabled: true, days: [7, 14, 21, 28], time: "22:05" }
  monthly: { enabled: true, day: 1, time: "22:12" }

catchUp: { enabled: true, maxReportsPerStartup: 10 }

alerts:
  enabled: true
  defaultRecipients: admin
  performanceDrop: { enabled: true, thresholdPercent: 50, minHistoryDays: 7 }
  demotionRisk: { enabled: true, bufferDays: 3 }
  streakBreak: { enabled: true }
  newTransfer: { enabled: true }
  rankDrop: { enabled: false, positions: 10 }
  quietHours: { enabled: false, start: "23:00", end: "06:00" }

memberStatus:
  staleAfterDaysDaily: 0
  staleAfterDaysWeekly: 3
  staleAfterDaysMonthly: 7

message: { maxLength: 4096, splitAtNewline: true, language: id }

logging: { level: info, logFile: data/logs/bot.log, maxSizeMB: 5, maxFiles: 3, console: true }
```

### 12.2 Config Change Sources

Config can be changed from two sources:

1. **Manual edits** — user edits `config.yaml` directly while the bot is running
2. **Admin commands** — user runs `/setreq`, `/catchup`, `/alerts` via WhatsApp

Both sources must coexist without data loss:

- Admin commands read the **latest config from disk** before applying their change, then write back
- The file watcher detects manual edits via mtime + content hash polling (every 5 seconds)
- Config changes apply to all subsystems immediately via getter pattern

### 12.3 Logging

The bot uses a structured logger with configurable levels and file output.

| Level | Purpose |
|-------|---------|
| `debug` | Internal operations: snapshot skips, cache hits, dedup checks |
| `info` | Significant events: startup, report sent, alerts detected, catch-up |
| `warn` | Degraded state: stale data, reconnect attempts, edit fallbacks |
| `error` | Failures: fetch errors, delivery failures, unhandled exceptions |

Rules:

- Every log line includes timestamp (ISO 8601), level tag, and source tag
- Console output uses ANSI colors (gray=debug, cyan=info, yellow=warn, red=error)
- File output rotates at `maxSizeMB`, keeps `maxFiles` most recent
- Logging level changes via config hot-reload take effect immediately
- File logging is best-effort — errors never crash the bot

---

## 13. Error Handling

Errors must be human-readable and safe. Do not leak tokens, cookies, stack traces, or internal secrets into WhatsApp messages.

### 13.1 uma.moe Unavailable

1. Use latest available snapshot
2. Mark report as stale
3. Tell user data may be outdated

```text
Data uma.moe lagi tidak bisa diambil.
Aku pakai snapshot terakhir: 12 Juni 2026.
```

### 13.2 Token Expired

Token is harvested via Playwright and cached for 240 seconds. If expired during request, refresh via Playwright, retry, then fall back to stale snapshot.

### 13.3 Snapshot Missing

```text
Belum ada data yang bisa dipakai, dan uma.moe belum bisa dihubungi.
Coba lagi nanti setelah sync berhasil.
```

### 13.4 WhatsApp Disconnect

Auto-reconnects with backoff. Reports are not marked as sent until delivery attempt is confirmed.

### 13.5 Long Message

Messages over `message.maxLength` (default 4096) split at newline boundaries with `Part X/Y` markers. Marker overhead (up to 20 chars) reserved from content budget.

### 13.6 Loading Message

- Group command: send loading message, edit to final result
- If edit fails: send final result as new message
- Announcement/auto-delivery: send only final report

---

## 14. REST API

Available after launch. Not a launch blocker. Binds to localhost by default.

**Endpoints:**

```text
GET /health
GET /reports/daily
GET /reports/weekly
GET /reports/monthly
GET /reports/stats
GET /reports/bottom
GET /members
GET /members/:viewerId
GET /tier
GET /snapshots
```

**Response envelope:**

```json
{
  "success": true,
  "data": {},
  "meta": { "snapshotDate": "2026-06-12", "timezone": "Asia/Jakarta", "stale": false }
}
```

If exposed beyond localhost later, API authentication must be added first.

---

## 15. Message Style

User-facing messages should be Indonesian, concise, actionable, and non-shaming.

```text
# Avoid
Member failed.
Bad member.

# Prefer
Member ini masih di bawah requirement.
Butuh sekitar 12.4M lagi untuk aman.
```

---

## 16. Core Invariants

These rules must always hold. They are independent of implementation choices.

1. Snapshots are immutable.
2. Internal date logic uses JST. User-facing display uses the configured display timezone.
3. All reports are derived from snapshots.
4. `daily_fans` is cumulative, not daily.
5. Negative `daily_fans` values are transfer markers, not negative performance.
6. Zero values are missing/no usable data, not automatically real zero gain.
7. Baseline jumps are not ranked as real performance.
8. Catch-up reports are chronological and deduplicated.
9. Alerts are deduplicated and admin-only by default.
10. Admin commands are access-controlled.
11. Report commands are public only inside allowed command groups or admin DMs.
12. Long WhatsApp messages are split safely.
13. Stale data is clearly marked.
14. Month boundaries preserve previous month data.
15. Member status is exactly one of: active, stale, left. Transfer is a badge, not a status.
16. Left members are only shown in `/members`.
17. Snapshot filenames use JST data day.
18. Reports exclude left members.
19. Quiet hours suppress all alert types during the configured window.
20. All reports use WhatsApp formatting per section 6.
21. Transfer members are excluded from performance drop and streak break alerts.
