# Correctness Audit Findings

## Summary
6 findings: 0 CRITICAL, 1 HIGH, 4 MEDIUM, 1 LOW

## Findings

### [HIGH] `process.on('exit')` calls async `db.close()` without await — MySQL connections leak on uncaught exception
- File: `src/index.ts:362`
- What: The `exit` event handler invokes `db.close()` synchronously, but `close()` is async. For MySQL, `pool.end()` is a real async I/O operation that won't complete before the process exits. For SQLite, the synchronous `writeFileSync` inside `save()` runs before the first `await`, so data IS persisted — but `sql.js`'s WASM `db.close()` never runs.
- Why: On `uncaughtException`, the handler at line 41 calls `process.exit(1)`, which triggers the `exit` handler but NOT the `cleanup` function (which properly `await`s `db.close()`). MySQL connections are left open; the OS cleans up sockets on process exit, but in-flight writes could be lost if the pool has pending operations.
- How: Two options:
  1. **Preferred**: Move the PID cleanup into `cleanup()` and remove the `exit` handler's `db.close()` call — the `SIGINT`/`SIGTERM` path already handles it. For `uncaughtException`, the process exits immediately and the OS reclaims sockets.
  2. **Alternative**: In the `exit` handler, only call the synchronous parts needed (`clearInterval`, `writeFileSync`) by splitting `close()` into sync/async halves.
- Confidence: HIGH

### [MEDIUM] `ts-node` may not load `qrcode-terminal.d.ts` ambient declaration — TS7016 on `npm run dev`
- File: `src/types/qrcode-terminal.d.ts:1-3` (declaration location), `src/whatsapp/client.ts:217` (consumer)
- What: The ambient `declare module 'qrcode-terminal'` is at `src/types/qrcode-terminal.d.ts`, covered by `tsconfig.json` `include: ["src/**/*"]`. However, `ts-node` (used by `npm run dev`) only automatically loads `include`-listed files starting from v10.7.0. If the project uses an older `ts-node` version (pulled transitively by `ts-node-dev@^2.0.0`), the `.d.ts` is invisible to `ts-node` and `import('qrcode-terminal')` triggers TS7016. The `npm run dev:watch` command uses `--transpile-only` which skips type-checking entirely, masking the issue.
- Why: `npm run dev` (the primary development command) would fail to type-check. New contributors would see TS7016 errors and not understand why the declaration file isn't found.
- How: Add `"files": true` to the `ts-node` compilerOptions in `tsconfig.json`:
  ```json
  "ts-node": {
    "skipProject": false,
    "compilerOptions": {
      "module": "commonjs",
      "files": true
    }
  }
  ```
  This forces `ts-node` to load all files from `include`, matching `tsc` behavior. Alternatively, verify the installed `ts-node` version — if ≥10.7.0, the issue may already be resolved.
- Confidence: MEDIUM (cannot verify installed `ts-node` version in this environment)

### [MEDIUM] `AlertEventRow.status` type says `'deduped'` but code uses `'suppressed'`
- File: `src/types/index.ts:301`
- What: `AlertEventRow.status` is typed as `'pending' | 'sent' | 'deduped'`, but the actual status values written to the database are `'pending'`, `'sent'`, and `'suppressed'` (see `src/alerts/alerts.ts:209`, `src/db/database.ts:229`, `src/db/mysql-database.ts:207`). The value `'deduped'` is never used anywhere in the codebase.
- Why: If any future code reads alert rows and switches on `status`, it would handle `'deduped'` (which never exists) and miss `'suppressed'` (which does exist). The type lies about the data model.
- How: Change the type to match reality:
  ```typescript
  status: 'pending' | 'sent' | 'suppressed';
  ```
  (Note: `AlertEventRow` is currently unused as a return type from `IDatabase`, so this is a latent issue, not a runtime bug.)
- Confidence: HIGH

### [MEDIUM] `config.ts` double-cast `as unknown as BotConfig` allows Zod schema ↔ interface drift
- File: `src/config.ts:147,156`
- What: Both `getDefaultConfig()` and `validateConfig()` cast the Zod parse result via `return result as unknown as BotConfig`. This bypasses TypeScript's structural type checking, so the Zod schema and the `BotConfig` interface in `src/types/index.ts:253-268` could diverge without any compiler error.
- Why: If someone adds a field to the Zod schema (e.g., a new database option) but forgets to update `BotConfig`, or vice versa, the type system won't catch it. Runtime behavior depends on Zod defaults, not the interface shape.
- How: Option 1 — Use `z.infer<typeof ConfigSchema>` as the return type and remove the manual `BotConfig` interface for the database section (use Zod as source of truth). Option 2 — Add a compile-time assertion: `const _: BotConfig = result as BotConfig;` after the cast (this validates structure without the double-cast). Option 3 — Accept the tradeoff and add a comment explaining why the cast exists.
- Confidence: HIGH

