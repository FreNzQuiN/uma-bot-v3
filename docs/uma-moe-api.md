# uma.moe — Technical Documentation

> Reverse-engineered from the live Angular frontend (`prod-build.71.1`) and full API probing via Playwright token harvest.
> Last verified: June 9, 2026

## Overview

uma.moe is a comprehensive Umamusume: Pretty Derby community platform built on the `honsemoe-backend` (v1.0.0). It provides:
- **Circle (Club) Profiles** — daily fan progress, member stats, club rankings
- **Rankings** — monthly, all-time, and rolling gains leaderboards
- **User Profiles** — trainer stats, fan history, inheritance data, team stadium
- **Search** — trainer/inheritance lookup with pagination
- **Activity Tracking** — play-style analytics ("shame" system)
- **Game Version Data** — app version and resource version tracking

## API

### Base URL
`https://uma.moe`

### Backend
- **Service name:** `honsemoe-backend`
- **Backend repo:** `https://github.com/uma-moe/umamoe-backend`

### Authentication

The API is protected by **Cloudflare Turnstile** with a multi-layer auth pipeline:

1. Open `https://uma.moe` in a headless browser (Chromium)
2. Turnstile auto-solves and sets a cookie or returns a header
3. Extract the token from either:
   - **Response header:** `x-browser-proof`
   - **Cookie:** `uma_browser_proof`
4. Use the token in subsequent API requests as `X-Browser-Proof` header

**Token characteristics:**
- Cached for ~240 seconds (4 minutes)
- Refreshed automatically on 401/403 responses
- Harvested via Playwright with anti-detection flags
- JWT format (~401 chars)

---

## Endpoints

### Public (No Auth Required)

#### `GET /api/health`

Health check + endpoint manifest.

```json
{
  "endpoints": {
    "circles": "/api/v4/circles",
    "health": "/api/health",
    "rankings": "/api/v4/rankings",
    "search": "/api/v3/search",
    "stats": "/api/stats",
    "tasks": "/api/tasks"
  },
  "service": "honsemoe-backend",
  "status": "healthy",
  "timestamp": "2026-06-09T10:49:55Z",
  "version": "1.0.0"
}
```

#### `GET /api/stats`

Platform statistics.

```json
{
  "today": { "tasks_24h": 314783 },
  "freshness": {
    "accounts_24h": 169042,
    "accounts_7d": 2248838,
    "umas_tracked": 24938815
  }
}
```

#### `GET /api/ver`

Current game version.

```json
{
  "app_version": "1.22.0",
  "resource_version": "10006300",
  "updated_at": "2026-06-04T10:00:11"
}
```

#### `GET /api/ver/history`

Game version history. Returns `current` + `history` array of past versions.

---

### Protected (X-Browser-Proof Required)

#### `GET /api/v4/circles`

