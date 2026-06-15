# Uma Club Bot v3 — System Specification

> WhatsApp bot for Uma Musume club leaders.
> This document defines product behavior, data interpretation, edge cases, and configuration.
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

### 3.1 Timezone Architecture

The bot operates in two timezones:

**Internal timezone: JST (Asia/Tokyo, UTC+9)**

All date logic — snapshot naming, data day calculation, day-boundary detection, stale windowing — uses JST because uma.moe scrapes at 00:00 JST. The JST data day is the canonical date for all internal operations.

**Display timezone: configurable via `config.timezone`**

Default is `Asia/Jakarta` (WIB, UTC+7). Only used for user-facing output: report headers, footer timestamps, alert messages, schedule times. The display timezone never affects internal logic.

**Snapshot filenames use the JST data day:**

```text
data/snapshots/YYYY/MM/DD.json
```

The JST data day for a scrape at 00:00 JST on June 12 is `2026/06/12`. This corresponds to 22:00 WIB on June 11 — the WIB calendar day is one behind.

**User-facing wording:**

```text
Data: 11 Juni 2026, 22:00 WIB
```

**Footer format:**

```text
Sync at: D/M HH:MM
```

Where the timestamp is the snapshot time rendered in the display timezone.

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
- Negative value = transfer-related historical marker, not negative performance

Example:

```text
daily_fans[9]  = cumulative fans at end of day 10
daily_fans[10] = cumulative fans at end of day 11
day 11 gain    = daily_fans[10] - daily_fans[9]
```

### 4.3 Transfer Data Handling

Transfer data is configurable via `requirements.includeTransferDataInCalculation`.

**When `false` (default):**

- Negative `daily_fans` values are skipped entirely
- The first positive `daily_fans` value is treated as the baseline
- Gains are calculated only from that first positive day forward
- Transfer members appear with a badge but their early values do not affect rankings

**When `true`:**

- Negative `daily_fans` values are treated as `abs()` — the absolute value becomes the starting point
- Gains include data from before the transfer boundary
- Members who transferred mid-month may show higher gains because their prior club data is included

### 4.4 Latest Data Day

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

When `includeTransferDataInCalculation` is `false`, negative values are treated as missing (unusable), and the first positive value is the baseline.

When `includeTransferDataInCalculation` is `true`, negative values are converted to their absolute value before subtraction, so a `negative -> positive` transition is treated as a valid baseline.

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

When `includeTransferDataInCalculation` is `false`, skip negative values and use the first positive value as the block start. When `true`, use absolute values.

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

When `includeTransferDataInCalculation` is `true`, negative values become their absolute value before this calculation.

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

## 6. Member Status and Classification

Each member is classified before report generation. There are exactly three statuses: `active`, `stale`, and `left`. Transfer is NOT a status — it is a boolean attribute displayed as a badge.

### 6.1 Active

A member is active when:

- Present in the current snapshot
- Has at least one positive `daily_fans` value
- Is not stale by the relevant report-type threshold (see section 6.2)

### 6.2 Stale (Report-Specific Detection)

Stale detection uses a configurable rolling-window threshold per report type. A member is stale for a given report when their most recent positive-gain day is at or before the threshold.

**Thresholds:**

```yaml
memberStatus:
  staleAfterDaysDaily: 0
  staleAfterDaysWeekly: 3
  staleAfterDaysMonthly: 7
```

**Rolling window rules:**

- The window is NOT bounded by weekly or monthly block boundaries
- Counting consecutive zero-gain days crosses block boundaries
- A member off 2 days at the end of Week 3 + 1 day at the start of Week 4 = 3 consecutive zero-gain days = stale for weekly report
- The streak resets to zero on any day with positive gain

**Per-report behavior:**

| Report Type | Stale Condition | Default Threshold |
|-------------|----------------|-------------------|
| Daily | Gain = 0 on viewed day AND has been active before | 0 (stale on zero day) |
| Weekly | Consecutive zero-gain days at end ≥ threshold | 3 |
| Monthly | Consecutive zero-gain days at end ≥ threshold | 7 |

### 6.3 Left

A left member is detected by comparing the current snapshot member count against the circle's `member_count` field:

```text
circle.member_count = expected number of members
snapshot.members.length = actual members in data

if snapshot.members.length > circle.member_count:
    extra members = snapshot.members.length - circle.member_count
    these extra members are classified as "left"
```

This is ghost detection: the API returns members who left the club but haven't been purged yet, and their `member_count` reflects the current roster while `members` still includes ghosts.

Left members are:

- ONLY displayed in the `/members` command
- NOT shown in daily, weekly, monthly, ranks, bottom, or stats reports
- Classified without historical comparison (detection is per-snapshot, not diff-based)

### 6.4 Transfer (Badge)

Transfer is a boolean attribute, not a status. A member has `isTransfer = true` when one or more of:

- `previous_circle_id` is present
- `previous_circle_name` is present
- Negative early `daily_fans` values exist

Display format:

```text
Name 🔄
```

In reports that show transfer context (e.g., members, analyze), the previous club name appears as:

```text
Name 🔄 (dari PreviousClub)
```

Transfer members appear in reports with adjusted valid gains when `includeTransferDataInCalculation` is `false`, but transfer baseline jumps are not treated as normal fan gain.

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

All reports exclude left members.

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
- Stale section when members hit the daily stale threshold (default: zero gain on viewed day)
- Stale data warning when needed
- Sync footer

**Output format:**

```text
*📊 Daily Report — 11 Juni 2026*

Hol＿Horse | A+ (#431)
Data: 11 Juni 2026, 22:00 WIB
Promosi: 349.2M fans lagi
Degradasi: buffer 21.8M

👥 27 kontribusi dari 30 anggota | Total: 32.3M

1. *Nargi* — +3.1M
2. *GoldFamily* — +2.7M
...

*⚠️ Belum aktif hari ini:*
• naku

⚠️ Data mungkin tidak terbaru (terakhir update: 11 Juni 2026)

⸻
Sync at: 11/6 22:05
```

### 7.2 Weekly Report

Commands:

```text
/weekly
/weekly 1
/weekly -1
```

Purpose: show fixed 7-day block growth.

Include:

- Block range (e.g., "Week 2: days 8-14")
- Total weekly gain
- Member rankings by weekly gain
- Requirement progress
- Members below weekly requirement — includes ALL members below target, including those with 0 gain
- Transfer badges
- Stale section for members exceeding the weekly stale threshold (default: 3 consecutive zero-gain days)
- Sync footer

**Output format:**

```text
*📈 Weekly Report — Minggu 2*

Hol＿Horse | A+ (#431)
Data: 11 Juni 2026, 22:00 WIB
Periode: Hari 8-14
Promosi: 349.2M fans lagi
Degradasi: buffer 21.8M

👥 30 kontribusi dari 30 anggota | Total: 144.5M

1. *Sairen* 🔄 — +14.3M
...

*⚠️ Belum aktif minggu ini:*
• jgd

⸻
Sync at: 11/6 22:05
```

### 7.3 Monthly Report

Commands:

```text
/monthly
/monthly 1
/monthly -1
```

Purpose: show current or previous month progress.

Include:

- Monthly total gain
- Active member count
- Member rankings by monthly gain
- Requirement pass/fail per member
- Per-member failing list with deficit amounts (how much each failing member is short of the monthly target)
- Transfer badges
- Stale section for members exceeding the monthly stale threshold (default: 7 consecutive zero-gain days)
- Projected final gain
- Tier status
- Sync footer

**Output format:**

```text
*📅 Monthly Report — Juni 2026*

Hol＿Horse | A+ (#431)
Data: 11 Juni 2026, 22:00 WIB
Promosi: 349.2M fans lagi
Degradasi: buffer 21.8M

👥 30 kontribusi dari 30 anggota | Total: 347.0M
Proyeksi akhir bulan: ~946.4M

1. *GoldFamily* — +27.7M
...

*🎯 Requirement: 20.0M/bulan*
✅ 1 pass | ❌ 29 kurang
❌ *Ryu* — kurang 4.6M
...

⸻
Sync at: 11/6 22:05
```

### 7.4 Ranks Report

Command:

```text
/ranks
```

Purpose: show top 10 members by monthly gain with medals for top 3.

**Output format:**

```text
*🏆 Peringkat Bulanan*

Hol＿Horse | A+ (#431)
Data: 11 Juni 2026, 22:00 WIB

🥇 *GoldFamily* — +27.7M
🥈 *RngF* — +19.2M
🥉 *Aditya* — +18.6M
4. *DzFx* — +18.2M
...

⸻
Sync at: 11/6 22:05
```

### 7.5 Bottom Report

Command:

```text
/bottom
```

Purpose: show up to 10 members below requirement.

Include monthly/weekly requirement basis, current gain, deficit, and projected status.

**Output format:**

