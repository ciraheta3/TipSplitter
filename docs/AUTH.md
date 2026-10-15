# Frontend DEV authentication (Issue #29)

TipSplitter supports email/password sign-in and sign-out using the maintained
`@supabase/supabase-js` SDK. This is a browser-local calculation preview with a
DEV login gate. It does not read or write application tables, synchronize rosters,
provision memberships, or deploy anything. Authentication alone grants no restaurant
membership. Database RLS, not the browser gate, authorizes future tenant access.

## Set up your local browser frontend

Use Node 24 and the reviewed feature branch/PR checkout. The owner performs these
steps after review; Codex has not connected to the hosted project.

1. Run `npm ci` in the repository root.
2. For the credential-free prototype, leave **both** frontend variables unset.
   Run `npm run dev` and open `http://localhost:5173`. The amber banner explicitly
   says you are not signed in. This mode keeps the legacy `employees` roster.
3. For hosted DEV login, copy `.env.example` to `.env.local` in the repository root:

   ```bash
   cp .env.example .env.local
   ```

4. Privately verify the intended existing **DEV** project in the Supabase dashboard.
   From its Connect dialog/project API settings, copy its HTTPS Project URL into
   `VITE_SUPABASE_URL` and its **publishable** `sb_publishable_...` key into
   `VITE_SUPABASE_PUBLISHABLE_KEY`. Replace both placeholders. Do not use the
   database connection string, a legacy JWT/anon key, a secret/service_role key,
   database password, access token, or personal credential. Custom domains and
   local Supabase endpoints are deliberately unsupported in this hosted DEV UI.
5. `.env.local` is ignored. Check `git status --short` before committing; only the
   placeholder `.env.example` is tracked. Do not paste credentials/session tokens
   into issues, PRs, screenshots, chat, or logs. `VITE_` variables are bundled into
   browser code: the project URL/reference and publishable key are public by
   design. Runtime validation cannot make a secret placed in Vite config safe.
6. Restart `npm run dev` after any env change, and reload the page. For a production
   bundle, rebuild after config changes. Partial/invalid config shows a setup error
   and no calculator; there is no alternate-backend fallback. To return to offline
   preview, unset both variables (including shell values) and restart Vite.

No CLI login, linking, migrations, database setup, Data API exposure change or
Supabase deployment is needed for this UI. Keep public signup and anonymous login
disabled, email confirmation enabled, and GitHub deployment integration disconnected.
Password login does not use a redirect callback. Do not change Site URL, redirect
allowlists or email templates for this PR; any localhost setting change belongs to
a separate owner review. The existing [hosted infrastructure guide](HOSTED-DEV.md)
is historical setup/authorization guidance, not a prerequisite to rerun its
seven-user fixture for this login check.

## Owner-only manual acceptance with one temporary fictional user

Keep private notes of the exact reviewed commit, DEV project, test account UUID,
checks and cleanup. Use no real employee/restaurant data. These steps deliberately
create **one** account with **no** memberships or application rows.

1. In the approved DEV dashboard, confirm the existing two migrations/settings
   and that previous synthetic accounts/application rows were cleaned up. Do not
   rerun migrations or the hosted authorization verifier. In **Authentication →
   Users → Add user / Create user**, create a unique fictional email such as
   `tipsplitter-preview-<random-suffix>@example.test` with a new random password
   saved privately. Select **Auto Confirm**, not Invite. Verify the actual UUID
   and confirmed status. Do not edit `auth.users` with SQL or add metadata roles,
   restaurant memberships or employee rows. The fictional address cannot receive
   mail; this does not test delivery or confirmation emails.
2. Before configuring DEV, optionally use the local-only prototype to add
   `Legacy Fiction` as an employee, then stop Vite, configure `.env.local` and
   restart. At the DEV login screen, verify the calculator, roster and tip fields
   are absent, including on reload and when navigating directly to localhost.
   Use browser Network tools privately; do not export a HAR containing tokens.
3. Try an incorrect password: expect a generic email/password error, an empty
   password field and an enabled retry button. Browser-native validation handles
   blank fields and malformed email. Temporarily use DevTools Network **Offline**,
   attempt login and verify safe connection feedback (the SDK may retry requests).
   Restore **Online** and use the temporary user's correct password. Expect a
   checking/loading state before the dashboard and a clear signed-in email.
4. The roster must start empty, even if `Legacy Fiction` exists in the legacy
   browser roster. Confirm the UI says browser-local/not synchronized. Add
   `Preview Avery` with weight 100 and `Preview Blake` with weight 50, enter $100
   cash: expect $66.66/$33.33 and $0.01 unassigned. Whole-dollar mode must show
   $66/$33 and $1 unassigned. Toggle back; results return unchanged.
5. Reload: expect a session-checking state with no roster flash, then the same
   verified account and two preview employees. Cash/credit drafts reset to blank,
   the rounding toggle resets, and the saved roster remains. Open a separate
   **private/incognito browser session**: it must show login; after signing in
   with the same temporary account, its roster is empty because browser storage
   is separate. This proves no cloud synchronization, not cross-account isolation;
   automated mocked tests exercise two distinct account UUIDs on one device.
6. As this user has no restaurant membership, it receives only its local preview.
   No organizations, tenant employees, role/admin controls, invitations or shared
   roster should appear. In Network, verify that the app makes Auth requests only,
   with **no `/rest/v1` application-table calls**. There is no table-access UI to
   bypass. Membership/RLS authorization is covered by the separately owner-reported
   hosted suite, not newly tested by this frontend checklist.