Fetch circle (club) data for a specific month.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| circle_id | integer | Yes | The circle's unique ID |
| year | integer | Yes | Year (e.g., 2026) |
| month | integer | Yes | Month (1-12) |

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `circle.circle_id` | int | Club ID |
| `circle.name` | str | Club name |
| `circle.comment` | str | Club description |
| `circle.leader_viewer_id` | int | Leader's viewer ID |
| `circle.leader_name` | str | Leader's display name |
| `circle.member_count` | int | Number of members |
| `circle.join_style` | int | Join policy (2=open, 3=approval) |
| `circle.policy` | int | Play style code |
| `circle.created_at` | str | Club creation ISO timestamp |
| `circle.last_updated` | str | Last data update ISO timestamp |
| `circle.monthly_rank` | int | Current month ranking |
| `circle.monthly_point` | int | Total monthly fans |
| `circle.last_month_rank` | int? | Previous month rank |
| `circle.last_month_point` | int? | Previous month fans |
| `circle.archived` | bool | Whether club is archived |
| `circle.yesterday_updated` | str? | Yesterday's update time |
| `circle.yesterday_points` | int? | Yesterday's total fans |
| `circle.yesterday_rank` | int? | Yesterday's rank |
| `circle.live_points` | int? | Live event points (null if no event) |
| `circle.live_rank` | int? | Live event rank |
| `circle.last_live_update` | str? | Last live update time |
| `club_rank` | int | Club tier rank (1-11) |
| `fans_to_next_tier` | int | Fans needed for promotion to next tier |
| `fans_to_lower_tier` | int | Fans above demotion threshold (buffer before dropping) |
| `yesterday_fans_to_next_tier` | int | Yesterday's promotion threshold (changes daily) |
| `yesterday_fans_to_lower_tier` | int | Yesterday's demotion threshold (changes daily) |
| `members[].id` | int | Internal DB ID |
| `members[].viewer_id` | int | Trainer's viewer ID |
| `members[].trainer_name` | str | Display name |
| `members[].shame_score` | int? | Activity score (null if not tracked) |
| `members[].daily_fans` | int[] | 32-element cumulative daily fans |
| `members[].last_updated` | str | Last update ISO timestamp |
| `members[].previous_circle_id` | int? | Transfer source club ID |
| `members[].previous_circle_name` | str? | Transfer source club name |
| `members[].next_month_start` | int? | Projected starting fans for next month (appears in some months) |

#### `daily_fans` Array

The `daily_fans` array is a 32-element list representing cumulative fan counts for each day of the month:

- **Index 0** = Day 1, **Index 30** = Day 31, **Index 31** = unused/padding
- **Positive values** = cumulative total fans at end of that day
- **Zero** = no data yet (member hasn't contributed or hasn't joined)
- **Negative values** = transfer indicator (member transferred from another club)

**Calculating daily gain:**
```
day_gain = daily_fans[today] - daily_fans[yesterday]
```

**Transfer handling:**
- When `daily_fans[0] < 0`, the member transferred into this club
- `previous_circle_id` and `previous_circle_name` indicate the source club
- Use absolute values (`abs()`) to include transfer data in calculations

---

#### `GET /api/v4/circles/list`

List all tracked circles ranked by monthly performance. Returns the full list (no pagination).

**Response:**
```json
{
  "circles": [
    {
      "circle_id": 717148109,
      "name": "NFlight",
      "comment": "...",
      "leader_viewer_id": 730620603141,
      "leader_name": "Iruzze",
      "member_count": 27,
      "join_style": 2,
      "policy": 11,
      "created_at": "2025-08-01T16:56:41Z",
      "monthly_rank": 1,
      "monthly_point": 3341201781,
      "last_month_rank": 339,
      "last_month_point": 1214018314,
      "archived": false,
      "yesterday_points": 2902527869,
      "yesterday_rank": 1,
      "live_points": 3686434646,
      "live_rank": 1,
      "club_rank": 11
    }
  ]
}
```

---

#### `GET /api/v4/circles/rank-thresholds`

Returns the current rank tier thresholds with fan requirements.

**Response:**
```json
{
  "thresholds": [
    {
      "rank_index": 11,
      "name": "SS",
      "ranking_from": 1,
      "ranking_to": 10,
      "current_min_fans": 1290545796,
      "current_fans_per_day": 161318225,
      "yesterday_min_fans": 998298687,
      "yesterday_fans_per_day": 142614099,
      "daily_fans_delta": 292247109,
      "last_month_min_fans": 4353881664,
      "last_month_fans_per_day": 140447796,
      "current_vs_last_month_delta": -3063335868
    }
  ]
}
```

---

#### `GET /api/v4/rankings/monthly`

Monthly trainer rankings (top performers).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| year | integer | Yes | Year |
| month | integer | Yes | Month (1-12) |

