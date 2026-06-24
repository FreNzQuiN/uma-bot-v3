# Maintainability Audit Findings

## Summary
13 findings: 0 CRITICAL, 2 HIGH, 6 MEDIUM, 3 LOW, 2 POSITIVE

## Findings

### [HIGH] Monthly pre-fetch logic duplicated in 4 locations
- File: src/index.ts:287-295, src/orchestrator/report-orchestrator.ts:242-250, src/orchestrator/report-orchestrator.ts:290-301, src/whatsapp/dispatch.ts:261-269
- What: The pattern "check if monthly is included → getTargetMonth → ensureMonthSnapshot → catch error" appears identically in four places across three files.
- Why: When this logic changes (e.g., adding retry behavior, changing the target month calculation, or adding logging), four locations must be updated in lockstep. Missing one creates a silent behavioral inconsistency — combined reports might pre-fetch but dispatch commands don't, or vice versa.
- How: Extract a helper function into the data layer or orchestrator:
  ```typescript
  // src/data/ensure-snapshot.ts
  export async function ensureCurrentAndPreviousMonth(
    umaMoe: UmaMoeClient, circleId: number, offset: number
  ): Promise<void> {
    const { year, month } = getDataDateComponents();
    const { year: tY, month: tM } = getTargetMonth(year, month, offset);
    try { await ensureMonthSnapshot(umaMoe, circleId, tY, tM); }
    catch (err) { log.warn('Snapshot', `Pre-fetch ${tY}-${tM} failed`, err); }
  }
  ```
  All four call sites replace ~8 lines with one call.
- Confidence: HIGH

### [HIGH] Help text admin command list diverges from ADMIN_COMMANDS set
- File: src/whatsapp/dispatch.ts:190-199, src/whatsapp/admin.ts:210-219
- What: The admin commands listed in the help text (`handleHelpCommand` lines 191-199) and the admin reference command (`handleAdminReferenceCommand` lines 210-219) are hardcoded strings. The `ADMIN_COMMANDS` Set in `access.ts:16-25` is the authoritative source but isn't used to generate help text.
- Why: When a new admin command is added to `ADMIN_COMMANDS`, the help text must be manually updated in two separate locations. If forgotten, the command works but is invisible to users — a silent maintainability trap. The `admin` command is in `ADMIN_COMMANDS` but only appears in help text; `schedule` is in help text but isn't in `ADMIN_COMMANDS` (it's handled by dispatch).
- How: Generate the admin command list dynamically from a mapping:
  ```typescript
  const ADMIN_COMMAND_DOCS: Record<string, string> = {
    setreq: 'Lihat/atur requirement',
    config: 'Lihat konfigurasi',
    status: 'Status bot',
    // ...
  };
  ```
  Both help text and admin reference iterate this single source.
- Confidence: HIGH

### [MEDIUM] handleCatchUp and handleAlerts are structurally identical (copy-paste)
- File: src/whatsapp/admin.ts:157-193 vs src/whatsapp/admin.ts:199-234
- What: Both functions follow the exact same pattern: check args length → show status → parse "on"/"off" → create shallow copy with toggled key → saveConfig → return {config, message}. Only the config key path and messages differ.
- Why: Any change to the toggle pattern (e.g., adding confirmation, adding more states, changing config save behavior) must be applied to both functions. The duplication also makes it harder to spot which toggle a new developer should copy.
- How: Extract a generic toggle helper:
  ```typescript
  function handleToggle(
    args: string[], config: BotConfig,
    key: string, label: string
  ): { config: BotConfig; message: string } {
    if (args.length === 0) {
      const status = (config as any)[key] ? 'on' : 'off';
      return { config, message: `${label}: ${status}\n\nUsage: /${label.toLowerCase()} on atau /${label.toLowerCase()} off` };
    }
    const arg = args[0]?.toLowerCase();
    if (arg !== 'on' && arg !== 'off') {
      return { config, message: `Usage: /${label.toLowerCase()} on atau /${label.toLowerCase()} off` };
    }
    const updated = { ...config, [key]: arg === 'on' };
    saveConfig(updated);
    return { config: updated, message: `${label} ${arg === 'on' ? 'diaktifkan' : 'dinonaktifkan'}.` };
  }
  ```
