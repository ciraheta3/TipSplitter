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
and failed access verification clear shared persistence as well as memory. Explicit
roster reload retains tip inputs/rounding, matching the existing mounted calculator.
Discard draft resets tips, rounding, selection, temporary participants and forms,
keeping permanent rosters. Management navigation preserves the calculator.
Auth verification failure/expiry clears the known account's calculation drafts;
local roster records remain. Abort signals and scope keys reject late responses.

Offline recovery never displays cached shared data. If startup cannot verify access,
the shared draft is cleared, following the existing fail-closed failure policy;
reconnect and re-enter the preview. Merely pending checks do not clear it. Browser-
local drafts work offline if the application is available (configured Auth still
requires its existing verification). No offline authorization or synchronization
protocol is introduced.

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
3. On a real iPad, lock/sleep Safari, resume after suspension, and reload if Safari
   did not reload itself. Leave open through two 60-second checks: no input loss,
   recurring flash or scroll jump. Check narrow portrait and landscape layouts.
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