**Response fields:**
| Field | Type | Description |
|-------|------|-------------|
| `viewer_id` | int | Trainer ID |
| `trainer_name` | str | Display name |
| `shame_score` | int | Activity score (0-100) |
| `total_fans` | int | Total cumulative fans |
| `monthly_gain` | int | Fans gained this month |
| `active_days` | int | Days with activity |
| `avg_daily` | float | Average daily gain |
| `avg_3d` | float | 3-day rolling average |
| `avg_7d` | float | 7-day rolling average |
| `avg_monthly` | float | Monthly average |
| `rank` | int | Monthly ranking position |
| `circle_id` | int | Current club ID |
| `circle_name` | str | Current club name |
| `next_month_start` | int? | Starting fans for next month |

---

#### `GET /api/v4/rankings/alltime`

All-time trainer rankings.

**Response fields (additional to monthly):**
| Field | Type | Description |
|-------|------|-------------|
| `total_gain` | int | Total fans gained (excl. starting) |
| `avg_day` | float | All-time daily average |
| `avg_week` | float | All-time weekly average |
| `avg_month` | float | All-time monthly average |
| `rank_total_fans` | int | Rank by total fans |
| `rank_total_gain` | int | Rank by total gain |
| `rank_avg_day` | int | Rank by daily average |
| `rank_avg_week` | int | Rank by weekly average |
| `rank_avg_month` | int | Rank by monthly average |

---

#### `GET /api/v4/rankings/gains`

Rolling gains rankings (3d/7d/30d).

**Response fields:**
| Field | Type | Description |
|-------|------|-------------|
| `gain_3d` | int | Fans gained in last 3 days |
| `gain_7d` | int | Fans gained in last 7 days |
| `gain_30d` | int | Fans gained in last 30 days |
| `rank_3d` | int | Rank by 3-day gain |
| `rank_7d` | int | Rank by 7-day gain |
| `rank_30d` | int | Rank by 30-day gain |

---

#### `GET /api/v4/user/profile/{account_id}`

Full user profile with trainer data, fan history, inheritance, and team stadium.

**Response sections:**

| Section | Description |
|---------|-------------|
| `trainer` | Account info, trophies, team stadium stats, release counts |
| `circle` | Current club membership |
| `circle_history` | Monthly club membership history |
| `fan_history.monthly` | Monthly fan stats (total_fans, gain, rank, averages) |
| `fan_history.rolling` | Rolling 3d/7d/30d gains and ranks |
| `fan_history.alltime` | All-time fan stats with multi-dimensional ranking |
| `inheritance` | Full inheritance data (sparks, factors, race results, saddles) |
| `support_card` | Equipped support card |
| `team_stadium` | Team stadium lineup (15 entries: 5 distances x 3 members) |
| `veterans` | Veteran horse data (if any) |

---

#### `GET /api/v4/shame/hall`

Activity feed — tracks play patterns across all users.

**Response fields per entry:**
| Field | Type | Description |
|-------|------|-------------|
| `viewer_id` | int | Trainer ID |
| `trainer_name` | str | Display name |
| `circle_id` | int | Club ID |
| `circle_name` | str | Club name |
| `circle_monthly_rank` | int | Club's monthly rank |
| `first_seen` | str | First observation timestamp |
| `last_seen` | str | Last observation timestamp |
| `days_observed` | int | Total days observed |
| `days_active` | int | Days with activity |
| `total_active_seconds` | int | Total active time in seconds |
| `total_fan_gain` | int | Total fans gained |
| `total_careers` | int | Total career runs |
| `avg_careers_per_day` | float | Average careers per day |
| `careers_per_active_hour` | float | Career rate per active hour |
| `career_rate_breakdown` | object | Rate breakdown by time window (all/30d/7d/3d/last20) |
| `avg_career_length_last20_seconds` | float | Average career length |
| `career_length_buckets` | int[] | Career length distribution |

---

#### `GET /api/v4/shame/viewer/{viewer_id}`

Individual shame/activity data for a specific trainer.

