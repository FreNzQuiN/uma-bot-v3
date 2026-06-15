# Uma Club Bot v3 — System Specification

> A WhatsApp bot for Uma Musume club management.
> This is the single source of truth for what the system does, how it works, and what to build.

---

## 1. Context

### 1.1 What is this?

A WhatsApp bot that automatically tracks club member performance in Uma Musume: Pretty Derby and delivers reports, alerts, and intelligence to the club leader.

### 1.2 Who is it for?

Club leaders who manage 30+ members in competitive clubs. They need to:
- Track daily/weekly/monthly fan contributions
- Identify underperformers before it's too late
- Know if the club is promoting or demoting
- Make decisions about member retention
- Communicate performance data to members

### 1.3 What data powers it?

The bot pulls data from uma.moe, a community platform that scrapes Uma Musume game data once daily at 00:00 JST (22:00 WIB).

**Key data characteristics:**
- Data updates exactly once per day
- Between updates, data is completely static
- Each API response contains the entire month's cumulative data
- One fetch gives you everything needed for all reports

**Available data from uma.moe:**
- Club metadata: name, rank, tier, fans, member count
- Per-member: cumulative daily fans (32-element array), transfer history
- Club rankings: rank among all tracked clubs
- Tier thresholds: exact fans needed for promotion/demotion
- Global trainer rankings: monthly, all-time, rolling averages

---

## 2. User Stories

### Epic 1: Club Reports

| ID | Story |
|----|-------|
| US-01 | As a member, I want to see today's fan gains for all active members |
| US-02 | As a member, I want to see past days' data (N days back) |
| US-03 | As a member, I want to see this week's 7-day block growth |
| US-04 | As a member, I want to see full monthly progress for all members |
| US-05 | As a member, I want to see the top 10 leaderboard with medals |
| US-06 | As a member, I want to see who is below requirement and by how much |
| US-07 | As a member, I want to see club overview stats |
| US-08 | As a member, I want to see the full member list with gains |
| US-09 | As a member, I want to compare two members side-by-side |
| US-10 | As a member, I want to see detailed analysis of a single member |

### Epic 2: Auto-Delivery

| ID | Story |
|----|-------|
| US-11 | As a leader, I want daily reports sent automatically to the announcement group |
| US-12 | As a leader, I want weekly reports on days 7, 14, 21, 28 |
| US-13 | As a leader, I want a monthly report on the 1st of each month |
| US-14 | As a leader, I want the bot to handle schedule conflicts without duplicates |
| US-15 | As a leader, I want configurable report schedules |

### Epic 3: Transfer & Member Intelligence

| ID | Story |
|----|-------|
| US-16 | As a leader, I want transferred members marked with their source club |
| US-17 | As a leader, I want to see how much transferred members brought |
| US-18 | As a leader, I want to see each member's activity streak |
| US-19 | As a leader, I want to see member consistency scores |
| US-20 | As a leader, I want rolling averages (3-day, 7-day) per member |
| US-21 | As a leader, I want to see which members are trending up or down |
| US-22 | As a leader, I want to know when a member's performance drops |

### Epic 4: Tier Intelligence

| ID | Story |
|----|-------|
| US-23 | As a leader, I want to see exact fans needed to promote |
| US-24 | As a leader, I want to see daily pace required to promote |
| US-25 | As a leader, I want to know if we are at risk of demotion |
| US-26 | As a leader, I want tier data in every report header |
| US-27 | As a leader, I want a promotion countdown with projected outcome |

### Epic 5: Competitive Context

| ID | Story |
|----|-------|
| US-28 | As a leader, I want to see how our club ranks among all tracked clubs |
| US-29 | As a leader, I want to see clubs in our tier band |
| US-30 | As a leader, I want to see our rank movement over recent days |

### Epic 6: Smart Alerts

| ID | Story |
|----|-------|
| US-31 | As a leader, I want alerts when a member's gain drops below threshold |
| US-32 | As a leader, I want alerts when demotion is imminent |
| US-33 | As a leader, I want alerts when a member's streak breaks |
| US-34 | As a leader, I want alerts when a new member transfers in |
| US-35 | As a leader, I want alerts when club rank drops significantly |
| US-36 | As a leader, I want configurable alert thresholds and quiet hours |