```text
*📉 Perlu Perhatian*

Hol＿Horse | A+ (#431)
Data: 11 Juni 2026, 22:00 WIB

🎯 Target bulanan: 20.0M
🎯 Target mingguan: 4.7M

1. *Yukil* — +4.6M (kurang 15.4M)
2. *Amanda* — +5.3M (kurang 14.7M)
...

*⚠️ Belum aktif bulan ini:*
• jgd

⸻
Sync at: 11/6 22:05
```

### 7.6 Stats Report

Command:

```text
/stats
```

Purpose: show club-level summary.

Include total monthly gain, average and median per active member, top member, lowest active member, requirement pass rate, projected month-end total, and tier projection.

**Output format:**

```text
*📊 Stats Overview*

Hol＿Horse | A+ (#431)
Data: 11 Juni 2026, 22:00 WIB

Total anggota: 30
Aktif: 30 | Keluar: 0 | Transfer: 6

📈 Gain rata-rata bulanan: 11.6M
📈 Gain median bulanan: 9.7M
📈 Gain rata-rata harian: 1.1M
📅 Rata-rata hari aktif: 9 hari
🎯 Zero gain hari ini: 3 orang

🏆 Top: GoldFamily — 27.7M
📉 Lowest aktif: Yukil — 4.6M

📅 Proyeksi akhir bulan: ~946.4M
🎯 Promosi: kemungkinan besar jika pace bertahan

🎯 Requirement pass rate: 3% (1/30)
🎯 Total gain bulanan: 347.0M
Promosi: 349.2M | Degradasi: 21.8M

⸻
Sync at: 11/6 22:05
```

### 7.7 Members Report

Command:

```text
/members
```

Purpose: show full member list.

Include:

- Active members with monthly gains and transfer badges
- Stale members
- Left members (this is the ONLY report that shows left members)

**Output format:**

```text
*👥 Daftar Anggota*

Hol＿Horse | A+ (#431)

• *GoldFamily* 🔄: 27.7M
• *RngF*: 19.2M
• *jgd*: 7.5M
• *Kuro* 🚪: 0

*🚪 Anggota yang sudah keluar:*

• Former Member (terakhir: 5 Juni 2026)
```

Note: Members report has no sync footer (it is a list, not a performance report).

### 7.8 Compare Report

Command:

```text
/compare MemberA MemberB
```

Include monthly gain, latest daily gain, weekly gain, average daily gain, requirement status, and winner by selected period.

**Output format:**

```text
*⚔️ Compare: Ryu vs GoldFamily — 11 Juni 2026*

• *Ryu*: 15.4M (harian: +1.6M, mingguan: +14.3M)
• *GoldFamily* 🔄: 27.7M (harian: +2.7M, mingguan: +14.3M)

Pemenang: *GoldFamily* (+12.3M)

⸻
Sync at: 11/6 22:05
```

### 7.9 Analyze Report

Command:

```text
/analyze MemberName
```

Include monthly gain, latest daily gain, 3-day average, 7-day average, consistency score, active days, projected month-end gain, requirement status, transfer information, and trend direction.

**Output format:**

```text
*🔍 Analyze: Ryu — 11 Juni 2026*

Bulan: 15.4M (target: 20.0M)
Harian: +1.6M
Rata-rata 3 Hari: 1.5M
Rata-rata 7 Hari: 1.4M
Konsistensi: 85%
Hari aktif: 9 dari 11
Proyeksi akhir bulan: ~42.3M

Status: ❌ kurang 4.6M
Transfer: tidak
Trend: naik

⸻
Sync at: 11/6 22:05
```

### 7.10 Tier Report

Command:

```text
/tier
```

Purpose: show promotion gap, demotion buffer, required pace, current pace, risk level, and projected outcome.

**Output format:**

```text
*🏆 Tier Intelligence*

Hol＿Horse | A+ (#431)
Data: 11 Juni 2026, 22:00 WIB
Promosi: 349.2M fans lagi
Degradasi: buffer 21.8M

Pace saat ini: 31.7M/hari
Pace butuh: 18.4M/hari

Sisa hari: 19
✅ Proyeksi: Promosi 🎉

⸻
Sync at: 11/6 22:05
```

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
  includeTransferDataInCalculation: false
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

Only trigger when the member has enough history, the 7-day average is meaningful, the member is active, and the day is not a transfer baseline artifact. Transfer members are excluded — their rolling average is inflated by transfer baseline artifacts which produce false positives.

### 10.2 Demotion Imminent

Trigger:

```text
demotion buffer < 3 days of current pace
```

### 10.3 Streak Break

Trigger when a current active member had an active streak and latest valid day gain is `0`.

Do not trigger for stale data, missing snapshots, transfer members (their baseline artifacts cause false streak breaks), or known left members.

