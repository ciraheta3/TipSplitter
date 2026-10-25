# Shared roster editing (merged PR #39)

PR #39 started from fetched `main` at `a8c204f`, including merged
PR #37. It adds **Manage shared roster · DEV** beneath the selected restaurant's
summary. It is now merged. The historical evidence below does not establish
new owner Mac/DEV acceptance. Issue #36 and its private fixtures/plans are independent work.

Active same-restaurant admins and closers can add/edit/activate/deactivate job roles
and employees using existing column-limited INSERT/UPDATE grants and tenant RLS.
Employees are roster records, not Auth users. IDs are server-issued; no DELETE,
membership/organization mutation, RPC, service key, privileged application proxy,
SQL execution or schema/security change is added to the application. Both applied
migrations, Auth helpers, provisioning tool, original security verifiers and CI
workflow are unchanged.

The browser-local calculator, account/legacy storage and integer-cent engine are
unchanged by PR #39. Issue #42 on this branch adds a separate
[temporary shared calculator preview](SHARED-ROSTER-CALCULATOR.md); no saved shift
participants or payments are created. Default share weights are mutable roster metadata, not percentages or historical facts.

## Exact wire contract and evidence

`sharedRosterWeights.ts` accepts incoming weights only as decimal **strings**; an
employee override may instead be actual `null`. Malformed/numeric JSON results fail
closed. Input uses the existing `parseWeightInput` and integer hundredth units;
`formatCents` serializes those integer units as canonical two-place decimal strings.
There is no decimal `Number`, `parseFloat`, fractional multiplication or rounding at
this boundary. Empty role weights fail. Empty employee override means NULL/inherit;
`0` becomes the explicit string `"0.00"`. Incoming text/scale is preserved.

The SDK projections use `default_weight::text` and
`default_weight_override::text`, for both GET and mutation returning. INSERT/PATCH
JSON contains strings or actual NULL, with exact affected counts requested.
Runtime checks require one returned row, the selected organization, expected row ID,
new transaction token and precisely the submitted fields. A zero-row update is a
conflict/access change, never success. Server values are reloaded after confirmation.

The independent `check:roster-editing:components` suite passed against actual
PostgreSQL **17.11**, GoTrue **v2.197.0**, PostgREST **v16.4** and the locked SDK.
GoTrue created/signed the user sessions; Auth independently verified every identity.
The test uses the actual application adapter as well as direct SDK transport checks.
It proved GET/INSERT/PATCH returning string values and independently checked stored
numeric text for `0`, `0.01`, `1`, `100.50`, `90071992547409.91`, employee NULL and
explicit zero. It checked invalid scale/range/special/malformed values, uniqueness,
same-tenant FK restrictions, protected columns, admin/closer success and
anonymous/nonmember/foreign/revoked denials with unchanged persisted rows.
Exponent notation is rejected by the application parser; PostgreSQL itself can
accept some exponent strings, so it is not claimed as a database lexical constraint.

This component evidence is narrower than a complete Supabase pass: it uses mock API
role bootstrap on standard PostgreSQL, actual GoTrue-created `auth.users`/`auth.uid`,
and unchanged application migrations. A test-only fetch router removes the service
prefixes for direct loopback HTTP; JSON bodies/results are unchanged. It has no Kong,
Supabase CLI ledger/reset, managed-role/catalog compatibility or hosted evidence.
Only the local anonymous API key is signed by the harness; **user JWTs are issued by
real GoTrue signup and password sign-in**, not forged authenticated fixtures.

The separate `check:roster-editing` command runs the same feature suite with the
existing guarded local Supabase CLI plumbing, audits and two clean migration replays.
The original `check:supabase` security suite remains independent and unchanged.

### Second-replay Auth readiness correction (PR #39)

The owner reran diagnostic commit `9577911` on Mac: replay 1 passed every
assertion; replay 2 reset and passed its security audit, then reported
`replay=2, stage=auth-signup, fixture=1, category=transport`. This establishes that
credential discovery and the empty-fixture assertion passed, and the first signup
fetch rejected before returning an HTTP response. It does not establish whether
the request reached Auth or committed. No roster application operation or
membership fixture write had run in that replay.

The pinned upstream sources establish a lifecycle gap:

- [CLI 2.120.0 database recreation](https://github.com/supabase/cli/blob/753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4/apps/cli/src/command-internal/db-bootstrap/recreate-local-database.ts#L289)
  waits for PostgreSQL health, initializes the database and restarts services.
- [Service restart and Kong reload](https://github.com/supabase/cli/blob/753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4/apps/cli/src/command-internal/db-bootstrap/restart-services.ts#L101)
  restarts Auth/storage/realtime/pooler **without waiting for their health**, then
  reloads Kong to refresh upstream addresses. PostgREST reconnects itself.
- [GoTrue v2.197.0 health handler](https://github.com/supabase/auth/blob/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3/internal/api/api.go#L485)
  exposes GET `/health`, returning HTTP 200 and service metadata. The CLI's
  [Kong route](https://github.com/supabase/cli/blob/753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4/apps/cli/src/commands/start/templates/kong.yml.ts#L42)
  forwards `/auth/v1/` to Auth. The database audit does not probe that HTTP route.

This supports a read-only readiness check after each reset/audit. It does **not**
prove which service or socket caused the owner's transport error. A separate
loopback Node experiment closing pooled connections during a synchronous child
process observed zero failures in five trials; stale connections remain an
unconfirmed hypothesis. No full CLI stack was attempted in Cloud.

`roster-auth-readiness.mjs` now probes GET `/auth/v1/health` through the same
**guarded local API URL**, after fixture emptiness is checked and before any
signup. It requires HTTP 200 plus GoTrue service metadata. The total monotonic
budget is **30 seconds**, with at most **2 seconds per attempt including body
reading**, capped by the remaining budget, and at most 500 ms between attempts.
Only health GETs retry on transport/read timeouts or HTTP 502/503/504. Other
received HTTP statuses, malformed JSON, unexpected service metadata and explicit
cancellation fail closed. Redirects are never followed; late health success after
the deadline is rejected. A failure still triggers the existing local cleanup.

Every replay performs its own readiness check. Signup, sign-in and all database
writes remain single-attempt operations; a failure after health succeeds is still
fatal, even if a write might have committed. Both complete migration replays and
every existing security/authorization/decimal/concurrency assertion remain
required. The health handler proves API reachability at that instant, **not**
database readiness, continued availability, authorization or exactly-once delivery.
The subsequent real Auth and roster assertions remain the authority for those
capabilities. No application, migration, permission or local-project guard changes
are part of this correction.

Diagnostics retain fixed labels and bounded fields. Nested Node fetch causes can
now distinguish `connection-refused`, `connection-reset`, `socket-closed`,
`dns-failure`, `network-unreachable`, `timeout`, `aborted` and generic `transport`.
No raw error codes/messages/stacks, addresses, bodies, headers, identities or
credentials are printed. Readiness exhaustion reports `stage=auth-readiness`,
`deadlineExceeded=true` and the last safe failure category/optional HTTP status.
This preserves evidence if the local services never recover, or signup itself
still fails after readiness. Empty `docker ps` after failure remains consistent
with the harness's deliberate `stop --no-backup` cleanup.

Current checks (Node 24.19.0 / npm 11.9.0, Linux):

- `npm run check`: passed 252 frontend tests, 14 provisioning groups and **41
  offline harness tests** (17 added for readiness/transport classification),
  ESLint, TypeScript and production build. Filesystem-writing tests used a clean
  temporary source copy excluding owner ignored files.
- `npm run check:roster-editing:components`: passed every stage with real
  PostgreSQL 17, GoTrue v2.197.0 and PostgREST v16.4, including the new health GET.
  It still uses mock API roles and direct service routing, with no Kong/CLI reset.
- A temporary copy of that component harness paused its own GoTrue container for
  2.5 seconds during the first health GET. At least one health request timed out;
  subsequent health GETs recovered, exactly four signup requests were sent, and
  every original gate assertion passed. This controlled outage demonstrates
  read-only recovery, not reproduction of the Mac reset failure. Cleanup removed
  the disposable services/network.
- Offline cases cover recovery from refusal/502, permanent refusal/503 deadlines,
  hung headers/body abortion, late success rejection, invalid health responses,
  permanent HTTP errors, local URL guards, zero signup/fixture writes on readiness
  failure, fresh health on each invocation, single-attempt signup after readiness,
  and sanitized nested/aggregate socket causes.
- Full `check:roster-editing` and `check:supabase` remain unexecuted in Cloud.
  `check:db` and hosted-preflight were not rerun locally for this harness change.
  Current CI results are recorded in the PR. No full-stack or hosted pass is claimed.

From the owner's existing clean, **unlinked PR #39 worktree**, in host Mac Terminal
with Node 24, Docker Desktop/default local socket and free ports 54320–54322:

```bash
git switch issue-38-shared-roster
git pull --ff-only origin issue-38-shared-roster
git rev-parse HEAD
node --version
npm ci
npm run check
npm run check:roster-editing
```

Run serially, with no other use of the dedicated disposable
`tip-calculator-integration` local project: both resets and final cleanup destroy
its synthetic data. A pass must include **both complete clean replays**, including
Auth/roster assertions. If it fails, retain the sanitized diagnostic and nearby
fixed progress messages plus the tested SHA. Do not publish CLI debug/status,
container environments or Auth logs. Full Mac local Supabase and separate
browser/DEV acceptance remain pending; leave PR #39 open for independent review.

## Concurrent edits and bounded snapshots

`updated_at` remains display metadata, not a unique version. A local diagnostic
confirmed distinct committed updates in a single PostgreSQL command message can
share its statement timestamp. No timestamp-only lost-update guarantee is claimed.

The existing SELECT grants permit PostgreSQL's `xmin` system column. The pinned
PostgREST supports `xmin::text` on reads/returning and `xmin=eq.<token>` on PATCH;
the real component suite and actual application adapter verified this without a
view, RPC, trigger, migration or extra grant. Every edit filters **organization ID,
row ID and the exact expected xmin** in the same UPDATE. PostgreSQL rechecks the
predicate on the current row after waiting for a conflicting writer. The suite
observed exactly one winner/one zero-row conflict for parallel operators, confirmed
the committed winner by GET, and rejected sequential stale edits.

`xmin` is a 32-bit transaction identifier, not a permanent global revision or audit
ledger. Editing **snapshots** expire after one minute and cannot be reused for
offline queues, historical imports or long-lived sync. Form input can remain in
the same mounted account/restaurant editor for several minutes; it is not an
unexpired write snapshot or a permanent revision. After expiry, **Revalidate
draft** must obtain a new Auth/membership-verified snapshot. For an existing row,
its original fields and xmin must still match the freshly read target. A changed
or missing target shows a conflict and blocks Save: cancel the draft and open the
current row to start again. There is no automatic rebase onto a changed record.
Background reads do not renew the draft's write deadline. Only explicit successful
revalidation of an unchanged target does so, preserving the typed fields.

The adapter checks monotonic and wall elapsed time before preflight and again just
before dispatch, covering browser timer throttling and OS sleep. A known preflight
expiry can preserve input without dispatching a mutation. Writes always use a
snapshot younger than one minute, including after revalidation; the original
expired snapshot is retained only for comparison, never as a write filter.
The short write lifetime constrains xmin reuse/wraparound; it does not turn xmin
into a durable revision history. Review this again before persistent sync. There
is no float/timestamp fallback
if version transport is unsupported or malformed. System-column compatibility on
the owner's supported stack remains part of Mac acceptance.

A dispatched save may still commit after fetch is aborted. A refresh, Auth event,
expiry or unmount **during saving** discards that attempt's form/results but
**does not clear the save lock or its uncertainty**. This differs from preserving
an unsaved form while no mutation is pending. A small tab-memory record keeps only lifecycle
flags, keyed independently by SDK client/project, verified user and restaurant;
no draft, roster row, name or token is retained in that record. Other scopes see
neither its warning nor prior rows. Returning to the affected scope restores the
recovery requirement.

New writes remain blocked while the earlier client operation is settling and while
recovery is required. A normal/background reload cannot clear recovery, even if it
returns an apparently clean roster before a slow commit. After the client operation
settles, **Inspect current roster** performs a fresh Auth/membership-verified read;
only a successful, uncancelled inspection enables **I inspected the roster; allow
new edits**. Both actions are required. Failed/cancelled reads, Auth changes and
expiry invalidate inspection eligibility. Acknowledgment enables deliberate new
edits; it never retries the old INSERT/PATCH or restores its draft.

An acknowledged mutation followed by a failed/interrupted roster refresh is reported
as **Save was confirmed, but the roster refresh did not complete**, with the same
inspection/acknowledgment gate. It is not presented as a failed write to resubmit.
If the adapter cannot verify the write response/current access, the outcome remains
explicitly uncertain. Known preflight/validation/database rejection and zero-row
conflicts retain their existing safe errors without claiming a successful save.

This is V1 recovery, not idempotency: fetch settlement does not prove database
completion, a slow commit can appear after a read, and an absent row is not proof
of failure. Do not repeat an addition merely because it is absent; wait/reinspect
and investigate an ambiguous result. Duplicate employee names are legal, so names
are not idempotency keys. The record lasts only for the current page's memory:
browser reload/close, a new SDK client or another tab/device does not carry its
guard. After restarting the page, independently inspect interrupted saves before
repeating an addition. No durable exactly-once delivery or automatic deduplication
is claimed; those require a separately designed server idempotency mechanism.

## Access, validation and async behavior

- The existing verified Auth gate and selected restaurant are retained. Opening
  management independently verifies the SDK session against Auth and then reads
  exactly the user's active membership for the selected organization. Only admin
  and closer records pass. RLS remains the authority, not this displayed role.
- Auth/session/user identity and active membership are checked before and after
  reads and writes. Each read is bounded to 1,000 rows with an exact count; missing
  counts, unknown roles, duplicates, foreign rows and invalid strings/versions fail.
- Account/project/restaurant changes remount the request scope and discard its
  protected data and draft. Sign-out or a different Auth identity clears them
  immediately; old cached session/read results cannot restore the invalidated scope.
  Same-user Auth events, periodic checks, focus, return-to-tab and access refresh
  reverify identity/membership while preserving unsaved input in the same mounted
  editor. Save is blocked while checking. Revoked/unverified access, malformed data
  and network/offline failure clear protected rows/input with an explanatory state.
  Delayed results cannot restore old data or success messages.
  Cancellation neither rolls back a committed request nor proves an in-flight
  statement stopped; scoped recovery flags survive these React lifecycle changes.
- A selected-roster failure clears that roster and unmounts management, discarding
  its draft. Only restaurant options freshly verified by that same request remain
  selectable, so an oversized or persistently failing restaurant does not prevent
  switching to another authorized restaurant. Initial organization/membership
  verification failures, including a failed post-roster membership recheck, clear
  the options too; previously cached options are never a fallback. Retry retains
  the selected restaurant while rechecking access. Neither a successful retry nor
  switching away and back clears an interrupted save's inspection/acknowledgment
  requirement, and no write is automatically repeated.
- RLS uses database statement visibility. Revocation does not invalidate an issued
  JWT; an already displayed snapshot clears on the next refresh/event/timer, and
  mutation-time checks/RLS deny subsequent unauthorized writes. No instantaneous
  remote revocation or transactional multi-table snapshot is promised.
- Trimmed names have 100/160 Unicode-character limits. Role name uniqueness is
  database-authoritative and case insensitive; duplicate employee names are allowed.
  Fixed errors distinguish validation, uniqueness, FK, access, conflict and uncertain
  transport outcomes without showing SQL, tokens or raw vendor responses.
- New employee role assignments require an active same-restaurant role in the UI
  and a fresh pre-write role check. Existing inactive links remain visible/retained.
  Deactivation never auto-remaps employees. This is a conservative **UI rule**, not
  a new database invariant: concurrent role deactivation can still leave such a
  link. Whether stricter transactional active-role enforcement is wanted remains
  a separate product/database decision. Changing the role retains the submitted
  employee override; blank explicitly requests inheritance.

## Verification for this branch

Node 24.19.0 / npm 11.9.0, Linux. Final results are recorded in the PR.
The SQL/component/full-CLI results below are historical evidence from the initial
implementation, not reruns of the save-lifecycle correction. That correction ran
offline checks. The later diagnostics investigation's checks and component rerun
are recorded above. Full CLI, hosted and manual browser acceptance remain pending.
Current-head CI results and correction commits are recorded in the PR.

- Current restaurant-selector recovery correction: `npm run check` passes **291
  frontend tests**, 14 offline provisioning groups, 41 offline integration-harness
  tests, ESLint, TypeScript and production build. Both focused React suites pass
  **128 tests**, including 13 new regressions: repeated server/oversized roster
  failures and switching to B, initial/post-read access-verification failures,
  logout/account changes, delayed failures after tenant switching, draft clearing
  and a late-committing save whose recovery lock survives failure/switch/retry.
  Five targeted regressions fail against the original `ff9e8ad` implementation.
  Existing successful-refresh/draft-expiry/revalidation tests also pass. No
  database, service-component or full Supabase stack checks were rerun for this
  frontend-only correction; prior Mac/component evidence remains historical.
- Prior sustained-editing correction (`ff9e8ad`): `npm run check` passed **278 frontend
  tests**, 14 offline provisioning groups, 41 offline integration-harness tests,
  ESLint, TypeScript and production build. There are 26 new UI regressions (84
  management/SDK/UI tests total), covering four-minute parent/editor stability,
  periodic/focus/visibility/manual checks, expired/preflight-expired input,
  unchanged-row revalidation, changed/missing rows, same-user Auth refresh,
  sign-out/account/tenant isolation, revocation, explicit cancel/close/discard,
  repeated Save and interrupted-save inspection/acknowledgment. The original save
  recovery tests remain, with expiry and focus expectations updated to the new
  draft-preservation contract. Fake timers replace real minute-long waits.
- The smaller `check:roster-editing:components` gate passed every original stage
  with the current adapter: real PostgreSQL 17, GoTrue v2.197.0 and PostgREST v16.4,
  mock API roles, no Kong/CLI reset. No full Supabase stack was attempted for this
  prior UI correction. `check:db` and hosted-preflight were not rerun locally; current
  CI results belong in the PR. Hosted and native browser acceptance are unrun.
- Initial feature evidence: original 153 frontend tests plus 41 weight boundary
  tests and 58 management/SDK/UI tests; 14 original offline provisioning groups; lint,
  TypeScript and production build. Run filesystem-writing offline suites in a
  clean temporary source checkout, excluding owner ignored files, to protect the
  owner's independent `work/` artifacts. No owner fixture was read or modified.
- The focused PR #39 save-lifecycle correction adds 13 mocked SDK/UI regressions:
  reload/expiry/Auth/focus/unmount with a late commit after the next read, fetch
  rejection before server commit, confirmed write with failed refresh, repeated
  INSERT/PATCH submissions, account/tenant/project isolation and explicit recovery
  including failed/cancelled inspections. These are deterministic offline tests,
  not real Supabase transaction-cancellation or browser acceptance evidence.
  All 13 new regressions fail against the `853d23a` baseline while its original
  239 tests pass; the correction passes all 252 frontend tests.
- `npm run check:db`: both unchanged clean PostgreSQL security replays and both
  unchanged disposable provisioning replays passed.
- `npm run check:hosted-preflight`: all 25 unchanged offline/mocked tests passed.
  A sandbox-only child-process failure was rerun with local process access.
- `npm run check:roster-editing:components`: passed, including real HTTP exact
  transport, authorization and actual application adapter checks described above.
- `npm run check:supabase`: attempted, **startup timed out after ten minutes**;
  cleanup completed. No original full-stack assertions ran. The pinned Supabase
  database image remained unavailable on this 32 GB/vfs host. The new full CLI
  `check:roster-editing` suite has the same unavailable startup prerequisite and
  remains unexecuted here; run both commands on a suitable Mac/Docker Desktop host.
- `git diff --check`: required before PR handoff. CI check/database results and any
  further run limitations belong in the PR; no full-stack/hosted pass is implied.

Mocked tests cover admin/closer writes, exact wire fields, NULL/zero, inactive roles,
validation/collision/FK/denied/uncertain outcomes, count/shape/version checks, loading,
offline/retry, revocation before/after save, late saves across reload/Auth/unmount/
tenant/offline changes, expired drafts, and browser-local calculator isolation.
jsdom is not native Mac/browser rendering or mobile/screen-reader acceptance.

### Refresh and draft lifecycle

A parent **remount** destroys React state, including the management-open flag and
form fields. Previously every parent refresh changed the child's key, and the
manager's independent expiry reset also cleared its form. These two timers could
close the editor at different points within the minute. Every Auth event added
another reset; the outer verified Auth gate itself already preserved same-user
refresh and remains unchanged.

The request key now changes only with the client/account/requested restaurant.
A background data refresh replaces a scoped, abortable read while keeping the
authorized editor mounted. The selected automatic restaurant also stays selected
if another membership appears; it is never silently replaced by another tenant.
The parent still checks every minute and on focus/visibility/network events; a
standalone manager has equivalent checks. The summary hides old rows while
checking, while management keeps its same-scope unsaved input and blocks Save.

A **draft** is the typed form input held only in React memory. Its **snapshot**
contains the verified rows/version and the short write deadline; ordinary reads
do not advance that draft's deadline. Snapshot expiry preserves the input with a
warning and requires explicit revalidation. A **pending database mutation** is a
save attempt that may already have been dispatched. Interrupting it aborts fetch
and invokes the unchanged per-client/account/restaurant recovery record, because
the database may still commit. No recovery action resubmits that payload.

Cancel, reload/discard or Close deliberately clears input; choose Cancel before
opening another record. Account/restaurant changes and failed access verification
also clear it. Nothing saves shared drafts to browser storage, restores them after
close/logout or transfers them to another scope. Calculator state/storage and
financial rules remain independent.

For browser acceptance, start the owner's existing configured preview with
`npm run dev -- --host 127.0.0.1`. First check retention, expiry, revalidation and
Cancel/Close without clicking Save; these checks need no new roster rows. Use an
existing active role to open an employee form. Concurrent-change, revocation and
interrupted-write checks require the owner's separately approved synthetic fixture
and controls. The disposable CLI integration fixture is destroyed by its own suite
and must not be used to hold useful browser-acceptance data.

## Owner-only future DEV acceptance worksheet — all pending

This worksheet grants **no hosted authorization** to Codex and does not execute
Issue #36. Do not reuse, inspect or modify its ignored fixture/plans. After review,
the owner separately authorizes an exact synthetic DEV fixture and a separate
cleanup plan. Keep identities, credentials and project references private; record
only reviewed commit, versions, sanitized outcomes and limits publicly.

| Owner scenario | Expected result |
| --- | --- |
| Node 24 and suitable Mac/Docker Desktop, unlinked checkout | Run `npm ci`, `npm run check`, `npm run check:db`, `npm run check:hosted-preflight`, `npm run check:supabase`, then `npm run check:roster-editing` serially. Both full CLI suites must pass; investigate any gate failure without widening security. |
| Logged out, nonmember, inactive/foreign membership, loading/offline/unverified | No write forms or unauthorized shared results; local-only mode remains functional. |
| Independently approved fictional admin and closer, own restaurant | Open management; add/edit role and employee defaults; verify persistence after refresh/relogin and no extra INSERT on repeated clicks. |
| Exact values and inheritance | Check 0, 0.01, 1, 100.50, maximum, blank override/NULL versus explicit 0; invalid/exponent/excess-scale/range/name inputs fail visibly. Inspect strings and cast projections privately in Network without exporting HARs. |
| Activation and links | Inactive roles remain distinct and existing links survive. New assignments to inactive roles are disabled. Reactivation works; changing role retains the explicitly submitted override. |
| Duplicate/FK/permissions and zero rows | Clear safe errors; no success on zero rows; no tenant/ID/timestamp/membership/delete writes. Do not run broad hosted mutation probes as part of this worksheet. |
| Two independent operators editing the same row | First committed edit wins; stale save conflicts and requires reload. The next edit uses the newly loaded token. Repeat for active flags, names, role and weight. |
| Unsaved form open for 3–4 minutes; focus/return to tab/access refresh | Management and fields remain open; access checks still occur. Save disables at snapshot expiry. Revalidate preserves input and enables Save only after verified fresh data; it never submits automatically. |
| Record changes while a draft is open or expired | Fresh reads/revalidation flag the changed/missing target. Input remains visible, Save stays blocked. Cancel and reopen the current row before making a new edit; no automatic rebase. |
| Same-user Auth refresh versus sign-out/account/restaurant change | A verified same-user refresh preserves unsaved input. A different scope or failed/revoked verification clears protected rows and fields. Cancel/Close deliberately clears input. |
| Authorized for fictional A and B; A's summary fails or exceeds 1,000 rows | A's rows and draft disappear; freshly verified restaurant options remain. Repeated retry does not trap the user in A: B can be selected and loaded. Failed membership verification removes the options as well. A delayed failure cannot replace B or restore A's form. Returning to an interrupted-save scope still requires explicit inspection and acknowledgment. |
| Slow response, token refresh, logout, account/tenant change, focus/offline, minute expiry during saving | Drafts clear and late success cannot enter a new scope. Returning to the original scope retains the uncertainty warning and blocks writes, even after an early reload shows no new row. Wait for the client request to settle, explicitly inspect current rows, then acknowledge; no automatic mutation retry. Other scopes show no prior scope's warning/data. |
| Acknowledged write followed by a failed refresh | UI says the save was confirmed and the refresh did not complete. Restoring connectivity/reloading alone does not enable another addition; successful explicit inspection and acknowledgment are required. Check failed/cancelled inspection cannot enable acknowledgment and repeated Save clicks create only one request. |
| Calculator/storage, mobile and accessibility | Shared edits do not change account/legacy browser roster or payouts; $100 at 100:50 stays $66.66/$33.33 + $0.01, or $66/$33 + $1. Check keyboard labels, announced states and narrow layouts. |

### Separately reviewed exact synthetic cleanup

PR #37's provisioning cleanup intentionally refuses any roster rows; **do not
weaken it or run it against a roster-editing fixture**. The owner must separately
review a private inventory of exact expected synthetic employee/role IDs and fields,
all active/inactive memberships and the fictional organization. Unexpected rows,
changed ownership or references require investigation, not broader cleanup.

Only after separate owner approval, remove the exact expected synthetic employees,
then their exact roles after verifying no remaining references, then exact approved
memberships and the exact empty organization, checking affected counts and preserving
unrelated rows. Do not cascade, truncate, reset schemas, disable constraints or edit
Auth tables. Before separately approved dashboard Auth deletion, verify each exact
temporary user has no active **or inactive** membership in **any** organization.
Sign out test browsers and remove only separately approved fictional browser storage
entries if desired. No cleanup SQL or hosted execution is supplied by this issue.

## Independent management navigation (Issue #48)

The restaurant workspace sits below the signed-in application header, independently
of Calculation source. A verified restaurant offers **Manage roster** from either
browser-local or shared calculation mode. Multiple memberships still require an
explicit restaurant selection. Authentication alone never grants membership;
management independently verifies the current admin/closer membership with the
existing adapter, column grants and RLS.

Management replaces the calculator view, with **Back to calculator** navigation.
It uses React view state without a router. The calculator remains mounted in a
hidden, inert subtree; shared access effects, parent minute/focus/visibility/network
checks and Auth subscriptions continue running. The shared selector callbacks also
reject edits while hidden. Failed access removes protected subtrees even while
hidden. Ordinary navigation preserves source, cash/credit text, rounding, selection,
exact temporary weights (including invalid text), temporary participants and addition
drafts. Source changes retain their existing explicit shared-preview reset behavior.
Account/project/restaurant changes retain their existing scope isolation.

An open editor requires **Keep editing** or **Discard draft and return** before
Back can leave management. Browser unload receives the standard unsaved-draft guard;
mobile browser delivery of that event is not guaranteed. Restaurant selection is
disabled while verified management is open: return first, resolving any draft.
Sign-out and access failure still clear protected drafts immediately. Failed roster
reads retain only freshly verified restaurant options and allow recovery/switching.
Back is disabled during an active save; existing interrupted-save recovery remains
in effect for refresh, expiry, Auth changes, offline failure and unmount. No pending
write is replayed by navigation.

Management saves never reload the frozen calculator defaults. Only the existing
**Reload shared roster / clear selection** action replaces them, with its stated
reset of selections, temporary weights and one-time participants. No shifts,
schedules, membership administration, new permissions or database changes are added.

Owner iPad Safari acceptance remains pending, using synthetic data in portrait and
landscape:

- Enter/exit management from each calculation source; confirm calculator controls
  are absent in management and the restaurant remains clear. Check touch targets,
  VoiceOver, external-keyboard navigation and focus on entry/return.
- Enter cash/credit, rounding, selected employees, temporary weights (valid and
  invalid), a one-time participant and an addition draft. Return from management
  and verify every value and payout state. Edit a permanent default; verify it
  affects this preview only after explicit reload and its documented resets.
- Open a management draft, choose Back/Keep editing, then Back/Discard. Check
  browser reload/close warnings where Safari supports them. Wait several minutes,
  refocus and revalidate; verify expiry/conflict behavior and no automatic save.
- Check multiple restaurants, account/sign-out changes, failed/offline checks and
  revocation while management is visible. No previous protected rows/drafts may
  reappear on return. Confirm current admin/closer permissions and nonmember denial.

React tests use synthetic data and mocked SDK transports; they do not establish
native Safari or real Auth/PostgREST/RLS behavior. No hosted DEV access or deployment
is part of this work.

Issue #48 verification (Linux, Node 24.19.0 / npm 11.9.0): `npm run check`
passed 412 frontend tests in eight files, 14 offline provisioning checks, 41 offline
roster harness tests, ESLint, TypeScript and the Vite production build.
`git diff --check` passed. Independent manager access failures trigger parent
verification so the hidden shared preview is rechecked without waiting for the
minute timer. Native iPad Safari, database and real Auth/PostgREST checks were not
run for this frontend change; hosted DEV was not accessed.

### Management organization and inline editing (PR #52 follow-up)

Job roles and Employees have separate headings with prominent **Add role** and
**Add employee** buttons aligned at the top of the management sections on tablet
layouts. Roles are alphabetized with their exact default weights and status.
Employees are grouped by permanent default role ID; groups and names are sorted
alphabetically with ID tie breakers. Each group starts collapsed and shows its
employee count, including inactive employees. Inactive roles and employees remain
labelled and editable under the same permissions. Duplicate employee names show
IDs and have distinct accessible Edit labels. Calculator grouping is unchanged.

Add forms appear immediately beneath their button; edit forms appear directly
under the selected record, inside its employee group where applicable. Opening a
form focuses its name field and requests only the nearest necessary scroll.
Only one editor can be opened: finish or cancel it before choosing another record.
The group containing an employee draft cannot collapse; other groups can toggle
independently. Successful access checks retain the same mounted form. A conflicting
background reassignment/removal keeps the original draft anchored until explicit
cancellation; it does not rebase or discard input. After a confirmed employee save
and verified refresh, the destination group opens to reveal the saved record.

Snapshot expiry/revalidation, xmin conflict checks, exact decimal transport,
NULL inheritance versus explicit zero, authorization, revocation and interrupted
save recovery continue through the existing manager and adapter. No permanent
employee deletion, database change or new backend operation is added.

Additional owner iPad Safari checks remain pending: in landscape and portrait,
confirm both section/add controls are easy to locate, group headers and forms fit
without horizontal overflow, and keyboard/VoiceOver focus and nearest scrolling
work with a fictional roster of about 49 employees. Exercise all four inline form
placements, group collapse protection, cancellation/Back guards, creation, editing,
reassignment and save feedback. The owner's earlier discovery of Add employee was
a layout observation, not a verified creation failure or a manual creation pass.

Follow-up verification: `npm run check` passed 419 frontend tests in eight files
(including 99 management tests), 14 offline provisioning checks, 41 offline roster
harness tests, ESLint, TypeScript and the Vite build on Linux / Node 24.19.0 /
npm 11.9.0. Seven new management regressions use a fictional 49-employee roster;
existing tests now open collapsed groups explicitly and use the concise add labels.
`git diff --check` passed. These are mocked React/SDK and offline checks, not native
iPad Safari or live Auth/PostgREST/RLS verification. No hosted DEV was accessed and
nothing was deployed.

### Browser-local view without the shared summary (PR #52)

Browser-local calculation no longer renders the redundant read-only shared job-role
and employee lists. Restaurant selection, verified Manage roster access, shared
participant selection and the editable management screen remain available. The
existing bounded roster reads, membership rechecks, refresh timers, cancellation,
tenant isolation and failure/revocation handling are retained; this removes only
the summary rendering. A fictional 49-person regression exercises local payouts,
management from local mode, the shared participant selector, and retained local
inputs/storage when returning. Context/security tests now assert the remaining
verified controls rather than the removed summary rows.

Summary-removal verification: `npm run check` passed 420 frontend tests in eight
files (including 100 management and 41 restaurant-context tests), 14 offline
provisioning checks, 41 offline roster harness tests, ESLint, TypeScript and Vite
build. `git diff --check` passed. Native iPad Safari and live Supabase checks were
not run; no hosted DEV access or deployment occurred.
