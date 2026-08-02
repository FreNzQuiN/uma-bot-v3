# Test Suite — Uma Club Bot v3

## Mandatory Reading for All Agents

**Before touching any test file, you MUST:**

1. Read this document completely
2. Load skill `test-pattern`
3. Prove you understand the principles by answering the questions in the "Agent Prerequisites" section below

If you skip these steps, you will introduce bad tests. The previous audit proved this.

---

## What Makes a Test Valuable vs Harmful

A test is **valuable** when it would catch a real bug. It is **harmful** when it passes regardless of what the code does (false confidence is worse than no test).

The core question for every assertion: **"If I deleted the function body, would this test still pass?"** If yes → the test is a Liar. Delete it or fix it.

---

## Mocking Boundary Rule

This is the most important rule. Violations here caused the worst bugs in the last audit.

```
External boundaries (mock in unit tests):
  - Database (SqliteDatabase) — file I/O, WASM, schema
  - WhatsApp client (Baileys) — network, QR codes
  - HTTP client (fetch to uma.moe) — network, Cloudflare
  - File system (fs operations) — disk I/O
  - System clock — non-deterministic

Internal logic (NEVER mock):
  - Pure functions (getDailyGain, formatNumber, computeMembers)
  - Data transformations (array arithmetic on daily_fans)
  - Config validation (Zod schemas)
  - Access control logic (isAdmin, canUseCommand)
```

### How to mock the database

Use `makeMockDb()` from `tests/_helpers`. Configure return values per test:

```typescript
import { makeMockDb } from "../_helpers";

let db: ReturnType<typeof makeMockDb>;

beforeEach(() => {
  db = makeMockDb();
});

it("skips if already sent today", async () => {
  asMock(db.getLastSuccessfulRun).mockResolvedValue(
    makeRun({ report_type: "daily" }),
  );
  // ... test logic
});
```

**Never do this in unit tests:**

```typescript
// ✗ BAD — creates real SqliteDatabase in unit test
db = new SqliteDatabase(":memory:");
await db.initialize();
```

The `SqliteDatabase(':memory:')` call hits sql.js WASM, creates tables, and touches the real DB layer. This is an integration concern. Unit tests mock the `IDatabase` interface.

### When real DB is appropriate

- `*.integration.test.ts` files that explicitly test the database adapter
- Tests in `tests/db/database.integration.test.ts` (the only place `SqliteDatabase(':memory:')` belongs)
- Tests that verify SQL correctness, schema migrations, or transaction behavior

---

## Assertion Quality Rule

Every assertion must be able to fail. Check each assertion against this list:

| Bad Pattern                                                | Why It Fails                                       | Fix                                           |
| ---------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| `expect(x).toBeGreaterThanOrEqual(0)` when x can only be 0 | Always passes if x is 0                            | Assert the exact expected value               |
| `expect(result).toBeDefined()`                             | Almost anything is defined                         | Assert the specific property or value         |
| `expect(Array.isArray(x)).toBe(true)`                      | Array is always an array if that's the return type | Assert length, contents, or specific elements |
| `expect(alerts).toHaveLength(0)` with no setup             | Depends on what function does                      | Verify the guard condition actually blocks    |

### The Liar Check

For each test, mentally delete the function body (make it return a default/empty value). Then check: does the test still pass?

```typescript
// If detectAlerts returned [] when the body was deleted:
it('returns empty when alerts disabled', async () => {
  const alerts = await detectAlerts(...);
  expect(alerts).toHaveLength(0);  // ✓ Still fails — good
});

// If detectAlerts returned [] when the body was deleted:
it('returns well-formed alert objects', async () => {
  const alerts = await detectAlerts(...);
  for (const alert of alerts) {
    expect(typeof alert.type).toBe('string');  // ✗ Loop never runs — passes vacuously
  }
});
```

---

## Test File Naming Convention

