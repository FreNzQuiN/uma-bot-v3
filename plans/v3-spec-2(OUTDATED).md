# Uma Club Bot v3 — Resolved System Specification

> WhatsApp bot for Uma Musume club leaders.
> This document defines product behavior, data interpretation, edge cases, and build order.
> It is implementation-oriented, but does not prescribe internal code structure.

---

## 1. Product Summary

Uma Club Bot v3 helps Uma Musume club leaders manage member performance through WhatsApp.

The bot:

- Fetches club data from uma.moe
- Saves immutable daily snapshots
- Generates core reports: daily, weekly, monthly, leaderboard, bottom, stats, member, and tier
- Supports post-launch member comparison and detailed analysis reports
- Sends reports manually through commands or automatically on schedule
- Recovers from downtime by detecting and sending missed reports
- Tracks tier promotion/demotion risk
- Alerts leaders about performance drops, demotion risk, streak breaks, transfers, and rank drops

Primary constraint:

> The bot may not run 24/7. It must recover correctly after being offline.

---

## 2. Users and Questions

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

## 3. Data Source and Time Rules

The bot uses uma.moe.

uma.moe provides:

- Club metadata
- Current monthly rank and tier
- Monthly fan points
- Yesterday rank and points
- Member list
- Per-member `daily_fans`
- Transfer fields such as `previous_circle_id` and `previous_circle_name`
- Promotion/demotion threshold fields such as `fans_to_next_tier` and `fans_to_lower_tier`

Important source properties:

- Data updates once per day around `00:00 JST`, which is `22:00 WIB` on the previous calendar day
- Between updates, data is effectively static
- A single monthly API response contains enough cumulative data to compute all reports for that month

User-facing dates and schedules use `Asia/Jakarta` / WIB. Avoid showing JST unless debugging or explaining source behavior.

Recommended user-facing wording:

```text
Data updated: 11 June 2026, 22:00 WIB
```

Canonical snapshot filenames use the WIB data day represented by the snapshot, not the JST scrape date or local wall-clock write time. Example: data updated at 11 June 2026 22:00 WIB is stored as `data/snapshots/2026/06/11.json`. Older JST-date snapshots may be read for migration/backward compatibility, but new writes use WIB data-day naming.

---

## 4. Core Data Model

### 4.1 Snapshot

A snapshot is one saved raw uma.moe response for a specific circle, year, month, and data day.

Path:

```text
data/snapshots/YYYY/MM/DD.json
```

Rules:

- Snapshots are immutable once saved
- Snapshots are the source of truth for historical reports
- Reports are derived from snapshots whenever possible
- Live API fetches happen only when the required snapshot is missing or fresh data is needed

A snapshot contains raw source data including:

- `circle`
- `members`
- `club_rank`
- `fans_to_next_tier`
- `fans_to_lower_tier`
- `yesterday_fans_to_next_tier`
- `yesterday_fans_to_lower_tier`

### 4.2 `daily_fans`

Each member has a cumulative monthly fan array:

```json
"daily_fans": [number, number, ...]
```

Rules:

- 32-element array
- Index `0` = day 1 of the month
- Index `30` = day 31
- Index `31` = padding / unused
- Values are cumulative fan totals, not daily gains
- `value > 0` = usable cumulative value
- `0` = no usable data for that day
- negative value = transfer-related historical marker, not negative performance

Example:

```text
daily_fans[9]  = cumulative fans at end of day 10
daily_fans[10] = cumulative fans at end of day 11
day 11 gain    = daily_fans[10] - daily_fans[9]
```

### 4.3 Latest Data Day

The latest usable data day for a snapshot is:

```text
latest index where at least one active member has daily_fans[index] > 0
```

Then:

```text
data_day = index + 1
```

Reports use the latest available data day, not the current wall-clock day.

---

## 5. Calculation Rules

### 5.1 Daily Gain

For day `D`:

```text
current = daily_fans[D - 1]
previous = daily_fans[D - 2]
```

If both values are positive:

```text
daily_gain = current - previous
```

If `current` is positive but the previous value is `0`, missing, or unusable:

```text
daily_gain = 0
status = new baseline / no previous usable data
```

Normal reports must not treat a `0 -> large positive` or `negative -> positive` jump as real daily performance.

### 5.2 Weekly Gain

Weekly blocks are fixed:

```text
Week 1: days 1-7
Week 2: days 8-14
Week 3: days 15-21
Week 4: days 22-28
Week 5: days 29-31
```