### Epic 7: Intermittent Operation

| ID | Story |
|----|-------|
| US-37 | As a user, I want the bot to detect which reports were missed while off |
| US-38 | As a user, I want catch-up reports sent on restart |
| US-39 | As a user, I want all historical data preserved across restarts |
| US-40 | As a user, I want one fetch to recover full month data after being off |
| US-41 | As a user, I want catch-up reports tagged so users know they're not live |
| US-42 | As a user, I want the option to disable catch-up |

### Epic 8: Data & Architecture

| ID | Story |
|----|-------|
| US-43 | As an admin, I want persistent storage for historical queries |
| US-44 | As an admin, I want single-service deployment |
| US-45 | As an admin, I want incremental computation |
| US-46 | As an admin, I want a REST API for programmatic access |

### Epic 9: Administration

| ID | Story |
|----|-------|
| US-47 | As an admin, I want to view and change club requirement |
| US-48 | As an admin, I want to view bot status and configuration |
| US-49 | As an admin, I want admin commands restricted to configured JIDs |
| US-50 | As an admin, I want config changes to apply without restart |

### Epic 10: Error Handling

| ID | Story |
|----|-------|
| US-51 | As a user, I want the bot to work when uma.moe is temporarily down |
| US-52 | As a user, I want human-like error messages |
| US-53 | As a user, I want long reports split into multiple messages |
| US-54 | As a user, I want a loading indicator while fetching |
| US-55 | As a user, I want the bot to reconnect if WhatsApp drops |

---

## 3. User Requirements

### FR-01: Report Generation

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-01.1 | Daily report with offset | Per-member daily gain, sorted desc, total summary, sync footer. Offset 0=today, N=N days back. | daily_fans array |
| FR-01.2 | Weekly 7-day block report | Fixed blocks: 1-7, 8-14, 15-21, 22-28, 29-31. Offset shifts by week. | daily_fans array |
| FR-01.3 | Monthly report | All members with monthly_gain, sorted desc. Inactive listed separately. Offset 0-12 months. | daily_fans array |
| FR-01.4 | Top 10 leaderboard | Top 10 active by monthly_gain. Medals for top 3. | daily_fans array |
| FR-01.5 | Bottom/at-risk report | Active members below requirement, sorted by deficit. Max 10. | daily_fans + requirement |
| FR-01.6 | Club stats | Member count, total gain, average, top member, requirement pass rate. | daily_fans + requirement |
| FR-01.7 | Member list | Active with gains + Left (names only). Summary line. | daily_fans array |
| FR-01.8 | Member comparison | Two members: monthly, daily, total fans, req status, winner. | daily_fans array |
| FR-01.9 | Member analysis | Monthly progress %, AVG weekly/daily, req status, projected, streak. | daily_fans array |
| FR-01.10 | Combined daily+weekly | Merged report for schedule collision days. | daily_fans array |

### FR-02: Enhanced Reports

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-02.1 | Transfer badge | Transferred members show `(from {club_name})`. | previous_circle_name |
| FR-02.2 | Streak display | `🔥N` after member name in daily and members reports. | Computed |
| FR-02.3 | Tier info in headers | fans_to_next_tier and fans_to_lower_tier in headers. | Circle data |
| FR-02.4 | Rank change in headers | Yesterday rank and delta in headers. | Circle data |
| FR-02.5 | Projected monthly | Projected end-of-month per member in stats. | Computed |
| FR-02.6 | Today vs yesterday | Daily report shows delta vs previous day. | Two snapshots |
| FR-02.7 | Zero-gain filter | Members with +0 excluded from daily/weekly lists. | Computed |
| FR-02.8 | Member count in headers | Every header includes active member count. | Computed |
| FR-02.9 | Stale data warning | When serving older snapshot, show warning. | Snapshot metadata |

