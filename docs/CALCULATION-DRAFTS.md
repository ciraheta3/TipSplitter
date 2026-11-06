# Calculation draft recovery (Issue #56)

Drafts are unfinished previews on this browser/device, never payments or history.
The small version-1 localStorage format stores raw cash/credit text and rounding.
Shared drafts additionally store selected IDs, exact weight text, original temporary
participant weights and UUID identities, unfinished addition fields, and minimal
references (ID, role and effective default) for referenced shared employees. It
never stores tokens, secrets, a full shared roster or calculated payouts.

Local keys reuse the existing roster's project/account namespace (or `employees`
for unconfigured mode), but never write to the roster key. Shared keys also include
the restaurant. A separate versioned context remembers source and restaurant ID.
Only the verified Auth subtree reads account drafts. Shared UI stays hidden until
current membership and a fresh complete roster pass the existing checks on both
sides of roster reads. Browser storage is untrusted and bounded/validated.

Ordinary input events save synchronously; no unload event or debounce window is
required. Initial empty state and pending/background checks never save. Routine
successful checks retain the frozen snapshot and exact draft text. On recovery,
current names are used; a renamed employee retains its stable identity. Missing,
inactive, role-changed or effective-default-changed referenced employees lose
selection/overrides. A visible review gate blocks payouts until acknowledged;
reselecting uses the current default. Unchanged references retain overrides,
including zero and invalid text. New roster rows start unselected. A changed
underlying default with the same effective weight does not change the preview.

Leaving shared mode, restaurant changes, sign-out/account changes, explicit reload
and failed restaurant access verification clear shared persistence as well as
memory. Explicit roster reload retains tip inputs/rounding, matching the existing
mounted calculator.
Discard draft resets tips, rounding, selection, temporary participants and forms,
keeping permanent rosters. Management navigation preserves the calculator.
Auth expiry hides/unmounts protected UI and invalidates pending verification without
clearing saved drafts. Same-account reauthentication must verify Auth again; shared
recovery then checks current membership and loads/reconciles a fresh roster. Local
roster records remain. Abort signals, request generations and scope keys reject late
responses, including refresh verification superseded by the expiry deadline. That
response cannot reopen the gate; a fresh SDK event, sign-in or reload is required.

Offline recovery never displays cached shared data. An expired/missing/non-finite
candidate expiry or recognized temporary Auth verification failure closes the gate
and retains scoped drafts, without reading them into a calculator. Recognized
failures are SDK retryable fetch errors, network TypeErrors, abort/timeouts, and
Auth API HTTP 408/429/5xx. An Auth `bad_jwt` response for an already-expired local
candidate also cannot establish revocation. Unknown errors, missing/mismatched
verified users, and other Auth rejections still clear the candidate's drafts.
Remembered candidate IDs are used only for clearing on later sign-out/account
switch, never to authorize or display stored data.

If a shared restaurant/roster access check fails after the Auth gate is open, its
protected draft is still cleared under the existing policy, including offline or
transient shared-access failures. These checks are unchanged. Merely pending checks
do not clear it. Browser-local drafts work offline if the application is available;
configured mode always requires verified Auth. There is no offline authorization
cache or synchronization protocol.

The Supabase SDK's `SIGNED_OUT` event does not expose whether the cause was an
explicit local/cross-tab sign-out or SDK removal after a permanent session/refresh
failure. All `SIGNED_OUT` events retain the conservative destructive policy, even
after local expiry. Session absence in `INITIAL_SESSION`, `SIGNED_IN` or
`TOKEN_REFRESHED` alone hides the UI without deleting drafts. A later different
candidate account clears the previous scope even if it is no longer verified.
Thus access-token expiry alone is recoverable, but an SDK-confirmed session removal
can still destroy drafts. No extra SDK calls occur inside synchronous callbacks.

Malformed, oversized or unsupported entries produce a warning and stay untouched
until an explicit edit/discard replaces them. Storage denial/quota failure permits
session-only work with a warning. A failed clear cannot promise physical erasure;
the UI reports it. Device/browser access can expose stored names and inputs: use
separate browser profiles on shared devices. Safari may evict storage, and private
browsing may not retain it. No multi-tab merge/conflict resolution is provided.