For a block:

```text
weekly_gain = value_at_block_end - value_before_block_start
```

Use only positive cumulative values. If a member joined during the block, calculate from the first valid positive value in the block, mark them as transfer/new when applicable, and do not count baseline jumps as normal growth.

### 5.3 Monthly Gain

Monthly gain is:

```text
latest_positive_value - first_positive_value
```

If only one positive value exists:

```text
monthly_gain = 0
status = baseline only
```

Do not use future zero padding, negative values, or transfer markers as normal monthly starting values.

### 5.4 Offsets

Offsets are bounded by configuration.

Rules:

- `/daily` and `/daily 0` mean latest available data day
- Positive and negative offsets both mean past reports by absolute magnitude
- Future data must never be queried

Examples:

```text
/daily 0  = latest available daily report
/daily 1  = one data day back
/daily -1 = one data day back
```

If requested offset exceeds the configured maximum, return a friendly error.

---

## 6. Member Status Rules

Each member is classified before report generation.

### 6.1 Active

A member is active when they are present in the current snapshot, have at least one recent positive `daily_fans` value, and are not stale by the configured threshold.

### 6.2 Inactive or Stale

Default stale rule:

```text
inactive_or_stale = member_latest_positive_day <= snapshot_latest_data_day - 3
```

Example: if the snapshot has data through day 11 and a member’s latest positive value is day 8 or earlier, mark them stale/inactive by default.

Inactive/stale members are separated from normal rankings where appropriate.

### 6.3 Left

A left member is detected by historical comparison:

```text
member existed in previous snapshot/month
AND member does not exist in current snapshot
```

Left members are excluded from active rankings and active requirement checks. They may appear in member history or summary sections with last seen date.

### 6.4 Transfer

A transfer member has one or more of:

- `previous_circle_id`
- `previous_circle_name`
- negative early `daily_fans`

Display format:

```text
Name (from PreviousClub)
```

Transfer members appear in reports with adjusted valid gains, but transfer baseline jumps are not treated as normal fan gain.

---

## 7. Reports and Commands

All commands require a configured prefix. Default prefix is `/`; multiple prefixes may be configured.

No-prefix commands are disabled by default to avoid accidental WhatsApp group triggers.

Member lookup for `/analyze` and `/compare` uses this resolution order:

1. Exact case-sensitive match
2. Exact case-insensitive match
3. Unique partial match
4. Fuzzy match
5. If ambiguous, ask the user to choose from numbered options

The bot must not silently choose when multiple reasonable matches exist.

### 7.1 Daily Report

Commands:

```text
/daily
/daily 0
/daily 1
/daily -1
```

Purpose: show member fan gains for a specific data day.

Include:

- Report date and data update time
- Club name, tier, rank, promotion gap, demotion buffer
- Active member count
- Total daily gain
- Ranked member gains
- Transfer badges
- Stale/inactive section when needed
- Stale data warning when needed
- Sync/update footer

### 7.2 Weekly Report

Commands:

```text
/weekly
/weekly 1
/weekly -1
```

Purpose: show fixed 7-day block growth.

Include block range, total weekly gain, member rankings, requirement progress, and members below weekly requirement.

### 7.3 Monthly Report

Commands:

```text
/monthly
/monthly 1
/monthly -1
```

Purpose: show current or previous month progress.

Include monthly total gain, active members, inactive/left members, requirement pass/fail, projected final gain, and tier status.

### 7.4 Ranks Report

Command:

```text
/ranks
```

Purpose: show top 10 members by monthly gain with medals for top 3.

### 7.5 Bottom Report

Command:

```text
/bottom
```

Purpose: show up to 10 members below requirement.

Include monthly/weekly requirement basis, current gain, deficit, and projected status.

### 7.6 Stats Report

Command:

```text
/stats
```

Purpose: show club-level summary.

Include total monthly gain, average and median per active member, top member, lowest active member, requirement pass rate, projected month-end total, and tier projection.

### 7.7 Members Report

Command:

```text
/members
```

Purpose: show full member list.

Include active members with monthly gains, transfer badges, inactive/stale members, and left members when historical comparison exists.

### 7.8 Compare Report

Command:

```text
/compare MemberA MemberB
```

Include monthly gain, latest daily gain, weekly gain, average daily gain, requirement status, and winner by selected period.

### 7.9 Analyze Report

Command:

```text
/analyze MemberName
```