### FR-03: Tier Intelligence

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-03.1 | Tier status report | Current tier, promotion gap, demotion buffer, daily pace required. | Circle + thresholds |
| FR-03.2 | Promotion gap | fans_to_next_tier with progress percentage. | Circle data |
| FR-03.3 | Demotion risk | fans_to_lower_tier with risk flag if buffer < 3 days pace. | Circle data |
| FR-03.4 | Required daily pace | (fans_to_next_tier / days_left) vs current pace. | Computed |
| FR-03.5 | Projected outcome | Will club promote/demote/stay based on current pace. | Computed |

### FR-04: Competitive Context

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-04.1 | Club rankings | Top N clubs by monthly_point. Our club highlighted. | /circles/list |
| FR-04.2 | Tier band peers | Clubs within same club_rank tier. | /circles/list |
| FR-04.3 | Rank movement | Daily rank snapshots stored, last 30 days queryable. | Snapshots |

### FR-05: Member Intelligence

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-05.1 | Member intel report | Per-member: consistency, rolling averages, trend, transfer impact. | Computed |
| FR-05.2 | Consistency score | active_days / days_elapsed as percentage. | Computed |
| FR-05.3 | Rolling averages | 3-day and 7-day rolling fan gain averages. | Computed |
| FR-05.4 | Trend detection | Accelerating (📈), stable (→), decelerating (📉). | Computed |
| FR-05.5 | Anomaly detection | Flag members with >50% drop from 7-day avg. | Computed |

### FR-06: Smart Alerts

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-06.1 | Performance drop alert | Daily gain < 50% of 7-day avg → warning. | Computed |
| FR-06.2 | Demotion imminent alert | fans_to_lower_tier buffer < 3 days pace. | Thresholds |
| FR-06.3 | Streak break alert | Active streak drops to 0. | Computed |
| FR-06.4 | New transfer alert | previous_circle_name appears for first time. | Snapshot delta |
| FR-06.5 | Rank drop alert | Club rank drops >10 positions in one day. | Snapshots |
| FR-06.6 | Configurable thresholds | Admin sets sensitivity and quiet hours. | Config |

### FR-07: Data Storage

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-07.1 | Snapshot-per-day | One JSON file per day containing full API response. Immutable. | /api/v4/circles |
| FR-07.2 | Historical snapshots | Queryable by date range. 12-month retention. | Snapshots |
| FR-07.3 | Rank threshold history | Daily fetch and store of tier thresholds. | /rank-thresholds |
| FR-07.4 | Circle list history | Periodic fetch of all tracked circles. | /circles/list |
| FR-07.5 | 12-month retention | Snapshots older than 12 months archived or deleted. | Policy |

### FR-08: Architecture

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-08.1 | Single Node.js service | One process handles WhatsApp (Baileys), API (Fastify), scheduling, data processing. | — |
| FR-08.2 | Snapshot-based serving | Requests served from snapshot files. No separate cache layer. | Snapshots |
| FR-08.3 | Token cache | Playwright token cached for 240 seconds. | Auth |
| FR-08.4 | Incremental computation | Compute once per snapshot, not per request. | — |
| FR-08.5 | REST API | Public endpoints for all reports. | — |

### FR-09: Intermittent Operation

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-09.1 | Missed schedule detection | On startup, compare last run vs expected schedule. | Schedule log |
| FR-09.2 | Catch-up delivery | Send missed reports in chronological order on restart. | Detected |
| FR-09.3 | Catch-up tagging | Reports marked as `[catch-up]`. | Formatting |
| FR-09.4 | Catch-up toggle | Admin can enable/disable catch-up. | Config |
| FR-09.5 | Month boundary | Previous month data preserved in old snapshots. | Snapshots |
| FR-09.6 | Single-fetch recovery | One API fetch recovers full month data. | Cumulative array |
| FR-09.7 | Alert deduplication | Multiple alerts for same event aggregated on restart. | Alert state |

### FR-10: Access Control & Error Handling