### [MEDIUM] `deduplicateAlerts` function is dead code — replaced by batch `getExistingAlertKeys`
- File: `src/alerts/alerts.ts:226-234`
- What: `deduplicateAlerts(alerts, db)` iterates alerts one-by-one calling `db.isAlertAlreadySent()`. It has zero callers in the entire codebase. The batch approach (`db.getExistingAlertKeys(candidateKeys)`) at line 171-173 replaced it for performance.
- Why: Dead code creates confusion — a reader would wonder if this function is the "real" dedup path. It also creates a maintenance surface: if `IDatabase` changes, this function needs updating even though nobody uses it.
- How: Remove the `deduplicateAlerts` export. If it's needed for backwards compatibility with external consumers, deprecate it with `@deprecated` annotation. Either way, add a note that `getExistingAlertKeys` is the current approach.
- Confidence: HIGH

### [LOW] SQLite `recordAlert` uses check-then-insert (TOCTOU) — safe only in single-process mode
- File: `src/db/database.ts:246-268`
- What: `recordAlert()` does `SELECT` then `INSERT` as two separate statements without a transaction or unique constraint guard. Under concurrent access, a duplicate `event_key` could slip through between the check and the insert.
- Why: In the current single-process architecture, this is safe (SQLite file-level locking prevents concurrent writers). However, if the bot ever runs multiple processes against the same SQLite file, or if the transaction boundary is ever introduced around alert recording, this TOCTOU becomes a real bug.
- How: Add a comment documenting why this is safe (single-process invariant) and noting that MySQL's `INSERT IGNORE` approach (line 224-253) is the robust alternative. No code change needed for the current architecture.
- Confidence: HIGH

---

## Positive Findings

### [POSITIVE] Async boundary completeness is excellent
- What: Every method on `IDatabase` returns `Promise`, and every call site across all 12 consumer files properly uses `await`. The async propagation chain (documented in `.audit/architecture.md:89-117`) is complete — no missing awaits, no fire-and-forget Promise leaks.
- Why: The most common async migration bug is missed `await` on a function that became async. This codebase has zero such omissions across all DB method calls. The migration was thorough.

### [POSITIVE] Transaction error handling follows the correct rollback pattern
- File: `src/db/database.ts:363-378`, `src/db/mysql-database.ts:379-398`
- What: Both adapters wrap `rollback()` in its own `try/catch` to prevent masking the original error. The MySQL adapter correctly releases the connection in a `finally` block. The SQLite adapter uses synchronous `rawRun` inside the async transaction, which is correct because sql.js is synchronous — the `async` on the method is purely for interface conformance.
- Why: This pattern is the textbook correct approach for database transactions. It ensures: (1) original errors propagate, (2) rollback failures are logged but don't mask the original, (3) connections are always released.

### [POSITIVE] Health endpoint handles async/sync mismatch correctly
- File: `src/api/server.ts:134-139`
- What: `handleRequest` is sync but `handleHealth` is async. The code properly bridges this by calling `this.handleHealth(res).catch(err => ...)` and returning immediately. The `catch` ensures errors are sent as 500 responses. The inner try/catch in `handleHealth` (line 219-221) handles DB failures gracefully, falling back to 503.
- Why: Mixing sync HTTP handlers with async DB calls is a common source of "response never sent" bugs. This implementation handles both success and error paths correctly.

---

## Modules Reviewed
- `src/db/types.ts`: clean
- `src/db/database.ts`: 1 finding (LOW — TOCTOU in recordAlert)
- `src/db/mysql-database.ts`: clean
- `src/db/factory.ts`: clean
- `src/data/member-history.ts`: clean
- `src/scheduler/scheduler.ts`: clean
- `src/scheduler/catchup.ts`: clean
- `src/orchestrator/report-orchestrator.ts`: clean
- `src/alerts/alerts.ts`: 1 finding (MEDIUM — dead deduplicateAlerts)
- `src/whatsapp/dispatch.ts`: clean
- `src/reports/registry.ts`: clean
- `src/reports/members.ts`: clean
- `src/api/server.ts`: clean
- `src/index.ts`: 1 finding (HIGH — exit handler)
- `src/config.ts`: 1 finding (MEDIUM — double-cast)
- `src/types/index.ts`: 1 finding (MEDIUM — AlertEventRow.status)
- `src/types/qrcode-terminal.d.ts`: 1 finding (MEDIUM — ts-node loading)
- `tsconfig.json`: clean
- `package.json`: clean (`@types/sql.js` in devDependencies confirmed at line 52)

## Low-Confidence Notes
- [src/index.ts:362] The `process.on('exit')` handler's `db.close()` for SQLite is effectively a no-op in practice because the `cleanup` function (line 352-359) already properly closes the DB before calling `process.exit(0)`. The `exit` handler is only meaningful for the `uncaughtException` path, where data loss is already acceptable. However, for MySQL, pending pool operations during an uncaught exception are silently dropped.
- [src/types/qrcode-terminal.d.ts] The TS7016 issue depends on the installed `ts-node` version. If ts-node ≥10.7.0, `include` patterns are loaded automatically and the issue is already resolved. Cannot verify the version without running `npm ls ts-node`.
- [src/db/database.ts:246-268] The SQLite `recordAlert` check-then-insert is technically TOCTOU but is safe in the current single-process architecture. If the architecture ever changes to multi-process, this needs a UNIQUE constraint + INSERT OR IGNORE pattern (like the MySQL adapter already does).
