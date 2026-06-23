# REST API Reference

The bot runs a local HTTP API on `127.0.0.1:3000` (configurable via `API_PORT` environment variable).

**Security:** Binds to localhost only. No authentication. Not exposed to the internet.

## Base URL

```
http://127.0.0.1:3000
```

## Response Format

All responses use a standard envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": "string (only on failure)",
  "meta": { "snapshotDate": "2026-06-12", "timezone": "Asia/Jakarta" }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the request succeeded |
| `data` | `any` | Response payload (only on success) |
| `error` | `string` | Error message (only on failure) |
| `meta` | `object` | Additional metadata (varies by endpoint) |

## Rate Limiting

- **50 requests per second** per IP address.
- Returns `429 Too Many Requests` on excess.

---

## Endpoints

### `GET /health`

Health check with runtime statistics.

**Response** (`200`):

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-06-12T15:05:00.000Z",
    "uptimeMs": 86400000,
    "waConnected": true,
    "waState": "connected",
    "configReloads": 3,
    "schedulerRestarts": 1,
    "reconnects": 2,
    "messagesReceived": 142,
    "messagesParsed": 38,
    "messagesResponded": 35,
    "messagesFailed": 3,
    "lastDisconnectReason": null,
    "lastDisconnectTime": null,
    "socketCreatedCount": 5
  }
}
```

**Use case:** Monitor bot health, check if WhatsApp is connected, see uptime.

---

### `GET /reports/daily`

Daily report data.

**Response** (`200`):

```json
{
  "success": true,
  "data": {
    "reportType": "daily",
    "circle": {
      "name": "MyClub",
      "rank": 42,
      "monthlyPoint": 1234567890
    },
    "members": [
      {
        "name": "Player1",
        "status": "active",
        "monthlyGain": 5000000,
        "latestDailyGain": 250000,
        "isTransfer": false
      }
    ]
  },
  "meta": {
    "snapshotDate": "2026-06-12",
    "timezone": "Asia/Jakarta",
    "stale": false,
    "dataDay": 12
  }
}
```

---

### `GET /reports/weekly`

Weekly report data. Same structure as daily.

---

### `GET /reports/monthly`

Monthly report data. Same structure as daily.

---

### `GET /reports/stats`

Club statistics report.

---

### `GET /reports/bottom`

Members needing attention (below requirement or inactive).

---

### `GET /reports/ranks`

Top member rankings.

---

### `GET /members` (also `GET /reports/members`)

List all members with computed data.

**Response** (`200`):

```json
{
  "success": true,
  "data": [
    {
      "viewerId": 123456789,
      "name": "Player1",
      "status": "active",
      "monthlyGain": 5000000,
      "latestDailyGain": 250000,
      "isTransfer": false,
      "previousCircleName": null
    }
  ],
  "meta": {
    "total": 25,
    "active": 22,
    "dataDay": 12
  }
}
```

**Member fields:**

| Field | Type | Description |
|-------|------|-------------|
| `viewerId` | `number` | Unique trainer ID |
| `name` | `string` | Display name |
| `status` | `string` | `"active"`, `"stale"`, or `"left"` |
| `monthlyGain` | `number` | Fans gained this month |
| `latestDailyGain` | `number` | Fans gained most recent day |
| `isTransfer` | `boolean` | Whether member transferred from another club |
| `previousCircleName` | `string?` | Source club name (if transfer) |

---

### `GET /members/:viewerId`

Single member detail.

**Path parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `viewerId` | `number` | Member's viewer ID (1-15 digits) |

**Response** (`200`):

```json
{
  "success": true,
  "data": {
    "viewerId": 123456789,
    "name": "Player1",
    "status": "active",
    "monthlyGain": 5000000,
    "latestDailyGain": 250000,
    "isTransfer": false,
    "previousCircleName": null,
    "weeklyGains": [1200000, 1500000, 1300000, 1000000]
  }
}
```

**Additional field:**

| Field | Type | Description |
|-------|------|-------------|
| `weeklyGains` | `number[]` | Gains per week block (1-indexed weeks) |

**Error responses:**

| Status | Error | Reason |
|--------|-------|--------|
| `400` | `"Invalid viewerId format"` | ID is not 1-15 digits |
| `404` | `"Member {id} not found"` | No member with that ID in current snapshot |

---

### `GET /tier`

Tier promotion/demotion intelligence.

**Response** (`200`):

```json
{
  "success": true,
  "data": {
    "clubRank": 8,
    "tierName": "A+",
    "promotionGap": 50000000,
    "demotionBuffer": 120000000,
    "requiredPace": 4000000,
    "currentPace": 3500000,
    "daysLeft": 18,
    "riskLevel": "MEDIUM",
    "projectedOutcome": "stay"
  },
  "meta": {
    "snapshotDate": "2026-06-12"
  }
}
```

**Tier fields:**

| Field | Type | Description |
|-------|------|-------------|
| `clubRank` | `number` | Numeric tier (1=D, 11=SS) |
| `tierName` | `string` | Tier name (SS, S+, S, A+, etc.) |
| `promotionGap` | `number` | Fans needed for promotion |
| `demotionBuffer` | `number` | Fans above demotion threshold |
| `requiredPace` | `number` | Daily pace needed to promote |
| `currentPace` | `number` | Current daily pace |
| `daysLeft` | `number` | Days left in month |
| `riskLevel` | `string` | `"LOW"`, `"MEDIUM"`, or `"HIGH"` |
| `projectedOutcome` | `string` | `"promote"`, `"stay"`, `"demotion_risk"`, or `"unknown"` |

---

### `GET /snapshots`

List available snapshot dates.

**Response** (`200`):

```json
{
  "success": true,
  "data": ["2026-06-12"],
  "meta": {
    "total": 1
  }
}
```

---

### `GET /groups`

List WhatsApp groups the bot is in. Requires WhatsApp connection.

**Response** (`200`):

```json
{
  "success": true,
  "data": [
    {
      "id": "120363xxx@g.us",
      "name": "My Club Group",
      "participants": 25
    }
  ]
}
```

**Error responses:**

| Status | Error | Reason |
|--------|-------|--------|
| `503` | `"WhatsApp not connected"` | Bot hasn't connected to WhatsApp yet |

---

### `GET /chats`

List all WhatsApp chats (DMs and groups). Requires WhatsApp connection.

**Response** (`200`):

```json
{
  "success": true,
  "data": [
    {
      "jid": "628xxxxxxxx@s.whatsapp.net",
      "name": "Admin Name",
      "type": "dm"
    },
    {
      "jid": "120363xxx@g.us",
      "name": "My Club Group",
      "type": "group"
    }
  ],
  "meta": {
    "count": 2
  }
}
```

---

## Error Responses

### `404 Not Found`

```json
{
  "success": false,
  "error": "Not found"
}
```

Returned for any unrecognized path.

### `429 Too Many Requests`

```json
{
  "success": false,
  "error": "Too many requests"
}
```

Rate limit exceeded (50 req/s per IP).

### `500 Internal Server Error`

```json
{
  "success": false,
  "error": "Internal server error"
}
```

Unexpected error in request handler.

### `503 Service Unavailable`

```json
{
  "success": false,
  "error": "No snapshot available"
}
```

No data loaded yet (bot hasn't fetched from uma.moe).

---

## Usage Examples

### Check bot health

```bash
curl -s http://127.0.0.1:3000/health | jq '.data.status'
# "ok"
```

### Get member list

```bash
curl -s http://127.0.0.1:3000/members | jq '.data | length'
# 25
```

### Get specific member

```bash
curl -s http://127.0.0.1:3000/members/123456789 | jq '.data.name'
# "Player1"
```

### Check tier status

```bash
curl -s http://127.0.0.1:3000/tier | jq '.data.riskLevel'
# "MEDIUM"
```

### Quick health check script

```bash
# npm run health (simplified version)
curl -s http://127.0.0.1:3000/health | node -e "
  process.stdin.on('data', d => {
    const j = JSON.parse(d);
    console.log(j.success ? 'Bot is running' : 'Bot is down');
    console.log('Time:', j.data?.timestamp);
  })
"
```