Include monthly gain, latest daily gain, 3-day average, 7-day average, consistency score, active days, projected month-end gain, requirement status, transfer information, and trend direction.

### 7.10 Tier Report

Command:

```text
/tier
```

Purpose: show promotion gap, demotion buffer, required pace, current pace, risk level, and projected outcome.

---

## 8. Tier Intelligence

The API provides:

```text
club_rank
fans_to_next_tier
fans_to_lower_tier
yesterday_fans_to_next_tier
yesterday_fans_to_lower_tier
```

Promotion gap:

```text
fans_to_next_tier
```

Required daily pace:

```text
fans_to_next_tier / days_left_in_month
```

Use latest available data day to calculate remaining days.

Demotion risk levels:

```text
LOW    = buffer >= 7 days pace
MEDIUM = buffer >= 3 days pace and < 7 days pace
HIGH   = buffer < 3 days pace
```

Projected outcome may be:

- promote
- stay
- demotion risk
- unknown

Projection should use current average daily club gain, days left, promotion gap, and demotion buffer. Do not overstate certainty; use wording such as `likely stay`, `promotion possible if pace holds`, or `demotion risk high`.

---

## 9. Requirements

Weekly and monthly fan requirements are configurable:

```yaml
requirements:
  weeklyFans: 7000000
  monthlyFans: 20000000
  weeksInMonthEquivalent: 4
```

Rules:

- If both weekly and monthly are greater than zero, evaluate both
- If weekly is zero and monthly is greater than zero, derive weekly from monthly
- If monthly is zero and weekly is greater than zero, derive monthly from weekly
- If both are zero, requirement checks are disabled
- Derived values use precise math before display rounding

When both requirements exist, flag a member if they fail either requirement. Reports must state whether the member is below weekly target, monthly target, or both.

---

## 10. Alerts

Alerts are deduplicated and admin-only by default. They should not go to normal announcement groups unless explicitly configured, because performance and risk alerts can embarrass members or create unnecessary public pressure.

### 10.1 Performance Drop

Trigger:

```text
today_gain < 50% of member_7_day_average
```

Only trigger when the member has enough history, the 7-day average is meaningful, the member is active, and the day is not a transfer baseline artifact.

### 10.2 Demotion Imminent

Trigger:

```text
demotion buffer < 3 days of current pace
```

### 10.3 Streak Break

Trigger when a current active member had an active streak and latest valid day gain is `0`.

Do not trigger for stale data, missing snapshots, transfer baselines, or known left members.

### 10.4 New Transfer

Trigger when a member appears with `previous_circle_name` and has not already been seen in alert state.

### 10.5 Rank Drop

Trigger:

```text
monthly_rank - yesterday_rank > configured threshold
```

Default threshold: 10 positions.

### 10.6 Catch-Up Alerts

Alerts detected during catch-up are aggregated instead of sent one-by-one.

Example:

```text
[catch-up alerts]
3 performance drops detected
1 new transfer detected
1 demotion risk day detected
```

---

## 11. Auto-Delivery and Catch-Up

All times are WIB.

```text
22:05 — Daily report
22:05 — Weekly report on days 7, 14, 21, 28
22:12 — Monthly report on day 1
```

Collision rule: if daily and weekly are scheduled at the same time, send one combined daily + weekly report with shared header and footer. Do not send duplicate separate reports unless explicitly configured.

On startup, the bot must:

1. Load schedule history
2. Determine last successful report delivery
3. Determine which scheduled reports were missed
4. Fetch or reuse snapshots
5. Send missed reports chronologically
6. Mark them as delivered
7. Deduplicate alerts

Catch-up reports are tagged:

```text
[catch-up]
```

Catch-up volume is limited by config:

```yaml
catchUp:
  enabled: true
  maxReportsPerStartup: 10
```

Rules:

- Send missed reports oldest first
- Send at most `maxReportsPerStartup`
- Summarize older skipped reports instead of spamming
- If catch-up is disabled, do not send missed reports, but update schedule state so old reports are not retried forever

Single-fetch recovery: because `daily_fans` is cumulative and monthly, one current-month fetch can recover several missed daily reports in the same month.

Month boundary rules:

- Previous month data must remain available
- `/monthly -1` reads the previous month snapshot
- Current month snapshots must not overwrite previous month data
- Catch-up around month boundaries may require both previous and current month snapshots

---

## 12. Access Control

### 12.1 Report Commands

