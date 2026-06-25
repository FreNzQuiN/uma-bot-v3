# Uma Club Bot v3

WhatsApp bot for Uma Musume club leaders. Tracks member performance, sends automated reports, and provides tier intelligence from uma.moe data.

## Documentation

| Document | What it covers |
|----------|---------------|
| [docs/architecture.md](docs/architecture.md) | System design, data flow, component relationships |
| [docs/configuration.md](docs/configuration.md) | Full config reference with all fields and defaults |
| [docs/api-reference.md](docs/api-reference.md) | REST API endpoints, request/response formats |
| [docs/message-design.md](docs/message-design.md) | Bourbon persona, emoji rules, message formatting |
| [docs/game-context.md](docs/game-context.md) | Uma Musume game mechanics for developers |
| [docs/uma-moe-api.md](docs/uma-moe-api.md) | uma.moe external API (reverse-engineered) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute, code conventions, gotchas |
| [AGENTS.md](AGENTS.md) | Concise architecture overview for AI agents |

## Architecture (TL;DR)

Single Node.js process. No microservices, no cache layer.

**Data flow:** uma.moe → Snapshot (immutable JSON) → `computeMembers()` → Report generator → WhatsApp message → Announcement group.

**Key concept:** Core data is a `daily_fans` array — 32 cumulative integers, one per day. Every report (daily, weekly, monthly, ranks, bottom, stats) is different arithmetic on this same array.

**Startup:** Config → DB → Fetch data → API server → Scheduler → WhatsApp → Catch-up.

See [docs/architecture.md](docs/architecture.md) for the full picture.

## Prerequisites

- Node.js 18+
- npm

## Setup

```bash
# One-command setup (installs deps + creates config.yaml)
npm run setup

# Edit config.yaml with your circle details
# Then build and start
npm run build
npm start
```

Or step by step:

```bash
npm install
cp config.example.yaml config.yaml   # edit with your circle ID, admin JIDs, group JIDs
npm run build
npm start
```

On first start, scan the QR code shown in the terminal with WhatsApp to authenticate.

### Running in Background (Windows)

For persistent production use, PM2 runs the bot as a background service with auto-restart and Windows boot persistence:

```bash
npm run pm2:install    # one-time: install PM2 + Windows startup plugin
npm run pm2:start      # build + start as background service
npm run pm2:logs       # view logs
npm run pm2:stop       # stop the service
npm run pm2:uninstall  # remove from PM2 + disable Windows startup
```

Logs are saved to `data/logs/pm2-error.log` and `data/logs/pm2-out.log`.

## All Scripts

### Core

| Script | Description |
|--------|-------------|
| `npm run setup` | Install deps + create config.yaml from example |
| `npm run build` | Compile TypeScript to dist/ |
| `npm start` | Start the bot (production) |
| `npm run dev` | Start in development mode (ts-node) |
| `npm run dev:watch` | Start with hot-reload (ts-node-dev) |

### Testing

| Script | Description |
|--------|-------------|
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint:check` | TypeScript type check (no emit) |

### Database

| Script | Description |
|--------|-------------|
| `npm run db:reset` | Delete database for fresh start |
| `npm run db:backup` | Create timestamped database backup |

### Data

| Script | Description |
|--------|-------------|
| `npm run fetch` | Manually fetch fresh data from uma.moe |

### Health & Cleanup

| Script | Description |
|--------|-------------|
| `npm run health` | Check bot health via REST API |
| `npm run clean` | Remove dist/ and coverage/ |

### Docker

| Script | Description |
|--------|-------------|
| `npm run docker:build` | Build Docker image |
| `npm run docker:run` | Run container with volume mounts |
| `npm run docker:stop` | Stop and remove container |
| `docker compose up -d` | Start with docker-compose |
| `docker compose down` | Stop with docker-compose |

### PM2 (Windows Production)

| Script | Description |
|--------|-------------|
| `npm run pm2:install` | Install PM2 globally + Windows startup plugin |
| `npm run pm2:start` | Build + start bot as PM2 background service |
| `npm run pm2:stop` | Stop the bot |
| `npm run pm2:restart` | Rebuild + restart the bot |
| `npm run pm2:logs` | View bot logs |
| `npm run pm2:status` | Check bot status |
| `npm run pm2:uninstall` | Stop bot, remove from PM2, disable Windows startup |
| `npm run pm2:uninstall:full` | All of above + uninstall PM2 globally |

## Configuration

All configuration lives in `config.yaml`. Key sections:

- **circleId** — Your Uma Musume circle ID (required, found on uma.moe)
- **admins** — WhatsApp JIDs of bot administrators
- **groups** — JIDs for command, announcement, and alert groups
- **requirements** — Monthly/weekly fan requirements per member
- **schedule** — Auto-delivery times for daily, weekly, and monthly reports
- **catchUp** — Missed report recovery on restart
- **alerts** — Performance drop, demotion risk, and other alert toggles

Environment variables (optional, set in `.env` or shell):

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3000` | REST API port |
| `API_TOKEN` | *(none)* | Bearer token for HTTP API auth. If set, all `/` endpoints except `/health` require `Authorization: Bearer <token>`. |
| `WA_SESSION_DIR` | `data/auth` | WhatsApp session data directory |

## REST API

The bot runs a local HTTP API on `127.0.0.1:3000` (configurable via `API_PORT`).

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /reports/daily` | Daily report data |
| `GET /reports/weekly` | Weekly report data |
| `GET /reports/monthly` | Monthly report data |
| `GET /reports/stats` | Statistics report data |
| `GET /reports/bottom` | Bottom members report |
| `GET /reports/ranks` | Rankings report |
| `GET /members` | All members list |
| `GET /members/:viewerId` | Single member detail |
| `GET /tier` | Tier promotion/demotion data |
| `GET /snapshots` | Available snapshot dates |

## WhatsApp Commands

| Command | Access | Description |
|---------|--------|-------------|
| `/daily [offset]` | Command group | Daily report |
| `/weekly [offset]` | Command group | Weekly report |
| `/monthly [offset]` | Command group | Monthly report |
| `/ranks` | Command group | Rank standings |
| `/bottom` | Command group | Members needing attention |
| `/stats` | Command group | Club statistics |
| `/members` | Command group | Member list |
| `/tier` | Command group | Tier intelligence |
| `/compare A B` | Command group | Compare two members |
| `/analyze Name` | Command group | Deep member analysis |
| `/setreq [key value]` | Admin | View/change requirements |
| `/config` | Admin | Show current config |
| `/status` | Admin | Bot status |
| `/catchup on\|off` | Admin | Toggle catch-up mode |
| `/alerts on\|off` | Admin | Toggle alerts |
