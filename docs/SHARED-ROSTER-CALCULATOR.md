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
- Routine access checks keep the previously verified shared preview visible and
  inert while retaining its layout space and DOM; successful checks preserve fixed
  defaults, selections and temporary weights/input.
  Refresh/focus/visibility,
  network events and the existing minute timer check access; they do not silently
  import new defaults. Auth events abort current reads; account changes clear data.
  Explicit reload, mode exit, failed access and scope/client/restaurant changes
  discard temporary weights, one-time participants and addition drafts. Routine
  successful checks preserve even invalid text.
  The previously verified addition form retains its layout space and stays
  visible but inert/disabled while checking access; it is initially available
  only after successful complete roster verification, and successful checks preserve
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

For the v0.1.1 layout-collapse investigation, browser evidence and a credential-free
iPad acceptance fixture, see [scroll stability](SCROLL-STABILITY.md).

## Collapsible role sections (Issue #45)

The shared preview starts with every role and **Temporary participants** collapsed.
Headers show selected / eligible counts. Open a role to select individuals, use
**Select all eligible** or **Clear selection**, and edit/reset temporary share
weights. Bulk selection uses the same active employee/role eligibility, including
valid zero weights; clearing only deselects and retains typed weights.

Permanent groups use role IDs already present in the authorized snapshot. Roles
sort by name then ID; employees sort by name then ID. Distinct roles with matching
names remain separate. Payouts use the same grouping, with temporary participants
last. The financial engine and its input order remain unchanged.

Expansion choices live in this preview's React state, independently of selections
and weights. Collapse/reopen and successful access checks preserve all three;
explicit reload, access loss, source exit and account/restaurant/client changes
reset expansion as well as the existing protected preview state. New temporary
entries remain selected even while their separate group is collapsed. Expanded
rows use two columns at landscape tablet widths and one on smaller screens; native
buttons provide Enter/Space support, `aria-expanded` and 48px minimum tap heights.
The visible/inert layout protections from PR #44 remain in place.

The credential-free fixture linked in [SCROLL-STABILITY.md](SCROLL-STABILITY.md)
now has 50 synthetic employees across five roles. Start with its collapsed headers,
then open the roles needed for the existing acceptance steps. Native iPad Safari
landscape/portrait acceptance is still required; automated Chromium checks do not
establish Safari behavior.

## Inline exclusion (Issue #47)

Each selected shared or temporary participant has a 48 × 48px minimum **×** button
in the results, named **Exclude <name> from calculation**. Duplicate names include
role, temporary status where applicable and participant ID in the accessible name.
The action deselects that ID in the same state used by the role checkboxes and
counts, recalculating immediately even when the role section is collapsed.
Reselecting restores the exact edited weight text, including invalid text.
Temporary entries remain available until **Remove temporary participant** is used.
The browser-local calculator's separate remove action still deletes its roster row.

Display-only selected rows stay visible with their current text and exclusion
controls when a selected weight is invalid. They carry no financial weight units;
only validated participants enter the unchanged engine, and any selected weight
error blocks all payout, allocation, total-share and remainder figures with **—**.
Collected tips remain visible when valid. No default or stale payout is substituted.
During routine access checks, the retained results and exclusion controls stay
visible and inert; buttons are also disabled and the callback checks existing
edit authorization. Existing failure, reload and scope-clearing rules apply.

Focused React coverage includes exclusion in both payout modes with collapsed
roles, keyboard activation, edited/invalid text retention, invalid-weight recovery,
temporary entry retention versus removal, same-name IDs, checkbox/count updates,
pending checks and access loss, scope isolation and browser-local deletion.

Pending iPad Safari manual acceptance (portrait and landscape, synthetic data only):

- Select two participants, collapse their role, enter $100 and tap × in results.
  Confirm immediate payout/remainder and role-count updates; reopen the role and
  confirm the checkbox is unchecked. Repeat with whole-dollar rounding enabled.
- Edit a share weight, exclude and reselect: the exact edit returns. Repeat with
  blank and invalid text: selected rows/× remain, monetary results show **—**;
  excluding the invalid participant restores payouts; reselecting blocks them again.
- Add one-time entries and duplicate names. Exclude one exact row; verify only its
  checkbox changes, its entry/edit survives, and explicit remove still deletes it.
- Check 48px tap targets, long names, VoiceOver names and external-keyboard
  Tab/Enter/Space operation. Observe focus after removing a row.