| Req | Requirement | Acceptance Criteria | Data Source |
|-----|------------|--------------------:|------------|
| FR-10.1 | Admin restriction | Admin commands only for configured JIDs. | Config |
| FR-10.2 | Command group restriction | Report commands only in command groups or by admin. | Config |
| FR-10.3 | Stale data fallback | If today's snapshot missing, use yesterday's with warning. | Snapshots |
| FR-10.4 | Fun error messages | Human-like Indonesian messages. | Message pool |
| FR-10.5 | Message splitting | Reports >4096 chars split at newline boundary. | — |
| FR-10.6 | Loading indicator | Random loading message while fetching. | — |
| FR-10.7 | Auto-reconnect | WhatsApp reconnection with exponential backoff. | — |

---

## 4. MoSCoW Prioritization

### MUST (31 features) — Blocks launch

| ID | Feature | Rationale |
|----|---------|-----------|
| US-01 | Daily report | Core feature |
| US-02 | Past days data | Core feature |
| US-03 | Weekly report | Core feature |
| US-04 | Monthly report | Core feature |
| US-05 | Top 10 leaderboard | Core feature |
| US-06 | Bottom/at-risk report | Core feature |
| US-07 | Club stats | Core feature |
| US-08 | Member list | Core feature |
| US-11 | Daily auto-report | Primary value — zero maintenance |
| US-12 | Weekly auto-report | Core scheduling |
| US-13 | Monthly auto-report | Core scheduling |
| US-14 | Schedule conflict handling | Prevents duplicates |
| US-16 | Transfer badge | 20%+ monthly turnover — leader needs to see who's new |
| US-22 | Performance drop detection | Catch problems early |
| US-23 | Fans to promote | Leader's #1 question |
| US-24 | Required daily pace | Actionable metric |
| US-25 | Demotion risk | Critical — prevent tier loss |
| US-26 | Tier data in headers | Context for every report |
| US-31 | Performance drop alert | Proactive problem detection |
| US-32 | Demotion imminent alert | Critical — prevent tier loss |
| US-37 | Missed schedule detection | Bot runs intermittently |
| US-38 | Catch-up reports | Don't lose reports because bot was off |
| US-39 | Snapshot preservation | Data must survive restarts |
| US-40 | Single-fetch recovery | One fetch recovers everything |
| US-43 | Persistent storage | Need historical queries |
| US-44 | Single-service deployment | Simplified ops |
| US-47 | Requirement view/set | Core admin |
| US-48 | Config/status view | Operational visibility |
| US-49 | Admin restriction | Security |
| US-51 | Stale data fallback | Resilience |
| US-53 | Message splitting | WhatsApp limit |

### SHOULD (21 features) — Important, v3 feels incomplete

| ID | Feature | Rationale |
|----|---------|-----------|
| US-09 | Member comparison | Useful but not daily-critical |
| US-10 | Member analysis | Useful but not daily-critical |
| US-15 | Configurable schedules | Flexibility |
| US-17 | Transfer impact | Shows contribution |
| US-18 | Activity streak | Engagement signal |
| US-19 | Consistency scores | Better decision data |
| US-20 | Rolling averages | Better trend signal |
| US-21 | Trend direction | "Who's slipping?" |
| US-27 | Promotion countdown | Nice visualization |
| US-28 | Club rankings | Competitive context |
| US-33 | Streak break alert | Engagement signal |
| US-34 | New transfer alert | Informational |
| US-36 | Configurable alerts | Different sensitivity |
| US-41 | Catch-up tagging | Users should know |
| US-42 | Catch-up toggle | Avoid restart spam |
| US-45 | Incremental computation | Performance |
| US-46 | REST API | Programmatic access |
| US-50 | Config hot-reload | Convenience |
| US-52 | Fun error messages | UX |
| US-54 | Loading indicator | UX |
| US-55 | Auto-reconnect | Reliability |

### COULD (6 features) — Nice to have

| ID | Feature | Rationale |
|----|---------|-----------|
| US-29 | Tier band peers | Nice but not actionable daily |
| US-30 | Rank movement history | Trend data |
| US-35 | Rank drop alert | Less urgent than demotion |

### WON'T (out of scope for v3)

| Feature | Why |
|---------|-----|
| Cross-club comparison | Complex name search, not core |
| Multiple data sources | Different auth, too complex |
| Activity/shame tracking | Data available but not actionable |
| Career run patterns | Too granular |
| Full trainer profiles | Not club-management-critical |

---