### 10.4 New Transfer

Trigger when a member appears with `previous_circle_name` and has not already been seen in alert state.

### 10.5 Rank Drop

Trigger:

```text
monthly_rank - yesterday_rank > configured threshold
```

Default threshold: 10 positions.

### 10.6 Quiet Hours

Quiet hours suppress all alerts during a configurable time window.

```yaml
alerts:
  quietHours:
    enabled: false
    start: "23:00"
    end: "06:00"
```

Rules:

- Time range uses the display timezone (`config.timezone`)
- All alert types are suppressed during quiet hours (performance drop, demotion risk, streak break, new transfer, rank drop)
- Suppressed alerts are not queued or resent — they are simply dropped
- Alert deduplication state DOES update during quiet hours (alerts are recorded as sent) to prevent duplicate sends when quiet hours end

### 10.7 Catch-Up Alerts

Alerts detected during catch-up are aggregated instead of sent one-by-one.

Example:

```text
_[catch-up alerts]_

7 Penurunan performa terdeteksi
1 Streak terputus terdeteksi
6 Transfer baru terdeteksi
```

---

## 11. Auto-Delivery and Catch-Up

All schedule times use the display timezone (default WIB).

```text
22:05 — Daily report
22:05 — Weekly report on days 7, 14, 21, 28
22:12 — Monthly report on day 1
```

Collision rule: if two or more report types are scheduled at the same time on the same day, send one combined report with shared header and footer. Do not send duplicate separate reports unless explicitly configured. Supported collision pairs: daily+weekly, daily+monthly, weekly+monthly.

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

### 12.1 Help Command

The `/help` command is available to everyone, everywhere — command groups, unconfigured groups, private chats, and from both admins and non-admins. It bypasses access control entirely and requires no snapshot.

Admin-specific commands are only shown in the help output when the sender is an admin.

### 12.2 Report Commands

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

### 12.3 Admin Commands

Admin commands are restricted to configured admin JIDs.

Admin commands include:

```text
/setreq
/config
/status private details
/catchup on|off
/alerts on|off
/schedule — not yet implemented (placeholder)
```

### 12.4 Automatic Delivery

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
  includeTransferDataInCalculation: false

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
  staleAfterDaysDaily: 0
  staleAfterDaysWeekly: 3
  staleAfterDaysMonthly: 7

message:
  maxLength: 4096
  splitAtNewline: true
  language: id

logging:
  level: info
  logFile: data/logs/bot.log
  maxSizeMB: 5
  maxFiles: 3
  console: true
```

Admin setting changes must persist immediately and apply without restart whenever possible. If restart is required, the bot must say so clearly.

### 13.1 Logging

The bot uses a structured logger with configurable levels and file output.

```yaml
logging:
  level: info
  logFile: data/logs/bot.log
  maxSizeMB: 5
  maxFiles: 3
  console: true