- With the credential-free fixture in SCROLL-STABILITY.md, verify retained layout
  and scroll position during a routine check and that × cannot act while pending.
  Failed/revoked access, scope changes, reload and sign-out must clear protected
  previews. Browser-local removal must still remove only its saved local row.

Native Safari/device acceptance and real Auth/PostgREST/RLS checks are separate
from mocked React verification; this change does not access hosted DEV.

Verification on 2026-10-25 (Linux, Node 24.19.0 / npm 11.9.0): `npm run check`
passed all 397 frontend tests (105 shared-calculation tests), 14 offline provisioning
checks, 41 offline roster harness tests, ESLint, TypeScript and the Vite build.
`git diff --check` passed. No database, live Supabase or native Safari checks ran.

## Inline temporary share weights (Issue #53)

Selected Participants now has a decimal-text input and **Reset to default** in
each shared or temporary result row. The role-selector and result inputs both
read the exact `weightInputs` Map owned by `SharedCalculation`; change/reset
callbacks accept only selected, eligible IDs within the current editable scope.
`Calculator` owns no editable weight state. The result row also displays its
loaded default (or original temporary weight), with validation linked to its input.
Both locations reset temporary participants to their original exact addition text.
No permanent default, Supabase record or browser-local roster is changed.

Invalid text remains in both fields and keeps the selected row and exclusion
control visible. All payout, allocated, total-share and remainder outputs stay
unavailable until corrected, reset or excluded. Zero and intermediate decimal text
remain exact; the unchanged parser/engine rejects negative values, excess precision,
unsafe individual weights and unsafe selected totals. Exclude/reselect preserves
the current draft. Role grouping, sorting and bulk selection are unchanged.

Distinct result IDs use a stable React prefix and participant ID. Labels identify
location, name, role and ID; inputs use text/decimal mode, 48px minimum height and
16px text. Existing keyed rows stay mounted while typing, including invalid input
and successful routine verification. No input-driven focus or scroll effect is
added. Both locations disable weight/reset controls during pending checks and
management navigation; callbacks also check authorization, selection, current
online status and visibility. Existing failure, revocation, reload, source and
account/restaurant clearing rules still apply.

Owner iPad Safari acceptance is **pending**, using synthetic participants in both
portrait and landscape:

- Select two participants, enter $100 and edit either location from 100:50 to 50:50
  and 100:50. Confirm both exact texts and $50/$50 or $66.66/$33.33 + $0.01;
  repeat whole-dollar mode for $66/$33 + $1. Collapse the role and edit in results.
- Type `0.`, `0`, blank, `-1` and `0.001`; verify retained text, nearby errors and
  unavailable payouts for invalid input. Correct, exclude/reselect and reset;
  confirm loaded defaults and original temporary weights, including duplicate names.
- Check decimal keyboard, 48px targets, long names, VoiceOver labels/descriptions,
  external-keyboard Tab/typing/Enter on reset, focus/caret and scroll stability.
  Repeat with the software keyboard open and after changing orientation.
- Trigger a routine check, visit management and return: valid/invalid drafts must
  survive and retained inputs must be inert while checking/hidden. Offline or
  revoked access, failed verification, sign-out, restaurant/source changes and
  explicit reload must retain the established fail-closed/reset behavior.
- Confirm browser-local add/remove, payouts and persistence are unchanged. Shared
  preview edits must not change any permanent defaults.

React/SDK tests use mocked transports and synthetic data. They do not establish
native Safari behavior or real Auth/PostgREST/RLS verification. No hosted DEV,
deployment, SQL/RLS or calculation-engine change is included.

Issue #53 verification on 2026-10-28 (Linux, Node 24.19.0 / npm 11.9.0):
`npm run check` passed 427 frontend tests in eight files (123 shared-calculation
regressions), 14 offline provisioning checks, 41 offline roster harness tests,
ESLint, TypeScript and Vite build. `git diff --check` passed. Seven new test cases
cover bidirectional exact text, both payout modes/remainders, reset snapshots,
keyboard focus/DOM retention, duplicate shared/temporary IDs, temporary reset,
exclude/reselect, pending/hidden/offline callback guards and successful access
checks. Existing invalid/overflow, account/restaurant/sign-out and management
regressions now also exercise edits originating in the result input. Browser-local
regressions remain in the full suite. Native device and live backend checks were
not run.
