# Project Documentation Summary

## Documentation Found

| Doc | Key Points |
|-----|-----------|
| `README.md` | Project overview, setup commands, all scripts, config basics, API endpoints, WhatsApp commands |
| `CONTRIBUTING.md` | Code conventions, naming, error handling, anti-AI-slop rules, test conventions, key gotchas |
| `AGENTS.md` | Architecture overview, source layout, data model, startup order, testing, config, gotchas |
| `docs/architecture.md` | System design, data flow, component details, deployment, **design decisions (accepted risks)** |
| `docs/api-reference.md` | REST API endpoints, response formats, auth, rate limiting |
| `docs/configuration.md` | Full config schema with all fields and defaults |
| `docs/message-design.md` | Bourbon persona, emoji rules, message formatting patterns |
| `docs/game-context.md` | Uma Musume game mechanics (fans, circles, tiers) |

## Design Decisions Already Documented

From `docs/architecture.md` "Design Decisions" section — these are **accepted risks, NOT audit findings**:

1. **Rate limiter Map is unbounded** (`api/server.ts:55`) — acceptable because localhost-only, max 2 entries
2. **WA_SESSION_DIR not path-sanitized** (`whatsapp/client.ts:139`) — env var set by operator, attacker with env access already has process-level access
3. **Security headers minimal** (`api/server.ts:32-34`) — API serves only JSON, binds to localhost
4. **Runtime stats use module-level mutable state** (`runtime.ts:21-39`) — standard Node.js singleton pattern
5. **Logger uses synchronous file I/O** (`utils/logger.ts:183,189`) — acceptable at current scale (~100 lines/cycle)
6. **Catch-up persistence has narrow crash window** (`scheduler/catchup.ts:217-233`) — ~10ms window, negligible risk
7. **computeRollingAverage excludes zero-gain days** (`data/daily-fans.ts:249`) — documented design choice
8. **Ghost detection edge case** (`reports/compute.ts:90-104`) — doesn't manifest with real data
9. **WhatsApp client is a large file** (`whatsapp/client.ts`, 635 lines) — concerns coupled to Baileys state machine

## Non-Negotiable Rules (from CONTRIBUTING.md)

### Code Style
- **Strict TypeScript** — no `any` unless absolutely unavoidable
- Target ES2022, module CommonJS
- Named exports. Default exports only for classes
- Types in `src/types/index.ts`
- **Immutable by default** — config objects never mutated

### Naming
- Files: `kebab-case.ts`
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Test files: `<name>.test.ts` mirroring `src/` path

### Error Handling
- Never swallow errors. Log and propagate.
- Structured logging: `log.info('Module', 'Message', context)`
- Module names as first argument

### Anti-AI-Slop Rules
- **No section dividers** (no `// ===` or `// ──`)
- **No "what" comments** — the code says what it does
- **"Why" comments only** — explain reasoning
- **No phase labels** unless explaining performance decisions
- **Write like a human** — no AI filler
- **No restating parameter names**
- **Keep comments explaining non-obvious behavior**

### Testing
- Jest + ts-jest
- Tests mirror `src/` structure
- Coverage: 70% branches, 80% functions/lines/statements
- TDD preferred (RED→GREEN→REFACTOR)

### Commits
- `npm run lint:check && npm test` must pass before commit
- Clear, descriptive commit messages
- Don't add new dependencies without discussion
