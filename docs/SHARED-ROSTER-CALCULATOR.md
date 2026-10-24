# Shared roster → calculator V1 (Issue #42)

This branch starts from merged `main` at `355014f` (PR #39). The bridge is a
read-only, temporary allocation preview. No hosted access, deployment, migrations,
new dependencies, shift records or payment records are part of this change.

## Workflow

1. Sign in and select an authorized restaurant using the existing shared-roster
   selector. With multiple memberships, no restaurant is assumed. A single
   authorized restaurant is named explicitly.
2. Choose **Restaurant shared roster** under **Calculation source**. The local
   calculator is the default; switching sources never imports or overwrites it.
3. Select participating employees. Each checkbox shows name, role and exact
   effective default share weight. None start selected. Inactive employees or
   inactive associated roles are visible and excluded; explicit zero is valid.
4. Select an eligible shared employee to enable their **Temporary share weight** input.
   It starts with the exact permanent default shown alongside it. Edit the decimal
   text to recalculate immediately; **Reset to default** restores that employee's
   loaded default, without affecting other temporary weights. These are relative
   share weights, not literal tip percentages; nothing changes in Supabase.
5. Use **Add temporary participant** for a one-time employee: enter a name, free-text
   job title/role label and exact decimal share weight. A valid addition starts
   selected alongside shared employees, with a **Temporary** label in selection
   and payout views. Add multiple entries; duplicate names remain distinct.
   Edit/include/exclude them like shared employees; **Remove temporary participant**
   removes only that local entry, including when excluded. No shared role or employee
   is required, even when the verified shared roster is empty. Names/titles must be
   nonblank and fit the form’s 160/100-character limits.
6. Enter cash and credit and use the existing preview/round-down toggle. Results
   retain exact cents, whole-dollar floors and explicitly unassigned remainders.
7. **Reload shared roster / clear selection** replaces the snapshot, resets all
   temporary weights to the latest verified defaults, clears selections and removes
   all one-time participants and unsaved addition fields. Cash/credit input stays
   during a successful explicit reload. Leaving
   shared mode clears its preview; switching back restores local inputs and roster.

This selection is not shift participation history and never edits a permanent
employee record. Deselecting excludes an employee from payouts immediately; the
same preview retains their temporary text (including invalid text) for reselecting.
Unselected invalid inputs do not affect allocations. A selected invalid input shows
an inline error and makes all payout/remainder outputs unavailable until corrected,
reset or deselected; no previous/default weight is silently substituted.
See [PRD eligibility and open owner decisions](PRD.md).

## Implementation and isolation

- `AuthGate` provides the source controls and retains the mounted browser-local
  calculator. `SharedRoster` reuses its existing selector, verified options,
  cancellation, periodic/event refresh and fail-closed request lifecycle.
- `SharedCalculation` is keyed by client identity, verified account and restaurant.
  Exact roster data, selected IDs, per-employee decimal text and calculator inputs
  live only in React memory. A shared load replaces its complete array; it never
  imports into the local roster or deduplicates by display name. Local participant IDs use a non-UUID `temporary:` namespace, the scoped
  React ID and an increasing local counter; they never reuse a Supabase employee
  UUID. Names never act as identity. Duplicate IDs are invalid; distinct employees
  may have the same name.
- `loadCalculationRoster` uses the existing `verifyRosterAccess` pre/post checks
  from the editing adapter: actual Auth user, unchanged live session and current
  active admin/closer membership for the exact selected restaurant. Sharing this
  verifier does not invoke any write path.
- GETs select only IDs, tenant IDs, names, active flags, role links and
  `default_weight::text` / `default_weight_override::text`. Existing table grants,
  tenant filters and RLS remain authoritative. No RPC or privileged key/proxy.
- Exact counts, complete bounded rows (maximum 1,000 per table), unique IDs,
  same-tenant records, associated roles and exact text weights are required. Empty
  tables succeed only after post-read access verification. Errors, partial reads,
  malformed weights and authorization loss clear protected snapshot/selection and
  show an error; stale snapshots are never fallback data.
- The typed participant adapter uses `override ?? roleDefault`, then
  `parseWeightInput`, retaining `weightText` and safe integer `weightUnits`.
  Shared mode bypasses the local numeric displayed-weight representation and all
  localStorage reads/writes. The engine still rejects an unsafe selected total.
  Temporary text is held in a React Map keyed by employee ID and parsed directly
  with `parseWeightInput` on every edit. Zero and up to two decimal places work;
  blank, negative, malformed, unsafe and excess-precision input fails visibly.
  Any selected field error blocks the entire payout preview before calling the
  engine; selected-total overflow remains the engine's existing check.
  `src/calculation.ts` is unchanged.
- Routine access checks hide the shared preview while checking and preserve its
  fixed defaults, selections and temporary weights/input only on success.
  Refresh/focus/visibility,
  network events and the existing minute timer check access; they do not silently
  import new defaults. Auth events abort current reads; account changes clear data.
  Explicit reload, mode exit, failed access and scope/client/restaurant changes
  discard temporary weights, one-time participants and addition drafts. Routine
  successful checks preserve even invalid text.
  The addition form is hidden/disabled while checking access; it is available only
  after successful complete roster verification, and successful checks preserve
  its draft without allowing an addition during the check. Prop changes remount
  the scope. Late responses cannot restore it.

## Verification and limits

The deterministic SDK-fetch/React tests use invented identities and records. They
cover exact-text projections, membership checks, unauthorized/cross-restaurant
reads, revocation, scope changes during reads, selection, NULL/zero, safe-integer
boundaries, temporary additions/mixed payouts/duplicate names/removal, independent
temporary edits, reset, deselect/reselect, inactive handling,
repeated loads, incomplete/error/empty reads, local storage isolation, arithmetic and labelled keyboard/mobile controls. Existing
calculator, Auth, roster management and engine tests remain regression coverage.
Executed on 2026-10-23 in Linux, Node 24.19.0 / npm 11.9.0:

- `npm run check`: passed **378 frontend tests in 8 files**, **14 offline
  provisioning groups**, **41 offline harness tests**, ESLint, TypeScript and build.
  Filesystem-writing suites used a clean source copy excluding ignored owner files.
- The frontend total includes **87 bridge regressions** (19 new cases for one-time
  participants, with existing source/account/project/revocation cases extended)
  and **60 unchanged engine tests**.
- `git diff --check` and relative documentation-file link checks: passed.
- Database/component/full local Supabase suites were not rerun for this frontend
  change. Hosted Supabase and real-device browser acceptance were not performed.

These tests mock HTTP and Auth; they do not establish real hosted RLS, native Safari
rendering or real-device acceptance. PR #39's exact-text component-service evidence
is historical and narrower than full Supabase. There is no instantaneous revocation
subscription or transactional multi-table snapshot: access is checked per request
and on periodic/events; roster edits between statements can require explicit reload.
Large-roster pagination, saved shifts and payment/finalization remain separate work.

## Short owner Mac and iPad checks (pending)

On Mac, check out `feature/shared-roster-calculator`, use Node 24, run `npm ci` and
`npm run check`. With your existing private DEV configuration, run
`npm run dev -- --host 127.0.0.1` and open the localhost URL. Do not commit config,
credentials, employee fixtures or browser exports.

1. Confirm the local roster and tip inputs; switch to shared mode. Select the
   intended restaurant and two synthetic participants, weights 100 and 50. For a
   $100 pool expect $66.66/$33.33 + $0.01 remainder; whole dollars $66/$33 + $1.
   Change temporary weights to 50:50: each receives $50. Edit the second to 25:
   expect $66.66/$33.33 + $0.01, or $66/$33 + $1 in whole dollars. Reset the first:
   its loaded default is restored while the second stays 25. Try blank, negative,
   excess-precision and unsafe input: payouts must become unavailable. Deselect
   that employee: only the other receives the pool; reselect to retain the edit.
2. Add a temporary participant with a free-text role and 50 shares beside a selected
   shared employee with 100 shares. Check the same 100:50 payout/remainder results.
   Add a duplicate name: both entries must be distinct. Edit/exclude/reselect/remove
   only one entry; payouts must update immediately. An invalid selected temporary
   weight blocks payouts, and zero stays explicit. Focus/periodic refresh must keep
   entries and unsaved form input; explicit reload/source/account/restaurant/sign-out
   or access loss must clear them. Confirm shared records and the local roster stay
   unchanged; there is no permanent-save action.
3. Check NULL inheritance, explicit zero and disabled inactive employee/role rows.
   With an independently authorized second operator, change a shared default.
   Focus/refresh access must keep the running defaults; explicit reload must show
   the change, reset temporary weights, clear selections and create no duplicate rows.
4. Switch restaurants, sign out and switch accounts. Prior participants/results
   must disappear; a B-only account must never offer or load A. With owner-controlled
   synthetic revocation/network failure, refresh access: show an error/no-access
   state and remove the protected preview. Return to local mode: roster/input stay.
5. On iPad Safari, open the PR’s Netlify preview when available (publication and
   preview acceptance remain separate owner actions). Independently sign in, choose the same
   restaurant and confirm the same shared records can be selected. Test portrait/
   landscape, checkbox/input/reset tap targets, decimal keyboard, labels, temporary
   edits, addition/removal, amount entry, source/restaurant switching,
   reload, offline error/recovery and sign-out. Selections are independent per device.

Codex has not performed hosted Supabase or Mac/iPad browser verification. This work
does not publish a preview, provision accounts or modify the owner's existing DEV data.
