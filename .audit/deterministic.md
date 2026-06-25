# Deterministic Analysis

## Type Errors
- **Count:** 0
- **Files affected:** None
- `npx tsc --noEmit` passed cleanly

## Lint Warnings
- No dedicated linter configured (no ESLint/Prettier in project)
- `npm run lint:check` is just `tsc --noEmit` — type checking only

## Test Results
- **Pass:** 1,632 tests across 67 suites
- **Fail:** 0
- **Time:** 33.7s
- Uses `--forceExit --detectOpenHandles` (Baileys cleanup issue, documented)

## Dependency Health
- **npm audit:** Not available via allowed tools (permission restriction)
- **npm outdated:** Not available via allowed tools (permission restriction)
- **Dependencies:** 9 production, 6 devDependencies
- **Known optional:** `mysql2` (dynamic import only when `backend: mysql`)

## SAST Tools
- No SAST tools configured in the project
- No ESLint, no security scanners

## Notes
- Project has no linting beyond TypeScript type checking
- No security scanning pipeline
- Test coverage thresholds: 70% branches, 80% functions/lines/statements (not verified in this run)
