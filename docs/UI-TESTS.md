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

The interface suite uses Vitest's per-file jsdom environment, React Testing Library, user-event, and jest-dom matchers. Engine tests keep their default Node environment. Issue #16 added only development dependencies. Issue #29 adds the frontend Supabase Auth SDK; calculation code remains unchanged.

Coverage includes cash/credit totals and blank inputs; employee add/remove and fractional/zero weights; the $100 pool at weights 100:50 in both rounding modes and switching back; five invalid cash/credit cases and correction; invalid employee names; roster add/remove persistence across unmount/remount while draft cash/credit fields reset; empty, all-zero, and mixed-weight rosters; unreadable stored JSON and invalid stored weights. Expected dollar strings use the application's locale-independent integer-cent format, not locale APIs or the calculation engine as an assertion oracle.

Tests use fictional employees and deterministic UUIDs. Each test clears localStorage; cleanup unmounts React, restores mocks, and resets Vitest's module registry. The calculator has no mutable module-level state; the configured Auth client is a lazy singleton. Summary cards and employee rows now expose named `group` roles for accessible queries; no calculation, persistence, or interaction logic changes.

## Limitations and manual smoke checks

jsdom simulates the DOM rather than browser layout, rendering, mobile input keyboards, storage quotas, or a full page navigation. Remounting exercises the app's localStorage initialization, not an actual browser reload. user-event can retain an editing cache after native `form.reset()`; the add helper explicitly clears fields before typing the next employee. No timing sleeps, screenshots, network calls, or backend dependencies are used.

In a real browser, smoke-check mobile add/remove, cash plus credit totals, $66.66/$33.33 with $0.01 unassigned, whole-dollar $66/$33 with $1 unassigned, switching back, invalid input and correction, and reload preserving the roster while clearing cash/credit drafts. Check native required/min/step validation and form reset, keyboard navigation, and the new accessible group names with a screen reader. Browser rendering and native validation are not fully verified by this suite.

Financial formulas, leftover policy, storage key/shape, and draft persistence policy remain unchanged. This work starts from `main` independently of PR #15 and includes no database, Supabase, authentication, or database CI changes. Command results and environment versions are recorded in the pull request.

## Authentication coverage (Issue #29)

The original 60 engine tests and all behavioral assertions in the 15 calculator UI tests are preserved. `src/Auth.test.tsx`
adds 28 mocked Supabase React tests for the login gate, initial restoration and verified
identity, sign-in/errors, pending submissions, invalid/expired sessions, logout and
retry, refresh/focus events, expiry, stale responses, StrictMode cleanup, account/
project/legacy roster isolation and explicit offline/configuration-error states.
`src/supabase.test.ts` adds 19 checks for public configuration validation, singleton client
options and namespaced storage. All Auth transports are mocked; tests use only
fictional identities and make no hosted requests.

Run `npm run check`, `npm run check:db`, `npm run check:hosted-preflight` and, on a
supported local Docker host, `npm run check:supabase`. The last two checks retain
their existing scope: offline safety guards and a disposable local full stack.
[AUTH.md](AUTH.md) gives exact owner-only browser acceptance and synthetic cleanup
steps. Mock tests do not establish hosted/browser login, email delivery or
production readiness.

## Calculator test isolation (PR #30 follow-up)

The owner reproduced 15 failures in `src/App.test.tsx` with valid Supabase values
in ignored `.env.local`, while the other 107 tests passed. Those tests rendered
`App`, whose configured mode correctly shows the initial authentication gate
instead of the calculator. This was a test-isolation defect, not an auth-gate bug.

The calculator suite now imports `Calculator` directly and renders
`<Calculator storageKey="employees" />`, including the persistence remount. All
15 existing tests retain every behavioral assertion. `src/Auth.test.tsx` continues
to render `App` with mocked configured, unconfigured and invalid configuration
modes. Production code and authentication behavior are unchanged.

Verified on 2026-10-15 with Node 24.19.0 / npm 11.9.0 using a temporary source
snapshot that excludes ignored env files; the real `.env.local` was not read,
copied or modified. Before the fix, `npm test` with fictional configured values
reproduced **15 failed / 107 passed**. After the fix:

| Frontend environment | `npm run check` | `npm run check:hosted-preflight` |
| --- | --- | --- |
| Both Supabase variables unset | 122 tests, lint, TypeScript/build passed | 25 passed |
| Safe fictional URL and publishable key | 122 tests, lint, TypeScript/build passed | 25 passed |

The fictional values were `https://aaaaaaaaaaaaaaaaaaaa.supabase.co` and
`sb_publishable_fictional_placeholder`, supplied only to the test/build processes.
No real hosted project was accessed. No production authentication code, local
configuration, schema, migrations, RLS or integration harness was changed.
