# Project Context

- **Language:** TypeScript (strict mode, ES2022 target, CommonJS modules)
- **Framework:** Node.js 18+ (no web framework — raw `http` module for API)
- **Test framework:** Jest + ts-jest (1632 tests, 67 suites)
- **Entry point:** `src/index.ts` — composition root (wires modules together)
- **File count:** 40 source files in `src/`
- **LOC:** ~7,374 lines of TypeScript

## Modules

| Module | Path | Description |
|--------|------|-------------|
| Config | `src/config.ts` | YAML config loading + Zod validation + hot-reload |
| Runtime | `src/runtime.ts` | Runtime stats (uptime, reconnects, message counts) |
| Types | `src/types/index.ts` | Shared TypeScript types |
| WhatsApp | `src/whatsapp/` | Baileys client, command dispatch, access control |
| Reports | `src/reports/` | 11 report generators + compute + format + registry |
| Data | `src/data/` | Snapshot persistence + daily_fans arithmetic + member history |
| DB | `src/db/` | Pluggable database (SQLite via sql.js / MySQL via mysql2) |
| API | `src/api/` | HTTP server (raw http) + uma.moe client |
| Scheduler | `src/scheduler/` | Cron-based auto-delivery + catch-up |
| Alerts | `src/alerts/` | Alert detection + formatting |
| Orchestrator | `src/orchestrator/` | Report pipeline orchestration |
| Utils | `src/utils/` | Logger, timezone helpers, string formatting |