- Confidence: HIGH

### [MEDIUM] Report generators repeat the same structural template without abstraction
- File: src/reports/daily.ts, src/reports/weekly.ts, src/reports/monthly.ts, src/reports/stats.ts, src/reports/bottom.ts, src/reports/ranks.ts
- What: Every report generator follows the same skeleton: guard empty members → extract `{ circle, club_rank }` from snapshot → look up `CLUB_TIERS[club_rank]` → build `lines[]` array → push title → push club info line → push `buildDataLine` → iterate members → push `buildFooter` → `lines.join('\n')`. The `CLUB_TIERS` lookup + tierName formatting is repeated in every generator.
- Why: A structural change to report formatting (e.g., adding a header image, changing the club info line format) requires touching all 8+ generators. The repeated boilerplate makes it harder to see each generator's unique logic.
- How: Extract shared helpers to `reports/format.ts`:
  ```typescript
  export function buildClubInfoLine(snapshot: Snapshot): string {
    const { circle, club_rank } = snapshot;
    const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;
    return `${circle.name} | ${tierName} (#${circle.monthly_rank})`;
  }
  export function buildTierPromotionLine(snapshot: Snapshot): string {
    return `Promosi: ${formatNumber(snapshot.fans_to_next_tier)} fans lagi | Degradasi: buffer ${formatNumber(snapshot.fans_to_lower_tier)}`;
  }
  ```
  This doesn't need a full template engine — just 2-3 shared builders would cut ~20 lines per generator.
- Confidence: MEDIUM

### [MEDIUM] `console.error` in database.ts bypasses structured logger
- File: src/db/database.ts:65, src/db/database.ts:75
- What: `execSql` and `runSql` catch errors and log them via `console.error` instead of the project's structured `log` module used by every other module (14 consumers according to architecture.md).
- Why: Database errors written via `console.error` won't appear in the log file (`data/logs/bot.log`), won't have timestamps, won't have the `[DB]` tag in structured format, and won't respect the configured log level. This creates a gap in observability — database errors silently bypass the monitoring infrastructure.
- How: Replace `console.error` with `log.error('DB', ...)`:
  ```typescript
  private execSql(sql: string, params?: unknown[]): QueryExecResult[] {
    try {
      return this.ensureDb().exec(sql, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('DB', `SQL error: ${msg} | SQL: ${sql.substring(0, 100)}`);
      throw err;
    }
  }
  ```
  Add `import { log } from '../utils/logger';` to database.ts.
- Confidence: HIGH

### [MEDIUM] `formatUptime` utility lives in dispatch.ts instead of utils/
- File: src/whatsapp/dispatch.ts:49-54
- What: `formatUptime()` is a pure formatting function that converts milliseconds to a human-readable string. It has no domain dependencies and is used in two places within dispatch.ts (handlePingCommand and processAdminCommand).
- Why: Utility functions that format values are the responsibility of the utils layer. Placing it in dispatch.ts makes it unavailable to other modules (e.g., the API health endpoint could display uptime in the same format). It also mixes formatting concerns into a routing module.
- How: Move `formatUptime` to `src/utils/format.ts` alongside `formatNumber` and `splitMessage`. Import it in dispatch.ts.
- Confidence: HIGH

### [MEDIUM] api/server.ts recomputes `computeMembers` for every request
- File: src/api/server.ts:268, src/api/server.ts:298, src/api/server.ts:325
- What: `handleReport`, `handleMembers`, and `handleMemberDetail` each call `computeMembers(snapshot, this.config)` independently. A single API sequence (e.g., GET /reports/daily then GET /members) recomputes the same result twice. The function iterates all members doing array operations.
- Why: While `computeMembers` is currently cheap (~34 members), the pattern means the API surface is tightly coupled to the computation function's availability. If the computation becomes more expensive (e.g., adding more derived fields), each endpoint independently pays the cost. It also makes the handler code longer than needed.
- How: Compute once per request cycle using a request-scoped cache or compute on the first access and memoize. Alternatively, accept that this is acceptable at current scale but document the coupling with a comment: `// Note: recomputed per endpoint; acceptable at ~34 members`.
- Confidence: MEDIUM

### [LOW] `dataDay` naming ambiguity across files
- File: src/reports/daily.ts:36-38, src/reports/monthly.ts:93, src/reports/stats.ts:34, src/orchestrator/report-orchestrator.ts:127-130
- What: `dataDay` means different things in different contexts: in daily.ts it's the offset-adjusted "viewed day" (line 38: `Math.max(1, latestDataDay - absOffset)`), while in stats.ts and monthly.ts it's the snapshot's actual latest data day. The same variable name holds different semantic values depending on the file.
- Why: A reader encountering `dataDay` in a new file must trace its assignment to understand whether it represents the snapshot's real latest day or an offset-adjusted viewing day. This cognitive overhead slows code review and increases the chance of using the wrong day number in calculations.
- How: Use more descriptive names: `viewedDay` for the offset-adjusted day in daily.ts, keep `dataDay` for the snapshot's actual latest day. This is a naming convention improvement, not a structural change.
- Confidence: MEDIUM

### [LOW] `configChanged` uses `JSON.stringify` for deep comparison
- File: src/index.ts:47-48
- What: `deepEqual` is implemented as `JSON.stringify(a) === JSON.stringify(b)`. JSON serialization is order-dependent — objects with the same keys in different insertion orders produce different strings and would be reported as "changed."
- Why: In practice, Zod-validated config objects likely have consistent key ordering, so this is unlikely to cause false positives. But the function is fragile to future changes (e.g., if `deepMerge` ever produces objects with different key ordering). It also serializes entire config trees on every 5s poll tick.
- How: Either document the key-ordering assumption in a comment (e.g., `// Safe because Zod schema produces consistent key ordering`), or use a proper deep-equal library like `fast-deep-equal`. The current approach works but is an implicit contract.
- Confidence: MEDIUM

### [LOW] admin.ts handleStatus `info` parameter is a large inline object type
- File: src/whatsapp/admin.ts:106
- What: The `info` parameter to `handleStatus` is typed as an inline object with 8 optional fields: `{ lastFetch?: string; lastReport?: string; snapshotDay?: number; uptime?: string; reconnects?: number; configReloads?: number; schedulerRestarts?: number; lastChangeFields?: string[] }`. This is defined inline at the call site in dispatch.ts:412-421.
- Why: Inline object types with many optional fields are hard to reuse and maintain. If another caller needs to produce status info (e.g., the API health endpoint), it would need to duplicate this shape. The optional fields also mean callers can silently omit important fields without TypeScript catching it.
- How: Extract the type to `types/index.ts`:
  ```typescript
  export interface StatusInfo {
    lastFetch?: string;
    lastReport?: string;
    uptime?: string;
    reconnects?: number;
    configReloads?: number;
    schedulerRestarts?: number;
    lastChangeFields?: string[];
  }
  ```
  Both dispatch.ts and admin.ts import from types.
- Confidence: LOW

### [POSITIVE] Consistent file-level and function-level JSDoc across all modules
- File: Full codebase
- What: Every source file has a module-level JSDoc comment explaining its purpose. Public functions consistently use `@param` tags with descriptions. The tiered documentation system (file block → function JSDoc → inline comments) described in CONTRIBUTING.md is followed throughout.
- Why: Consistent documentation makes the codebase navigable for new contributors. The JSDoc comments on report generators explain not just what the function does but what each parameter represents in domain terms (e.g., "offset - Days back from latest data day").
- How: No change needed — this is a pattern to preserve.

### [POSITIVE] Clean separation between pure computation and side-effecting I/O
- File: src/data/daily-fans.ts (313 LOC), src/reports/compute.ts (173 LOC)
- What: All arithmetic on the `daily_fans` array lives in `daily-fans.ts` as pure functions (no I/O, no DB, no config). The transformation from raw snapshot to `ComputedMember[]` lives in `compute.ts` which depends only on data-layer functions. Report generators receive pre-computed data and only produce strings.
- Why: This separation means the core data model can be understood and tested in isolation. Report generators are pure functions of their inputs. The computation layer is reusable by reports, alerts, and the API server without coupling.
- How: No change needed — maintain this layering for new features.

## Modules Reviewed
- `src/index.ts`: 1 finding (monthly pre-fetch duplication)
- `src/config.ts`: clean
- `src/runtime.ts`: clean
- `src/types/index.ts`: clean (1 finding for StatusInfo extraction in admin.ts)
- `src/data/daily-fans.ts`: clean
- `src/data/snapshot.ts`: clean
- `src/data/ensure-snapshot.ts`: clean
- `src/data/member-history.ts`: clean
- `src/db/database.ts`: 1 finding (console.error bypasses logger)
- `src/api/uma-moe.ts`: clean
- `src/api/server.ts`: 1 finding (repeated computeMembers)
- `src/reports/compute.ts`: clean
- `src/reports/registry.ts`: clean
- `src/reports/format.ts`: clean
- `src/reports/daily.ts`: 1 finding (shared template)
- `src/reports/weekly.ts`: 1 finding (shared template)
- `src/reports/monthly.ts`: 2 findings (shared template, monthly pre-fetch)
- `src/reports/stats.ts`: 1 finding (shared template)
- `src/reports/ranks.ts`: 1 finding (shared template)
- `src/reports/bottom.ts`: 1 finding (shared template)
- `src/reports/members.ts`: clean
- `src/reports/tier.ts`: clean
- `src/reports/compare.ts`: clean
- `src/reports/analyze.ts`: clean
- `src/reports/combined.ts`: clean
- `src/orchestrator/report-orchestrator.ts`: 1 finding (monthly pre-fetch duplication)
- `src/scheduler/scheduler.ts`: clean
- `src/scheduler/catchup.ts`: clean
- `src/scheduler/helpers.ts`: clean
- `src/whatsapp/client.ts`: clean (635 LOC — documented accepted)
- `src/whatsapp/dispatch.ts`: 2 findings (help text divergence, formatUptime location)
- `src/whatsapp/commands.ts`: clean
- `src/whatsapp/access.ts`: clean
- `src/whatsapp/admin.ts`: 3 findings (toggle duplication, handleStatus type, help text)
- `src/alerts/alerts.ts`: clean
- `src/utils/format.ts`: clean
- `src/utils/logger.ts`: clean
- `src/utils/timezone.ts`: clean
- `src/utils/index.ts`: clean (dead barrel — already flagged in architecture)

## Low-Confidence Notes

- [reports/daily.ts:38, dispatch.ts:247-250] The offset validation in `handleReportCommand` (dispatch.ts:247-250) uses a chain of ternaries to pick the max offset. This is correct but could be a map lookup for clarity. Low confidence because the current chain is short (3 entries) and the behavior is straightforward.

- [scheduler/catchup.ts:203-267] The `executeCatchUp` method has a nested structure (group → single vs combined → onCombinedReport present vs not → individual fallback). This is moderately complex but each branch is well-commented and the method is only ~120 lines. Not flagged because extracting would add indirection without clear benefit at this complexity level.

- [reports/daily.ts:139] The daily report reads `snapshot.members[0]` to extract year/month for stale data warning. This assumes non-empty members, which is guarded at line 32. The guard is correct but the dependency is implicit — a refactoring that moves the guard would silently break the destructuring. Same pattern in weekly.ts:162, stats.ts:92.
