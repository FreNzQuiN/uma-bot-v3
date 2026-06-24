# Project Documentation Summary

## Documents Found

### README.md
- Project overview: WhatsApp bot for Uma Musume club leaders
- Setup instructions, scripts, configuration
- Architecture summary: single Node.js process
- REST API endpoints documented
- WhatsApp commands listed

### CONTRIBUTING.md
- Code conventions: TypeScript strict mode, ES2022/CommonJS
- Naming: kebab-case files, camelCase functions, PascalCase types
- Error handling: never swallow errors, structured logging
- Code documentation: tiered system (file block → function JSDoc → inline)
- Config: Zod validation, hot-reload, atomic writes
- Tests: Jest + ts-jest, mirrors src/ structure
- Key gotchas: Windows paths, sql.js, Baileys cleanup, snapshot immutability

### AGENTS.md
- Concise architecture overview for AI agents
- Source layout with file descriptions
- Data model: daily_fans array, snapshots, database
- Startup order: config → DB → fetch → API → scheduler → WhatsApp → catch-up
- Testing: 1580 tests, naming conventions, test categories
- Configuration: YAML with Zod validation
- Key gotchas list
- Product context: v4 spec, uma.moe API, game context

### docs/architecture.md
- System design with ASCII diagram
- Data flow: inbound (uma.moe → snapshot) and outbound (snapshot → report → WhatsApp)
- Startup sequence explanation
- Key components detailed:
  - Snapshot Store (immutable JSON)
  - SQLite Database (sql.js, WASM)
  - Config (YAML + Zod)
  - Scheduler (node-cron)
  - Catch-Up Manager
  - WhatsApp Client (Baileys)
  - Command Dispatch
  - REST API (localhost only)
  - Report Engine
  - Report Orchestrator
  - String Utilities
- daily_fans array explained
- Message splitting logic
- Error recovery scenarios
- Testing architecture (1,599 tests)
- Deployment: PM2, Docker, Direct
- **Design Decisions** (accepted risks):
  - Rate limiter Map is unbounded (localhost only)
  - WA_SESSION_DIR not path-sanitized (operator-controlled)
  - Minimal security headers (JSON-only, localhost)
  - Runtime stats use module-level mutable state (standard Node.js pattern)
  - Logger uses synchronous file I/O (acceptable at current scale)
  - Catch-up persistence has narrow window (~10ms, negligible risk)
  - computeRollingAverage excludes zero-gain days (documented design choice)
  - Ghost detection edge case (doesn't manifest with real data)
  - WhatsApp client is large file (coupled to Baileys state machine)

### docs/configuration.md
- Full config schema with all fields and defaults
- Hot-reload mechanism explained
- Environment variables documented
- Common config patterns

### docs/api-reference.md
- REST API endpoints with request/response formats
- Authentication: optional bearer token
- Rate limiting: 50 req/s per IP
- Error response formats

### docs/message-design.md
- Bot persona: Mihono Bourbon
- Voice principles and speech patterns
- Emoji usage rules and map
- Message structure patterns (report, error, admin, loading, empty, alerts)
- Category-specific guidelines
- Localization: Indonesian for members, English for API

### docs/game-context.md
- Uma Musume game mechanics for developers
- Circle, fans, requirements, tier system explained
- daily_fans array interpretation
- Transfer handling

### docs/uma-moe-api.md
- Reverse-engineered uma.moe API documentation
- Authentication via Cloudflare Turnstile
- Endpoints with parameters and response fields
- Known quirks and non-working endpoints

## Design Decisions Already Documented

1. **Single process architecture** — no microservices, no cache layer
2. **Immutable snapshots** — never mutate saved data
3. **sql.js over sqlite3** — pure WASM, no native deps
4. **YAML config with Zod** — human-readable + type-safe validation
5. **node-cron** — simple, no external deps
6. **Baileys** — unofficial WhatsApp Web API (no official alternative)
7. **localhost-only API** — security by binding
8. **Message splitting at newline boundaries** — readability
9. **Catch-up on restart** — bot runs intermittently
10. **Indonesian language** — user-facing messages
11. **WIB timezone** — Asia/Jakarta (UTC+7)
12. **TDD preferred** — test-first for new features
13. **Coverage thresholds** — 70% branches, 80% functions/lines/statements
14. **--forceExit** — Baileys doesn't clean up cleanly

## Accepted Risks

1. Rate limiter Map unbounded (localhost only)
2. WA_SESSION_DIR not path-sanitized (operator-controlled)
3. Minimal security headers (JSON-only, localhost)
4. Runtime stats module-level mutable state (standard pattern)
5. Logger synchronous file I/O (acceptable at scale)
6. Catch-up persistence narrow window (~10ms)
7. computeRollingAverage excludes zero-gain days (documented)
8. Ghost detection edge case (doesn't manifest with real data)
9. WhatsApp client large file (coupled to Baileys)

## Testing Conventions

- Jest + ts-jest
- Tests mirror src/ structure
- Categories: unit, format, dispatch, stale, edge, regression
- Real fixture data in tests/examples/
- Shared helpers in tests/_helpers/
- Coverage exclusions: src/index.ts, src/types/**, src/api/uma-moe.ts

## Code Standards

- TypeScript strict mode
- ES2022 target, CommonJS modules
- Named exports (default exports only for classes)
- Types in src/types/index.ts
- Immutable by default
- Never swallow errors
- Structured logging with module names
- Tiered documentation system
- Zod validation at boundaries