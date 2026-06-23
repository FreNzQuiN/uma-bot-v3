# Configuration Reference

All configuration lives in `config.yaml` (gitignored). Copy from `config.example.yaml` to get started.

```bash
cp config.example.yaml config.yaml
```

**Config is validated with Zod at load time.** Invalid values throw immediately with field-level error messages. The bot will not start with bad config.

## Hot-Reload

Config is watched via mtime polling every 5 seconds. Changes to `config.yaml` are picked up automatically:

- **Non-schedule changes** (groups, alerts, requirements, etc.) → in-memory config updates immediately.
- **Schedule changes** → scheduler is stopped and restarted with new cron expressions.
- **Any config change** triggers a scheduler restart to ensure all values are fresh.

No restart needed for config edits. The file watcher handles it.

## Full Schema

Below is every config field with its type, default, and what it does. Fields marked with **(required)** have no default and must be set.

---

### `circleId`

| | |
|---|---|
| **Type** | `number` (positive integer) |
| **Default** | `232229195` |
| **Required** | Yes (effectively — the default is a placeholder) |

Your Uma Musume circle ID. Found in the URL when viewing your circle on uma.moe.

```yaml
circleId: 232229195
```

---

### `timezone`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `Asia/Jakarta` |

IANA timezone for all dates and schedule times. The bot uses WIB (Asia/Jakarta, UTC+7).

```yaml
timezone: Asia/Jakarta
```

---

### `commands`

Bot command parsing settings.

```yaml
commands:
  prefixes: ["/"]
  maxDailyOffset: 31
  maxWeeklyOffset: 5
  maxMonthlyOffset: 12
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prefixes` | `string[]` | `["/"]` | Characters that trigger commands (e.g., `/daily`, `!daily`) |
| `maxDailyOffset` | `number` | `31` | Max day offset for `/daily` (e.g., `/daily -3`) |
| `maxWeeklyOffset` | `number` | `5` | Max week offset for `/weekly` |
| `maxMonthlyOffset` | `number` | `12` | Max month offset for `/monthly` |

---

### `admins`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` |

WhatsApp JIDs of bot administrators. Admins can use admin-only commands (`/setreq`, `/config`, `/status`, `/catchup`, `/alerts`, `/debug`) and all report commands from any context.

```yaml
admins:
  - "628xxxxxxxx@s.whatsapp.net"
```

**How to find a JID:** Send a message to the bot from the user's private chat. Check the log at `debug` level — the sender JID appears in the logs.

---

### `groups`

```yaml
groups:
  command:
    - "xxxx@g.us"
  announcement:
    - "yyyy@g.us"
  alertAdmin:
    - "zzzz@g.us"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `command` | `string[]` | `[]` | Groups where report commands are allowed for non-admins |
| `announcement` | `string[]` | `[]` | Groups where auto-delivered reports are sent |
| `alertAdmin` | `string[]` | `[]` | Groups/chats for admin alert delivery |

**How to find a group JID:** Add the bot to the group. Check logs at `debug` level.

**Access rules:**
- **Report commands** (daily, weekly, etc.) → allowed in `command` groups, or by admins anywhere.
- **Admin commands** (setreq, config, etc.) → only admins, only in `command` groups or private chats.
- **Auto-delivery** → only to `announcement` groups.
- **Alerts** → to admin JIDs (if `defaultRecipients: admin`) or `alertAdmin` groups.

---

### `requirements`

Fan requirements for members. If a member doesn't meet the monthly requirement, they show as "below target" in reports.

```yaml
requirements:
  monthlyFans: 20000000
  weeklyFans: 7000000
  weeksInMonthEquivalent: 4
  includeTransferDataInCalculation: false
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `monthlyFans` | `number` | `20000000` | Monthly fan requirement per member |
| `weeklyFans` | `number` | `0` | Weekly fan requirement per member |
| `weeksInMonthEquivalent` | `number` | `4` | Weeks per month for weekly→monthly derivation |
| `includeTransferDataInCalculation` | `boolean` | `false` | Whether to include transfer data in gain calculations |

**Why `weeksInMonthEquivalent`:** A month isn't exactly 4 weeks. This constant converts weekly requirements to monthly by multiplying: `weeklyFans × weeksInMonthEquivalent`.

---

### `schedule`

Auto-delivery schedule for reports. All times are in WIB (Asia/Jakarta).

```yaml
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
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `daily.enabled` | `boolean` | `true` | Enable daily reports |
| `daily.time` | `string` | `"22:05"` | Time to send daily reports (HH:MM) |
| `weekly.enabled` | `boolean` | `true` | Enable weekly reports |
| `weekly.days` | `number[]` | `[7, 14, 21, 28]` | Days of month to send weekly reports |
| `weekly.time` | `string` | `"22:05"` | Time to send weekly reports |
| `monthly.enabled` | `boolean` | `true` | Enable monthly reports |
| `monthly.day` | `number` | `1` | Day of month to send monthly report |
| `monthly.time` | `string` | `"22:12"` | Time to send monthly reports |

**Time format:** 24-hour `HH:MM`. Example: `"22:05"` = 10:05 PM WIB.

**Why 22:05?** uma.moe data updates at ~22:00 WIB. The 5-minute buffer lets the data settle.

**Collision handling:** When multiple report types are scheduled at the same time on the same day (e.g., daily + weekly both at 22:05 on the 7th), they are combined into a single WhatsApp message instead of two separate ones.

---

### `catchUp`

```yaml
catchUp:
  enabled: true
  maxReportsPerStartup: 10
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable missed report recovery on restart |
| `maxReportsPerStartup` | `number` | `10` | Max reports to send per startup |