**Response:**
```json
{
  "score": 100,
  "daily": [...],
  "heatmap": [...],
  "top_sessions": [...],
  "short_career_snapshots": [...],
  "short_career_snapshots_total": 42,
  "last_refreshed_at": "2026-06-05T20:48:41Z"
}
```

Returns empty arrays and `null` score for untracked users.

---

#### `GET /api/v3/search`

Search for trainers/inheritance records. Paginated.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | No | Search by trainer name (partial match) |
| page | integer | No | Page number (0-indexed, default: 0) |
| limit | integer | No | Items per page (default: 20) |

**Note:** The `q` parameter causes a 500 "Database error occurred" — this is a **backend bug**. Use `name` instead.

**Response:**
```json
{
  "items": [
    {
      "account_id": "540903147493",
      "trainer_name": "UUC｜FishPineApl",
      "follower_num": 700,
      "last_updated": "2026-06-08T13:48:25Z",
      "inheritance": { ... },
      "support_card": { ... }
    }
  ],
  "total": "over 10000",
  "page": 0,
  "limit": 20,
  "total_pages": 501
}
```

**Note:** `total` is a string `"over 10000"` (soft cap), not an integer.

---

#### `GET /api/v3/count`

Count total inheritance records and support card accounts.

**Response:**
```json
{
  "available_inheritance_records": 2311801,
  "available_support_card_accounts": 2311807,
  "total_inheritance_records": 2312248,
  "total_support_card_accounts": 2312254
}
```

---

## Non-Working Endpoints

| Endpoint | Status | Reason |
|----------|--------|--------|
| `GET /api/v3/search?q=...` | 500 | Backend bug — `q` param triggers DB error. Use `name` |
| `GET /api/v4/user/profile/veterans/{id}` | 400/404 | Requires UUID format, not numeric ID |
| `GET /api/tasks` | 404 | Listed in health but doesn't exist (deprecated?) |
| `GET /api/v4/tasks` | 404 | Doesn't exist |
| `GET /api/v4/search` | 404 | Doesn't exist — search is v3 only |

---

## Club Tier System

| Rank | Tier | Ranking Range |
|------|------|---------------|
| 11 | SS | 1-10 |
| 10 | S+ | 11-30 |
| 9 | S | 31-100 |
| 8 | A+ | 101-500 |
| 7 | A | 501-1000 |
| 6 | B+ | 1001-3000 |
| 5 | B | 3001-5000 |
| 4 | C+ | 5001-7000 |
| 3 | C | 7001-10000 |
| 2 | D+ | 10001+ |
| 1 | D | Unranked |

### Join Style Codes
| Code | Meaning |
|------|---------|
| 2 | Open (auto-join) |
| 3 | Approval required |

### Policy Codes (Club Play Style)
| Code | Observed Usage |
|------|----------------|
| 2 | Everlast family |
| 3 | Mixed/casual |
| 5 | Endless family |
| 10 | Competitive (most common) |
| 11 | Ultra-competitive (top clubs) |
| 12 | Dominator/Regalia family |

## Data Refresh

- **Snapshot time:** 00:00 JST (daily)
- **Live data:** Available during events via `live_points` and `live_rank`
- **Cache strategy:** Server caches responses with configurable TTL (default 300s)

## Known Quirks

1. **Full-width characters** in circle/trainer names (e.g., `Hol＿Horse` uses fullwidth underscore `_`)
2. **Turnstile protection** requires browser-based token harvesting (no simple HTTP auth)
3. **Token expires** after ~5 minutes; server handles automatic refresh
4. **401/403 responses** trigger token refresh and retry (up to 3 attempts)
5. **daily_fans can be negative** — indicates club transfer, not data corruption
6. **Search `q` param is broken** — returns 500 "Database error occurred". Use `name` param instead
7. **Search `total` is a string** — returns `"over 10000"` instead of an integer (soft cap)
8. **Veterans endpoint requires UUID** — not numeric viewer_id. Returns 400 with numeric IDs
9. **`/api/tasks` is listed in health but returns 404** — likely deprecated or internal-only