## Netlify PR preview acceptance (owner, fictional data only)

1. Open the PR preview in Safari. Enter local cash/credit and toggle rounding;
   wait for “Draft saved on this device”, reload, verify exact inputs and payouts.
2. Sign in with an existing authorized fictional account. Choose Restaurant roster
   and a restaurant. Select employees; edit weights to `0`, `01.50`, and invalid
   `1..`. Add two temporary participants with the same name. Start a third form.
   Reload: verification precedes recovery; IDs remain distinct, text is exact,
   invalid selected text blocks payouts. Correct it and compare cents/remainder.
3. On a real iPad, lock/sleep Safari beyond the current access-token lifetime,
   resume and reload if needed. Without an SDK `SIGNED_OUT`, the gate must close
   at expiry while drafts remain saved; same-user sign-in/refresh recovers them
   only after fresh Auth and restaurant verification. Do not change hosted token
   settings or expose tokens in logs. Leave open through two 60-second checks:
   no input loss, recurring flash or scroll jump. Check portrait and landscape.
   Also check sign-in as a different account after expiry: the old scope clears
   and its inputs/participants never appear in the new account.
4. Discard, reload, switch sources/restaurants, navigate to management and back,
   and sign out/in: deliberate clears stay cleared; navigation alone retains work.
   Use existing authorized test accounts to check account isolation.
5. With separately authorized owner fixtures only, change a default/deactivate a
   selected employee, then reload: review is required and changed rows excluded.
   Revoke access: protected UI disappears and the old draft never returns.
6. Try Network Offline during startup/checks, reconnect/retry, malformed draft
   storage and blocked storage. Expect fail-closed shared UI or a storage warning,
   never a crash or cached unauthorized roster. No hosted modification is needed
   for the ordinary reload/sleep tests; this implementation performs none.

## Executed verification (2026-11-05, Codex Cloud)

- Final `npm run check`: 473 Vitest tests, 14 offline DEV-provisioning tests,
  41 offline roster-editing script tests, ESLint, TypeScript and Vite build passed.
- Targeted recovery run before the final three additional cases: 209 tests across
  App, Auth, SharedCalculation and calculationDraft passed. All additional cases
  are included in the final full check above.
- `git diff --check` passed. Tests use synthetic data/mocked transport or jsdom;
  they do not establish real Safari/iPad sleep, scroll, hosted RLS or Netlify success.
- No migration, database test, hosted Supabase operation, manual deployment or real
  iPad/browser acceptance was performed. Independent review/CI and owner preview
  acceptance remain required.


## P2 Auth-expiry correction verification (2026-11-06, Codex Cloud)

The reviewed implementation deleted persisted drafts both at the local token
expiry deadline and in generic verification catches. It also forgot the previous
storage identity after losing verification, and the shared calculator's Auth
listener could independently delete a draft on expired/null session events.
The correction separates those transitions from deletion without relaxing the
Auth gate, deadline, request generations or shared access checks described above.

- `npx vitest run src/Auth.test.tsx src/SharedCalculation.test.tsx src/calculationDraft.test.ts`:
  **227 passed**. Includes persisted-value assertions for expiry, expired browser
  restoration, password/event reauthentication, deferred identity and membership
  checks, invalid weight text, duplicate temporary identities, pending refresh,
  late responses, explicit/cross-tab sign-out, account switching, temporary versus
  confirmed Auth failures, revocation and two periodic restaurant checks.
- `npm run check`: **505 Vitest tests**, **14** offline DEV-provisioning tests,
  **41** offline roster-editing checks, ESLint, TypeScript and Vite build passed.
- `git diff --check`: passed.
- Separate database checks are unnecessary for this frontend lifecycle correction:
  no SQL, RLS, migrations, API queries, database writes or payout rules changed.
  `check:db`, real local Supabase integration and hosted checks were not run.
- SDK session-removal/event behavior was inspected in the installed Auth client
  source. The tests use synthetic accounts/records and mocked transport/jsdom;
  live SDK/browser/iPad sleep/refresh behavior still needs owner acceptance.
  No hosted Supabase DEV access, manual deployment or merge was performed.
