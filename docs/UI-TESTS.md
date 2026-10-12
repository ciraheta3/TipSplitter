# React interface tests (Issue #16)

Use Node 24 LTS. The existing `npm test` command and frontend CI job discover both the 60 unchanged calculation tests and 15 React interface tests; no CI changes or external services are required.

```bash
npm ci
npm audit
npm test                         # Engine + interface tests
npm test -- src/App.test.tsx     # Interface tests only
npm run check                    # All tests, ESLint, TypeScript + production build
npm test -- --sequence.shuffle --sequence.seed=16  # Check order independence
```

The interface suite uses Vitest's per-file jsdom environment, React Testing Library, user-event, and jest-dom matchers. Engine tests keep their default Node environment. Only new development dependencies are added; existing dependency versions and calculation code are unchanged.

Coverage includes cash/credit totals and blank inputs; employee add/remove and fractional/zero weights; the $100 pool at weights 100:50 in both rounding modes and switching back; five invalid cash/credit cases and correction; invalid employee names; roster add/remove persistence across unmount/remount while draft cash/credit fields reset; empty, all-zero, and mixed-weight rosters; unreadable stored JSON and invalid stored weights. Expected dollar strings use the application's locale-independent integer-cent format, not locale APIs or the calculation engine as an assertion oracle.

Tests use fictional employees and deterministic UUIDs. Each test clears localStorage; cleanup unmounts React, restores mocks, and resets Vitest's module registry. App has no mutable module-level state. Summary cards and employee rows now expose named `group` roles for accessible queries; no calculation, persistence, or interaction logic changes.

## Limitations and manual smoke checks

jsdom simulates the DOM rather than browser layout, rendering, mobile input keyboards, storage quotas, or a full page navigation. Remounting exercises the app's localStorage initialization, not an actual browser reload. user-event can retain an editing cache after native `form.reset()`; the add helper explicitly clears fields before typing the next employee. No timing sleeps, screenshots, network calls, or backend dependencies are used.

In a real browser, smoke-check mobile add/remove, cash plus credit totals, $66.66/$33.33 with $0.01 unassigned, whole-dollar $66/$33 with $1 unassigned, switching back, invalid input and correction, and reload preserving the roster while clearing cash/credit drafts. Check native required/min/step validation and form reset, keyboard navigation, and the new accessible group names with a screen reader. Browser rendering and native validation are not fully verified by this suite.

Financial formulas, leftover policy, storage key/shape, and draft persistence policy remain unchanged. This work starts from `main` independently of PR #15 and includes no database, Supabase, authentication, or database CI changes. Command results and environment versions are recorded in the pull request.