```

Log levels:

| Level | Purpose |
|-------|---------|
| `debug` | Internal operations: snapshot skips, cache hits, dedup checks |
| `info` | Significant events: startup, report sent, alerts detected, catch-up |
| `warn` | Degraded state: stale data, reconnect attempts, edit fallbacks |
| `error` | Failures: fetch errors, delivery failures, unhandled exceptions |

Rules:

- Every log line includes timestamp (ISO 8601), level tag, and source tag: `[2026-06-14T22:05:00.000Z] [INFO] [Scheduler] ...`
- Source tags identify the subsystem: `Bot`, `Config`, `WhatsApp`, `Scheduler`, `CatchUp`, `Report`, `Alert`, `Data`, `API`, `Dispatch`
- Console output uses ANSI colors (gray=debug, cyan=info, yellow=warn, red=error)
- File output goes to `logging.logFile` (default: `data/logs/bot.log`)
- When file exceeds `logging.maxSizeMB`, it rotates: current → `bot-1.log`, old files shift, oldest beyond `logging.maxFiles` is deleted
- Logging level changes via config hot-reload take effect immediately
- File logging is best-effort — errors in file I/O never crash the bot

### 13.2 Config Change Sources

Config can be changed from two sources:

1. **Manual edits** — user edits `config.yaml` directly while the bot is running
2. **Admin commands** — user runs `/setreq`, `/catchup`, `/alerts` via WhatsApp

Both sources must coexist without data loss. Rules:

- Admin commands read the **latest config from disk** before applying their change, then write back. This preserves any manual edits made since the last reload.
- The file watcher detects manual edits via mtime + content hash polling (every 5 seconds).
- When both sources fire within one polling cycle, the admin command write wins (it writes the merged result of latest-disk + admin-change).
- Config changes apply to all subsystems immediately via getter pattern: `getConfig: () => BotConfig`.

---

## 14. Architecture and Persistence

The system is a single Node.js service. One process handles WhatsApp connection, HTTP API, scheduling, data fetching, data processing, and report delivery.

There is no separate cache layer. uma.moe data is static between daily updates, so snapshot files are the serving layer and historical source of truth.

The system uses snapshot files plus SQLite.

Snapshot files store raw API responses for historical report generation, catch-up recovery, and audit/debugging.

SQLite stores operational state.

Structured logging covers all subsystems (see section 13.1). Log output goes to console and rotating file.

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
performance_drop:2026-06-12:viewer_id
new_transfer:2026-06:viewer_id
rank_drop:2026-06-12
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

Used for audit trail and transfer detection.

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
Aku pakai snapshot terakhir: 12 Jun 2026.
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

Messages over the configured `message.maxLength` (default 4096) must be split at newline boundaries. Each part is prefixed with a `Part X/Y\n` marker where X is the part number and Y is the total parts. The marker overhead (up to 20 characters) is reserved from the content budget so the final message stays within the limit.

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

## 18. WhatsApp Message Formatting

All user-facing WhatsApp messages use WhatsApp's built-in formatting syntax. Report generators must apply these styles to improve readability on mobile screens.

### 18.1 Available Styles

**Bold** — for headers, emphasis, and key values:

```text
*bold text*
```

**Italics** — for secondary info, labels, and subtle emphasis:

```text
_italic text_
```

**Strikethrough** — for deprecated or removed values:

```text
~strikethrough text~
```

**Monospace** — for code, numbers, or alignment-sensitive data:

```text
`monospace text`
```

**Combined** — styles can be nested:

```text
*_bold italic_*
```

### 18.2 Structured Formatting

**Bulleted lists** — for member listings and item groups:

```text
* Header
- Item 1
- Item 2
```

**Numbered lists** — for ranked listings:

```text
1. First
2. Second
3. Third
```

**Block quotes** — for callouts and warnings:

```text
> This is a block quote
```

### 18.3 Report Formatting Rules

Reports follow these formatting conventions:

| Element | Style | Example |
|---------|-------|---------|
| Report title | Bold with emoji inside | `*📊 Daily Report — 11 Juni 2026*` |
| Club name and tier | Plain with rank in parens | `Hol＿Horse \| A+ (#431)` |
| Data line | Plain | `Data: 11 Juni 2026, 22:00 WIB` |
| Context lines | Plain | `Promosi: 349.2M fans lagi` |
| Summary line | Plain with emoji | `👥 27 kontribusi dari 30 anggota \| Total: 32.3M` |
| Section headers | Bold with emoji | `*⚠️ Belum aktif hari ini:*` |
| Member rank + name | Bold name | `1. *Ryu* — +1.2M` |
| Transfer badge | Suffix after name | `*Sairen* 🔄 — +14.3M` |
| Requirement status | Emoji prefix | `✅ pass` / `❌ kurang X` |
| Key numbers | Plain with separator | `32.300.000` |
| Sync footer | Separator + plain | `⸻\nSync at: 11/6 22:05` |

### 18.4 Formatting Constraints

- WhatsApp does not support nested bold within bold. Avoid `**double asterisks**`.
- Maximum message length: `message.maxLength` (default 4096 characters).
- Messages exceeding the limit are split at newline boundaries with `Part X/Y` markers.
- Formatting markers count toward the character limit.
- Bold markers `*...*` are invisible in rendered WhatsApp — they only appear in raw text.

---

## 19. Core Invariants

These rules must always hold:

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
15. Single Node.js process handles all concerns.
16. No cache layer — snapshot files serve as the data layer.
17. REST API binds to localhost by default.
18. Member status is exactly one of: active, stale, left. Transfer is a badge, not a status.
19. Left members are only shown in `/members`.
20. Snapshot filenames use JST data day.
21. Reports exclude left members.
22. Quiet hours suppress all alert types during the configured window.
23. Config changes via admin commands or manual file edits apply without restart. All subsystems (scheduler, catch-up, alerts) read the latest config on every operation.
24. All reports use WhatsApp formatting (bold, lists, emoji) per section 18.
25. Admin config commands read the latest config from disk before applying changes, preserving manual edits.
26. Config file watching uses both mtime and content hash to detect changes reliably.
27. Transfer members are excluded from performance drop and streak break alerts (baseline artifacts cause false positives).