**How catch-up works:**
1. Bot starts up.
2. Checks the database for the last successful run of each report type.
3. Compares against the most recent scheduled day.
4. If a report was missed, it sends it on startup.
5. Respects `maxReportsPerStartup` to avoid spam.
6. Colliding reports are combined into single messages.

**Why it exists:** The bot runs intermittently (on/off at unpredictable intervals). Catch-up ensures no report is permanently lost.

---

### `alerts`

```yaml
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
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master toggle for all alerts |
| `defaultRecipients` | `"admin" \| "group"` | `"admin"` | Where alerts go: admin JIDs or `alertAdmin` groups |

#### Performance Drop

Alerts when a member's today's gain drops below a threshold of their 7-day average.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `performanceDrop.enabled` | `boolean` | `true` | Enable performance drop alerts |
| `performanceDrop.thresholdPercent` | `number` | `50` | Alert when today's gain < X% of 7-day average |
| `performanceDrop.minHistoryDays` | `number` | `7` | Minimum days of data before triggering |

#### Demotion Risk

Alerts when the club is at risk of dropping a tier.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `demotionRisk.enabled` | `boolean` | `true` | Enable demotion risk alerts |
| `demotionRisk.bufferDays` | `number` | `3` | Alert when demotion buffer < X days of current pace |

#### Streak Break

Alerts when a member's consecutive active days streak breaks.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `streakBreak.enabled` | `boolean` | `true` | Enable streak break alerts |

#### New Transfer

Alerts when a new member transfers into the circle.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `newTransfer.enabled` | `boolean` | `true` | Enable new transfer alerts |

#### Rank Drop

Alerts when the circle's rank drops significantly. Disabled by default.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `rankDrop.enabled` | `boolean` | `false` | Enable rank drop alerts |
| `rankDrop.positions` | `number` | `10` | Alert when rank drops more than N positions |

#### Quiet Hours

Suppresses alerts during specified hours.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `quietHours.enabled` | `boolean` | `false` | Enable quiet hours |
| `quietHours.start` | `string` | `"23:00"` | Start of quiet period (HH:MM) |
| `quietHours.end` | `string` | `"06:00"` | End of quiet period (HH:MM) |

---

### `memberStatus`

Stale detection thresholds. A member is flagged as "stale" when they have zero-gain days for N consecutive days.

```yaml
memberStatus:
  staleAfterDaysDaily: 0
  staleAfterDaysWeekly: 3
  staleAfterDaysMonthly: 7
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `staleAfterDaysDaily` | `number` | `0` | Consecutive zero-gain days before stale (daily report) |
| `staleAfterDaysWeekly` | `number` | `3` | Consecutive zero-gain days before stale (weekly report) |
| `staleAfterDaysMonthly` | `number` | `7` | Consecutive zero-gain days before stale (monthly report) |

**Why different thresholds:** Daily reports are sensitive — even 1 zero day shows stale. Weekly gives more buffer. Monthly is the most lenient.

---

### `message`

```yaml
message:
  maxLength: 4096
  splitAtNewline: true
  language: id
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxLength` | `number` | `4096` | WhatsApp message character limit |
| `splitAtNewline` | `boolean` | `true` | Split long messages at newline boundaries |
| `language` | `string` | `"id"` | Language for bot messages (ISO 639-1) |

---

### `logging`

```yaml
logging:
  level: info
  logFile: data/logs/bot.log
  maxSizeMB: 5
  maxFiles: 3
  console: true
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` | Log level |
| `logFile` | `string` | `"data/logs/bot.log"` | Log file path (relative to project root) |
| `maxSizeMB` | `number` | `5` | Max file size in MB before rotation |
| `maxFiles` | `number` | `3` | Max rotated files to keep (0 = no rotation) |
| `console` | `boolean` | `true` | Also output logs to console |

**For debugging:** Set `level: debug` to see all message parsing, API calls, and scheduler decisions.

---

## Environment Variables

Optional, set in `.env` or shell:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3000` | REST API port |
| `WA_SESSION_DIR` | `data/auth` | WhatsApp session data directory |

These override config.yaml values when present. The `.env` file is gitignored.

---

## Common Config Patterns

### Minimal Setup

Only `circleId` and `admins` are effectively required:

```yaml
circleId: 232229195
admins:
  - "628xxxxxxxx@s.whatsapp.net"
groups:
  command:
    - "your-group@g.us"
  announcement:
    - "your-group@g.us"
```

### Disabling Reports

```yaml
schedule:
  daily:
    enabled: false    # no daily reports
  weekly:
    enabled: false    # no weekly reports
  monthly:
    enabled: true     # only monthly
```

### Strict Requirements

```yaml
requirements:
  monthlyFans: 50000000    # 50M monthly
  weeklyFans: 15000000     # 15M weekly
```

### Alerting to Group Instead of Admin DM

```yaml
alerts:
  defaultRecipients: group   # send to alertAdmin groups instead of admin JIDs
```