## 5. Data Flow

### 5.1 Data Lifecycle

```
uma.moe scrapes game data at 22:00 WIB
     │
     ▼
Data is STATIC for 24 hours
     │
     ▼
Bot fetches on-demand → saves snapshot
     │
     ▼
All requests served from snapshot
     │
     ▼
Next day 22:00 → new scrape → new snapshot
```

**One fetch per day. One snapshot per day. All commands use the same snapshot.**

### 5.2 Snapshot Model

```
data/snapshots/YYYY/MM/DD.json
```

- One file per day
- Contains raw API response (circle + all members + daily_fans)
- Immutable once saved
- Serves as historical record
- Serves as catch-up source

**Naming convention:** Filenames use the JST date of the scrape (00:00 JST). Since 00:00 JST = 22:00 WIB the previous day, a file named `2026/06/12.json` contains data through June 11 WIB. Display dates to users in WIB.

### 5.3 Request Flow

```
User sends command
     │
     ▼
Does today's snapshot exist?
     │
   YES → Read snapshot → Compute → Format → Serve
     │
   NO  → Fetch from uma.moe
           ├─ Token fresh? → Use cached token
           ├─ Token expired → Harvest via Playwright (5-10s)
           ├─ API call (< 1s)
           ├─ Save snapshot
           └─ Compute → Format → Serve
```

### 5.4 What Each Command Computes

All commands use the same snapshot. Different arithmetic:

| Command | Arithmetic |
|---------|-----------|
| `/daily` | `daily_fans[today] - daily_fans[yesterday]` |
| `/daily -1` | `daily_fans[yesterday] - daily_fans[day_before]` |
| `/weekly` | `daily_fans[end_of_week] - daily_fans[start_of_week]` |
| `/monthly` | `last_positive - first_positive` |
| `/ranks` | Same as monthly, top 10 |
| `/bottom` | Monthly gain, below requirement |
| `/stats` | Aggregate of monthly gains |
| `/members` | List of monthly gains |
| `/compare` | Two members' gains |
| `/analyze` | One member's full stats |

### 5.5 Auto-Delivery Schedule

```
22:05 WIB — Daily
22:05 WIB — Weekly (on days 7, 14, 21, 28)
22:12 WIB — Monthly (on day 1)
On collision days (daily + weekly), a combined daily+weekly report is sent.
```

### 5.6 Intermittent Operation

```
Bot OFF for 3 days
     │
     ▼
Bot restarts
     │
     ▼
Detect: daily reports missed for Day 1, Day 2, Day 3
     │
     ▼
Fetch from uma.moe (one call recovers all data)
     │
     ▼
Compute catch-up reports
     │
     ▼
Send tagged reports: [catch-up] Daily — 10 Juni 2026
```

### 5.7 Month Boundary

```
June 30: snapshot_06_30.json saved
July 1:  Bot OFF
July 2:  Bot ON → snapshot_07_02.json saved
```

- June data in `2026/06/30.json`
- July data in `2026/07/02.json`
- `/monthly -1` reads June snapshot → works

---

## 6. Future Capabilities (Out of Scope for v3)

### AI Integration

The system is designed to support AI integration via configurable API endpoints (9router, OpenAI-compatible, Anthropic-compatible). Potential uses:

- Natural language queries about club data
- AI-generated report summaries
- Smart alert messages in human tone
- Conversational member interactions

This is not in v3 scope but the architecture (single Node.js, HTTP APIs, snapshot data) makes it straightforward to add later.

---

## 7. System Requirements Summary

| Category | Count |
|----------|-------|
| MUST | 31 |
| SHOULD | 21 |
| COULD | 3 |
| WON'T | 5 |


| Area | Key Decisions |
|------|--------------|
| Storage | Snapshot-per-day, no cache layer |
| Architecture | Single Node.js service |
| Persistence | SQLite for historical queries |
| Token | Playwright harvest, 240s cache |
| Intermittent | Catch-up on restart, snapshot preservation |
| Alerts | Performance drop, demotion risk, streak break |
| Intelligence | Rolling averages, trends, consistency |
| AI | Ready for integration via HTTP API (future) |