Report commands are public inside configured command groups and available in direct messages from admins.

Public report commands:

```text
/daily
/weekly
/monthly
/ranks
/bottom
/stats
/members
/compare
/analyze
/tier
```

Report commands are rejected elsewhere.

### 12.2 Admin Commands

Admin commands are restricted to configured admin JIDs.

Admin commands include:

```text
/setreq
/config
/status private details
/catchup on|off
/alerts on|off
/schedule set
```

### 12.3 Automatic Delivery

Automatic reports go only to configured announcement groups. Alerts go only to configured admin targets by default.

---

## 13. Configuration

Example configuration:

```yaml
circleId: 232229195
timezone: Asia/Jakarta

commands:
  prefixes: ["/"]
  maxDailyOffset: 31
  maxWeeklyOffset: 5
  maxMonthlyOffset: 12

admins:
  - "628xxxxxxxx@s.whatsapp.net"

groups:
  command:
    - "xxxx@g.us"
  announcement:
    - "yyyy@g.us"
  alertAdmin:
    - "zzzz@g.us"

requirements:
  monthlyFans: 20000000
  weeklyFans: 7000000
  weeksInMonthEquivalent: 4

schedule:
  daily:
    enabled: true
    time: "22:05"
  weekly:
    enabled: true
    days: [7, 14, 21, 28]
    time: "22:05"
  monthly:
    enabled: true
    day: 1
    time: "22:12"

catchUp:
  enabled: true
  maxReportsPerStartup: 10

alerts:
  enabled: true
  defaultRecipients: admin
  performanceDrop:
    enabled: true
    thresholdPercent: 50
    minHistoryDays: 7
  demotionRisk:
    enabled: true
    bufferDays: 3
  streakBreak:
    enabled: true
  newTransfer:
    enabled: true
  rankDrop:
    enabled: false
    positions: 10
  quietHours:
    enabled: false
    start: "23:00"
    end: "06:00"

memberStatus:
  staleAfterDays: 3

message:
  maxLength: 4096
  splitAtNewline: true
  language: id
```

Admin setting changes must persist immediately and apply without restart whenever possible. If restart is required, the bot must say so clearly.

---

## 14. Architecture and Persistence

The system is a single Node.js service. One process handles WhatsApp connection, HTTP API, scheduling, data fetching, data processing, and report delivery.

There is no separate cache layer. uma.moe data is static between daily updates, so snapshot files are the serving layer and historical source of truth.

The system uses snapshot files plus SQLite.

Snapshot files store raw API responses for historical report generation, catch-up recovery, and audit/debugging.

SQLite stores operational state.

Recommended tables:

### 14.1 `settings`

```text
key
value
updated_at
```

### 14.2 `schedule_runs`

```text
id
report_type
report_date
scheduled_at
sent_at
status
is_catch_up
target_jid
error_message
```

### 14.3 `alert_events`

```text
id
alert_type
event_key
member_viewer_id
report_date
created_at
sent_at
status
message
```

Example `event_key` values:

```text
performance_drop:2026-06-11:viewer_id
new_transfer:2026-06:viewer_id
rank_drop:2026-06-11
```

### 14.4 `member_history`

```text
viewer_id
trainer_name
circle_id
first_seen
last_seen
previous_circle_id
previous_circle_name
status
```

Used to detect new members, left members, transfers, and stale members.

### 14.5 `rank_history`

```text
date
circle_id
monthly_rank
monthly_point
club_rank
fans_to_next_tier
fans_to_lower_tier
```

---

## 15. Error Handling and Message Behavior

Errors must be human-readable and safe. Do not leak tokens, cookies, stack traces, or internal secrets into WhatsApp messages.

### 15.1 uma.moe Unavailable

If uma.moe is unavailable:

1. Use latest available snapshot
2. Mark report as stale
3. Tell user data may be outdated

Example:

```text
Data uma.moe lagi tidak bisa diambil.
Aku pakai snapshot terakhir: 10 Jun 2026.
```

A stale snapshot means:

```text
latest saved snapshot is older than the expected latest data day
AND fetching fresh uma.moe data failed or was unavailable
```

### 15.2 Token Expired

Token is harvested via Playwright and cached for 240 seconds. If token expires during a request, refresh via Playwright, retry the request, then fall back to stale snapshot if available.

### 15.3 Snapshot Missing

If no snapshot exists and fetch fails, return a friendly error:

