# Project Context

## Language & Framework
- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 18+
- **Module system:** CommonJS
- **Target:** ES2022

## Project Type
- **Application:** WhatsApp bot for Uma Musume club leaders
- **Architecture:** Single process (monolith)
- **Package manager:** npm

## Key Dependencies
- **WhatsApp:** @whiskeysockets/baileys ^7.0.0-rc13
- **Scheduling:** node-cron ^3.0.3
- **HTTP client:** playwright ^1.52.0
- **Database:** sql.js ^1.12.0 (in-memory WASM SQLite)
- **Config:** yaml ^2.7.1, zod ^3.25.67
- **Logging:** pino ^9.6.0

## Test Framework
- **Framework:** Jest + ts-jest
- **Test runner:** npm test (jest --forceExit --detectOpenHandles)
- **Coverage thresholds:** 70% branches, 80% functions/lines/statements
- **Test structure:** mirrors src/ in tests/

## Entry Points
- **Main:** src/index.ts → dist/index.js
- **Dev:** ts-node src/index.ts
- **Config:** config.yaml (YAML with Zod validation)

## Project Structure
```
src/
├── index.ts          # Entry point
├── config.ts         # YAML config + Zod validation
├── runtime.ts        # Runtime stats
├── types/            # Shared TypeScript types
├── orchestrator/     # Report pipeline
├── api/              # HTTP client + REST API
├── data/             # Snapshot persistence + arithmetic
├── db/               # SQLite via sql.js
├── reports/          # Report generators (11 types)
├── alerts/           # Alert detection + formatting
├── scheduler/        # Cron scheduling + catch-up
├── whatsapp/         # Baileys client + command dispatch
└── utils/            # Logger, timezone, utilities
```

## File Count
- **Source files:** 40 TypeScript files
- **Test files:** 66 TypeScript files
- **Documentation:** 7 markdown files
- **Config files:** 5 (package.json, tsconfig.json, jest.config.js, ecosystem.config.js, config.example.yaml)

## Lines of Code
- **Source:** 7,883 lines
- **Tests:** ~15,000+ lines (estimated from 66 files)
- **Documentation:** ~2,500 lines

## Module Boundaries
- **Clear separation:** reports/, alerts/, scheduler/, whatsapp/ are independent modules
- **Shared types:** src/types/index.ts defines all shared interfaces
- **Config dependency:** Most modules depend on config.ts for settings
- **Data dependency:** Reports depend on data/ for snapshots and arithmetic

## Build & Run
- **Build:** npm run build (tsc)
- **Dev:** npm run dev (ts-node)
- **Production:** npm start (node dist/index.js)
- **Tests:** npm test (jest --forceExit --detectOpenHandles)
- **Type check:** npm run lint:check (tsc --noEmit)

## Deployment Options
- **Direct:** node dist/index.js
- **PM2:** npm run pm2:start (background service)
- **Docker:** docker build + docker run

## Key Characteristics
- **Intermittent runtime:** Bot runs on/off at unpredictable intervals
- **Catch-up required:** Must detect and send missed reports on restart
- **Immutable data:** Snapshots are never mutated after saving
- **Indonesian language:** User-facing messages in Bahasa Indonesia
- **WIB timezone:** All times in Asia/Jakarta (UTC+7)
- **Localhost-only API:** REST API binds to 127.0.0.1 only