7. While online, click **Sign out**. The dashboard and its drafts must disappear
   immediately; login returns. Reload and use browser Back/Forward: authenticated
   content must stay hidden until another successful sign-in. A second normal tab
   sharing this browser session should also hide content on the SDK sign-out event.
   Other browsers/devices are unaffected (`scope: 'local'`). Sign in again: only
   this account's saved local roster returns; drafts remain empty.
8. Optional failure check: while signed in, switch Network Offline, click Sign out,
   and wait for the bounded network attempt. If Auth reports failure, content stays
   hidden and a warning says the saved session **may remain**. Restore Online and
   click **Retry sign-out**; do not leave a shared device until success and a signed-out
   reload. Do not interpret hiding the UI as successful remote revocation. Already
   issued access tokens can remain valid until expiry; sign-out is not token erasure.
9. Sign out of every test browser session. In the approved DEV dashboard, verify
   this exact temporary UUID has no active **or inactive** memberships, then delete
   only this account in Authentication → Users. If any unexpected membership/data
   exists, stop and investigate; do not broaden deletion or disable FK protection.
   Confirm the temporary account is absent and cannot sign in. Confirm no application
   rows were created by the UI. Close private windows; remove only the fictional
   account's `tipsplitter:employees:<encoded-project-origin>:<encoded-user-uuid>`
   localStorage entry via DevTools if desired (sign-out intentionally retains it).
   Keep any preexisting legacy/unrelated browser data. Remove local test credentials
   per your private retention policy. Record sanitized results without identifiers,
   keys, passwords or tokens.

## Implementation and limits

- `supabase.ts` validates the two public variables and lazily creates one client.
  Each HTTP attempt has a 15-second abort deadline (SDK refresh may retry).
  SDK persistence, auto-refresh and cross-tab events remain enabled; URL session
  detection is disabled because signup/recovery/OAuth links are outside scope.
- `useAuth.ts` subscribes before initial `getSession()`, then verifies each new
  token using Auth `getUser(token)` and compares its ID with the candidate session.
  Cached session/user metadata never grant roles. A verified identity is reused
  only for an identical token and ID; refresh verifies the new token without
  resetting same-account drafts. Failed verification/expiry closes the gate.
- Auth callbacks defer SDK calls until outside the callback/session lock. Monotonic
  request generations discard stale initialization, verification and sign-in
  results after newer events or logout. Subscription and timers clean up on
  unmount/React StrictMode replay. The expiry timer hides content if SDK refresh
  cannot complete before the currently verified session expires.
- Login form drafts unmount when loading or signed-in content replaces the form,
  including cross-tab account changes. Sign-out hides and unmounts the calculator immediately and requests local-session
  sign-out through the SDK. Failure keeps a retry gate; it never claims the persisted
  session was removed. Reload can restore that session if sign-out failed.
- Configured roster keys include both project origin and verified Auth UUID. The
  calculator remounts on account change/logout, resetting cash, credit, rounding,
  form fields and errors. Legacy `employees` is never read/imported in configured
  mode. Sign-out retains each account's saved preview; there is no automatic import.
- Namespacing prevents accidental UI disclosure across accounts. It is not encryption
  or protection from someone with DevTools, a shared browser profile, injected code
  or direct filesystem access. Use fictional DEV data and separate browser profiles.
- No public signup, reset, recovery, invite, self-provisioning, MFA, OAuth, organization
  selector, membership writes, application-table client, new migration or deployment
  is implemented. The owner reports completing DEV browser login/logout acceptance
  (PR #30); item-by-item outcomes and temporary-account cleanup were not independently
  documented there. Codex did not perform browser acceptance. Production readiness,
  email delivery/lifecycle and real browser refresh/expiry remain unverified. Existing
  local full-stack harness and calculation engine stay unchanged.

Official guidance reviewed for this implementation:
[React/Vite Auth](https://supabase.com/docs/guides/auth/quickstarts/react),
[password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword),
[Auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange),
[verified user](https://supabase.com/docs/reference/javascript/auth-getuser),
[sign-out scopes](https://supabase.com/docs/reference/javascript/auth-signout), and
[API keys](https://supabase.com/docs/guides/api/api-keys).

## Validation of this change

Codex Cloud, Node 24.19.0 / npm 11.9.0:

- `npm run check`: **122 tests passed** (the original 75 plus 28 mocked React Auth
  tests and 19 configuration/request/storage-key tests), ESLint, TypeScript and
  Vite production build passed.
- `npm run check:db`: passed two clean replays on PostgreSQL 17.11, with constraints,
  timestamps, effective ACLs and simulated membership-scoped RLS. No hosted access.
- `npm run check:hosted-preflight`: all 25 offline/mocked safety checks passed.
- `npm audit`: zero reported vulnerabilities.
- `npm run check:supabase`: attempted, **blocked before stack startup**. The pinned
  CLI's `--version` action exits 1 because it tries to create
  `/home/agent/.supabase` on this environment's read-only home filesystem. No local
  Auth/PostgREST integration assertions ran. The harness is unchanged; rerun on
  Mac Terminal with Node 24 and Docker Desktop using `npm ci` followed by
  `npm run check:supabase`. Prior owner-reported Mac evidence is separate.
- No hosted project was connected, linked, modified or deployed by Codex. Codex did
  not execute browser login/logout, refresh or the manual checklist above. PR #30
  records the owner's report that the DEV login/logout checklist was exercised; its
  individual outcomes and temporary-account cleanup were not independently documented
  there. Hosted refresh/expiry and production acceptance remain unverified.