```
*.unit.test.ts          — pure logic, mocked deps
*.integration.test.ts   — real I/O (HTTP, DB, filesystem)
*.edge.test.ts          — boundary conditions, empty data, overflow
*.regression.test.ts    — bug fix reproduction tests (lives NEXT TO the module)
*.format.test.ts        — output formatting/serialization
*.dispatch.test.ts      — command dispatch integration
*.stale.test.ts         — stale data handling
*.e2e-output.test.ts    — end-to-end output verification
```

---

## Test Structure

### Shared Helpers (`tests/_helpers/index.ts`)

| Helper                     | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `loadRealSnapshot()`       | Load fixture data from `tests/examples/snapshot-june-12.json` |
| `makeConfig(overrides?)`   | Build a `BotConfig` with deep-merge overrides                 |
| `makeMockDb()`             | Create a mock `IDatabase` with `jest.fn()` stubs              |
| `makeMessage(overrides?)`  | Build a mock `IncomingMessage`                                |
| `mockCurrentDate(y, m, d)` | Freeze fake timers to a specific date (JST noon)              |
| `restoreDateMocks()`       | Restore real timers                                           |
| `parseFormattedGain(str)`  | Parse "+2.7M" back to number                                  |
| `makeEmptySnapshot(real)`  | Build snapshot with `members: []`                             |

### Constants

| Constant              | Value                                                                |
| --------------------- | -------------------------------------------------------------------- |
| `TRANSFER_NAMES`      | `['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria', 'Falkrum']` |
| `STALE_NAMES`         | `['DOA IBU', 'Kuro', 'Rowking', 'Lebowski']`                         |
| `WHATSAPP_MAX_LENGTH` | `4096`                                                               |

---

## What NOT to Test

- Trivial getters/setters with no logic
- Config object shape (Zod validates at load time)
- Pure constants (`CLUB_TIERS`, `ADMIN_COMMANDS`)
- Third-party library internals (sql.js, Baileys)
- Type definitions (`src/types/index.ts`)

---

## Running Tests

```bash
npm test                              # all tests
npx jest tests/reports/daily/daily.unit.test.ts   # single file
npx jest -t "test name pattern"       # single test
npm run test:coverage                 # with coverage
```

---

## Agent Prerequisites

Before analyzing any test file, answer these in your response:

1. **What is the mocking boundary rule?** (Which things are mocked in unit tests vs which are tested with real implementations?)

2. **What is the Liar check?** (How do you detect a test that always passes?)

3. **Given this test:**

```typescript
it('returns well-formed alert objects', async () => {
  const alerts = await detectAlerts(...);
  for (const alert of alerts) {
    expect(typeof alert.type).toBe('string');
  }
});
```

**Is this a valuable test or a Liar? Why?**

4. **When is `SqliteDatabase(':memory:')` appropriate in a test?** When is it not?

5. **What does `makeMockDb()` return?** Why is it preferred over `new SqliteDatabase(':memory:')` in unit tests?

---

## Known Anti-Patterns Found in Previous Audit

These were found and fixed. Watch for recurrence:

| Anti-Pattern         | Example                                                     | Fix                              |
| -------------------- | ----------------------------------------------------------- | -------------------------------- |
| Real DB in unit test | `new SqliteDatabase(':memory:')` in scheduler tests         | Use `makeMockDb()`               |
| Vacuous assertion    | `toBeGreaterThanOrEqual(0)` when value is always 0          | Assert exact expected value      |
| Circular validation  | Mock returns X, test asserts mock returned X                | Test against real implementation |
| Over-specified test  | Tests assert internal state or call private methods         | Test behavior through public API |
| Missing mock setup   | `db.getLastSuccessfulRun` not configured, returns undefined | Configure mock return per test   |

---

## Coverage Thresholds

From `jest.config.js`:

- Branches: 70%
- Functions: 80%
- Lines: 80%
- Statements: 80%

Excluded from coverage: `src/index.ts`, `src/types/**`, `src/api/uma-moe.ts`

Coverage is a signal, not a goal. High coverage with bad assertions is theater.