```text
Belum ada data yang bisa dipakai, dan uma.moe belum bisa dihubungi.
Coba lagi nanti setelah sync berhasil.
```

### 15.4 WhatsApp Disconnect

The bot reconnects automatically using backoff. Reports are not marked as sent until WhatsApp confirms the delivery attempt was made.

### 15.5 Long Message

Messages over 4096 characters must be split at newline boundaries, with continuation markers such as `Part 1/2` and `Part 2/2`.

### 15.6 Loading Message

Loading messages are used only for interactive group commands.

Rules:

- Group command: send loading message, then edit it to final result
- If edit fails, send final result as a new message
- Announcement/auto-delivery: send only the final report

---

## 16. REST API

The REST API is available after launch. It is not a launch blocker.

Suggested endpoints:

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

Response envelope:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "snapshotDate": "2026-06-12",
    "timezone": "Asia/Jakarta",
    "stale": false
  }
}
```

Error response:

```json
{
  "success": false,
  "error": "Snapshot not found"
}
```

If exposed beyond localhost later, API authentication must be added first.

---

## 17. Message Style

User-facing WhatsApp messages should be Indonesian, concise, actionable, and non-shaming by default.

Avoid:

```text
Member failed.
Bad member.
```

Prefer:

```text
Member ini masih di bawah requirement.
Butuh sekitar 12.4M lagi untuk aman.
```

---

## 18. MoSCoW Priority

### MUST — Blocks Launch (31)

- Daily report
- Past daily report
- Weekly report
- Monthly report
- Top 10 leaderboard
- Bottom/at-risk report
- Club stats
- Member list
- Daily auto-report
- Weekly auto-report
- Monthly auto-report
- Schedule conflict handling
- Transfer badge
- Performance drop detection
- Fans to promote
- Required daily pace
- Demotion risk
- Tier data in headers
- Performance drop alert
- Demotion imminent alert
- Missed schedule detection
- Catch-up reports
- Snapshot preservation
- Single-fetch recovery
- Persistent storage
- Single-service deployment
- Requirement view/set
- Config/status view
- Admin restriction
- Stale data fallback
- Message splitting

### SHOULD — Important After Launch (21)

- Member comparison
- Member analysis
- Configurable schedules
- Transfer impact
- Activity streak
- Consistency scores
- Rolling averages
- Trend direction
- Promotion countdown
- Club rankings
- Streak break alert
- New transfer alert
- Configurable alerts
- Catch-up tagging
- Catch-up toggle
- Incremental computation
- REST API
- Config hot-reload
- Fun error messages
- Loading indicator
- Auto-reconnect

### COULD — Nice to Have (3)

- Tier band peers
- Rank movement history
- Rank drop alert

### WON’T — Out of Scope for v3 (5)

- Cross-club comparison
- Multiple data sources
- Activity/shame tracking as a core product feature
- Career run pattern analysis
- Full trainer profile system

---

## 19. MVP Build Order

### Phase 1 — Data Foundation

Build uma.moe fetch, token handling, snapshot save/load, latest data day detection, and safe `daily_fans` helpers.

Outcome: can fetch data and compute correct gains from snapshots.

### Phase 2 — Core Reports

Build `/daily`, `/weekly`, `/monthly`, `/ranks`, `/bottom`, `/stats`, `/members`, and `/tier`.

Outcome: users can request all core reports manually.

### Phase 3 — WhatsApp Integration

Build WhatsApp connection, command parser, access control, loading/edit behavior, and message splitting.

Outcome: reports work inside allowed WhatsApp groups.

### Phase 4 — Scheduling and Catch-Up

Build daily/weekly/monthly scheduler, schedule log, missed report detection, catch-up delivery, and collision handling.

Outcome: bot survives downtime and sends missed reports correctly.

### Phase 5 — Tier Intelligence and Alerts

Build tier header, promotion gap, demotion buffer, daily pace, performance drop alert, demotion risk alert, new transfer alert, and alert dedupe.

Outcome: bot becomes proactive, not just reactive.

### Phase 6 — Admin and Polish

Build requirement settings, config/status commands, hot reload where practical, REST API, better report formatting, and error message pool.

Outcome: bot is maintainable for real club operation.

---

## 20. Core Invariants

These rules must always hold:

1. Snapshots are immutable.
2. User-facing time is WIB.
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
15. Single Node.js process handles all concerns.
16. No cache layer — snapshot files serve as the data layer.
17. REST API binds to localhost by default.
