# Owner-controlled hosted Supabase DEV (Issue #25)

**Current evidence (Issue #29): owner-reported manual hosted DEV verification passed**
with 4,944 HTTP requests, security/catalog audit, trusted persisted comparison and
cleanup of all seven temporary Auth users and fictional application rows. Codex did
not execute or independently verify these hosted actions. The owner reports email/
password and email confirmation enabled, public signup/anonymous login disabled,
GitHub deployment integration disconnected and automatic Data API exposure disabled.
DEV currently has no test users or application data. Production and account lifecycle
capabilities remain untested; this evidence does not establish browser login/refresh.

This guide retains the original project preparation/seven-user authorization
procedure for reference; do not rerun it for frontend acceptance. For Issue #29's
optional login/logout UI and **one-user** owner-manual check, use [AUTH.md](AUTH.md).
The calculator roster remains browser-local. Issue #31 adds a separate read-only
shared view; use its [owner acceptance worksheet](SHARED-ROSTER.md#owner-driven-dev-acceptance-worksheet)
for membership/no-membership checks. Positive hosted fixtures and all provisioning,
revocation and cleanup require separate owner approval and a reviewed procedure.
No hosted access or changes by Codex are authorized by these guides.

## Approval boundaries

Before **each** hosted action, the owner must inspect the selected dashboard
organization, project name and project reference against a private record and
explicitly approve the exact action. A project reference is the identifier in the
dashboard URL, not its display name. Do not include it in Git, issues or PRs.

| Gate | Owner approves | Who executes |
| --- | --- | --- |
| Create/configure DEV | Organization, region, plan/cost, security settings | Owner in dashboard |
| Connect/link | Exact DEV identity and read-only migration inspection | Owner CLI; Codex only with a new explicit approval |
| Migrate | Exact two reviewed migrations, dry-run and backup/rollback plan | Owner CLI, explicit push |
| Accounts/fixture | Seven planned Auth users and generated `setup.sql` | Owner dashboard Auth and SQL editor |
| Verify | Approved project reference, synthetic HTTP mutations and denial probes | Interactive verifier with two typed gates |
| Revoke | Generated `revoke.sql` while original sessions are held | Owner SQL editor, then typed resume gate |
| Persisted audit | Generated `persisted.sql` and catalog/ledger recheck | Owner SQL editor |
| Cleanup | Exact fixture rows and seven account UUIDs | Owner, separately approved; never a test finalizer |

Do not give Codex credentials to production. Approval for preparation, a local
check, a PR, or one stage does not approve later hosted stages. If asking Codex to
help later, state the exact project and authorized actions privately, and stop for
approval before each additional stage. No script creates projects, links, pushes,
resets, changes dashboard settings, provisions accounts or executes remote SQL.

## 1. Create your dedicated DEV project manually

1. Sign in at the Supabase dashboard using your own account; enable MFA. Choose
   an organization you control and agree who owns billing, access, backups and
   eventual deletion. A separate DEV organization is useful when production
   permissions would otherwise be shared. Give access only to needed maintainers.
2. Approve creation, then select **New project**. Name it `tipsplitter-dev`,
   optionally followed by `-<your-fictional-suffix>` (letters, digits or hyphens).
   Matching is case-insensitive: `TipSplitter-dev` and `TipSplitter-DEV-test` are
   also accepted. The explicit `-dev` designation is required; `TipSplitter`,
   `tipsplitter-prod` and `tipsplitter-production` are refused. Choose a region
   near your testing location and consider residency requirements before creation;
   check current availability and plan limits/costs. Generate a unique database password and
   save it in your password manager. Do not reuse any production password/key.
3. Wait for the project to become healthy. Privately record organization, name,
   project reference, API URL, region, PostgreSQL version, creation date and owner.
   Do not restore production backups or copy real rosters, identities or employee
   data. Do not enable automatic GitHub deployments or attach existing integrations.
4. After separately approving configuration, enable the Data API and set its
   **Exposed schemas to exactly `public`** in API/Data API settings. Exclude
   `auth`, `tipsplitter_private` and `graphql_public`. Never follow generic custom
   schema examples that grant ALL to API roles. Leave managed roles/permissions
   alone; the migrations narrow application ACLs. Record automatic default grant
   settings and inspect effective permissions after migration.
5. Keep email/password Auth available, anonymous sign-ins disabled, and public
   signup disabled for this closed test project. Leave email confirmation enabled.
   Do not configure production SMTP/OAuth providers or redirect URLs. An explicit
   localhost development Site URL is sufficient; the verifier uses password Auth,
   not browser redirects. Preserve TLS and check network restrictions available
   on your plan; database restrictions and public Data API access are distinct.

Hosted settings are **not** configured by `supabase/config.toml`. That file is
strictly the named local integration project, whose email confirmations are off.
Hosted email confirmation is normally on. Fictional `example.test` accounts cannot
receive confirmation email: create them through dashboard Auth with **Auto Confirm**
for this synthetic-only test. This verifies password Auth and sessions, not email
delivery, signup confirmation, recovery or invitations. If the dashboard cannot
create confirmed synthetic accounts, stop; use a separately reviewed Auth Admin
procedure rather than writing `auth.users` yourself. A secret/service-role key is
privileged for Auth even though its application-table grants are revoked; keep it
out of this verifier and every browser bundle.

## 2. Prepare locally and apply the existing migrations with the ledger

Use Mac Terminal with Node 24, npm and Docker Desktop for the existing local checks:

```bash
npm ci
npm run check
npm run check:db
npm run check:supabase
npm run check:hosted-preflight
```

These commands do not verify hosted services. Do not run the local reset harness
from a linked checkout. Never upload `supabase/tests/bootstrap.sql`, either SQL
test fixture, or the local account creation code to hosted Supabase. Those SQL
fixtures include mock Auth objects or temporary test grants.

Use a **separate checkout** of the exact reviewed commit for hosted migration work;
keep your local integration checkout unlinked. For example:

```bash
git clone https://github.com/ciraheta3/tip-calculator.git tip-calculator-hosted-dev
cd tip-calculator-hosted-dev
git checkout <reviewed-commit-sha>
npm ci
npx --no-install supabase --version   # Must be 2.120.0
npx --no-install supabase link --help
npx --no-install supabase db push --help
```

Before connecting, privately approve the exact DEV identity. Set the reference
using a prompt (Bash below; run `bash` first if Mac Terminal uses zsh).
The reference is not a secret but must remain out of Git:

```bash
read -r -p 'Approved DEV project reference: ' TIP_DEV_REF
# OWNER-ONLY, after explicit connection/link approval:
npx --no-install supabase login
npx --no-install supabase link --project-ref "$TIP_DEV_REF"
npx --no-install supabase migration list --linked
npx --no-install supabase db push --linked --dry-run --skip-vault
```

Use interactive authentication/password prompts; never place a database password
or access token in command arguments, shell history, committed files or PR output.
Protect the CLI's stored login; log out when finished. Do not publish debug/status
output. A dry-run still **connects** to the hosted database and needs connection
approval. Linking stores private identifiers in ignored `supabase/.temp`; verify
the reference again before every command. Stop if identity is uncertain.

On a brand-new project the application tables must not exist and the remote ledger
must contain neither of the following versions. The dry-run should propose exactly:

1. `20261012230000_roster_foundation.sql`
2. `20261013090000_roster_authorization.sql`

If tables already exist, migrations diverge, or other versions are pending, stop
and investigate. Do not blindly pull, reset, repair the ledger, use `--include-all`,
manually paste migration SQL, or mark unapplied migrations as applied. Preserve
both files byte-for-byte. No seeds are needed. After approving this exact migration
plan and the recovery plan below, the owner may run:

```bash
# OWNER-ONLY, separate explicit migration approval required:
npx --no-install supabase db push --linked --skip-vault
npx --no-install supabase migration list --linked
unset TIP_DEV_REF
```

Do not pass `--include-seed`, `--yes`, `--db-url`, or reset flags. `db push` tracks
applied versions in `supabase_migrations.schema_migrations`; it should apply each
pending migration once. No automatic remote migration command is in npm or CI.
`--skip-vault` prevents the CLI from also updating Vault secrets from local config.
If push fails, inspect the approved project's ledger before doing anything else:
the first migration may already be committed while the second rolled back. Stop
and review the mismatch; do not reset, falsify ledger entries or paste either
migration again. The foundation starts with closed RLS/ACLs. Any compatibility
correction needs a separately reviewed forward migration and approval.

Before pushing, inspect the project's backup availability/retention and agree
recovery responsibilities. Paid backup/PITR options vary; Free projects do not
have the same automatic backup guarantees. For this brand-new empty DEV project,
record that there is no application data to preserve and keep the reviewed source
as the schema rebuild plan. Recreating a failed empty project is a separate owner
decision with separate approval, never an automatic reset. If the project already
has anything worth keeping, stop, obtain a secured backup, and prove restoration
in another isolated approved project before proceeding. Exports may contain
credentials/Auth records; protect them outside Git. Do not call a backup verified
until a restore has actually been tested. Future schema corrections must be new
reviewed forward-only migrations; dropping membership tables is not rollback.

## 3. Verify hosted catalog/ledger security before fixtures

After approving read-only inspection in the **same DEV SQL editor**, run:

```sql
select version();
select version from supabase_migrations.schema_migrations order by version;
select rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit
from pg_roles where rolname in ('postgres','authenticator','anon','authenticated','service_role');
select * from pg_policies where schemaname = 'public' order by tablename, policyname;
select defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl
from pg_default_acl;
```

The ledger must contain exactly the two versions above for this empty dedicated
project. Then open the tracked **`supabase/integration/audit.sql`** locally, inspect
it, and execute that exact file in the DEV SQL editor as the trusted database
owner. It only reads catalogs and creates a transaction-local `pg_temp` assertion
function, then rolls back; it does not modify managed Auth or permanent grants.
It checks effective inherited/PUBLIC table and every-column ACL, FORCE RLS, eight
scoped policies, managed roles/authenticator, private helper ownership/BYPASSRLS,
empty search path and schema/function privileges. Record only assertion outcomes
and non-sensitive version information. Independently inspect that policy expressions
match the migration definitions, not merely their count. Recheck actual dashboard
exposed schemas; the SQL file alone cannot establish the API's exposure settings.

If any hosted catalog expectation fails, **stop before provisioning**. Capture a
redacted assertion label and investigate compatibility in a separate review.
Never enable public helper exposure, relax FORCE RLS, broaden grants, change the
fixed helper owner, grant service-role application access, or edit managed Auth to
make a test pass. No hosted mismatch was discovered or corrected in this PR.

## 4. Create the synthetic Auth users and prepare fictional restaurants

In your **unlinked verification checkout**, generate an offline private plan:

```bash
node scripts/hosted-supabase.mjs plan
```

This prints a `work/hosted-<run-uuid>/config.json` path. Everything in `work/` is
ignored by Git. The directory is mode 700 and the config is mode 600. Open it
privately in your editor; do not paste its contents into chat. It contains random
run/restaurant/role/employee UUIDs and random passwords for exactly seven fictional
emails. Fill `projectName`, `projectRef`, `apiUrl` and `apiKey` (a **publishable** API
key) from the approved DEV dashboard. Legacy anon keys are also accepted when
their decoded role/reference match. Secret/service-role/unknown keys are refused. Privately
compare the reference to your independent owner record before filling
`approvedProjectRef` and setting `ownerAttestedDedicatedDev` to `true`.

`projectName` must match the actual approved dashboard display name, using the DEV
convention above. If a dedicated DEV project is named only `TipSplitter`, the
owner should rename it in the dashboard to reflect its DEV purpose; do not invent
a different name in config. For an existing private plan whose offline `prepare`
failed only at the old name check, keep that plan, its seven Auth UUIDs, emails,
passwords and fixture identifiers. This correction requires no new users,
migrations or permission changes. If no preparation artifacts were created,
retry the offline `prepare` command below with the same config after updating the
script. Existing successfully prepared plans still use the fingerprint gate.

Names/flags are owner attestations, **not proof** that a project is non-production:
Supabase does not certify an environment's purpose via this config. The strict
origin/reference checks prevent accidental alternate targets; the independent
dashboard check and explicit approval establish permission. An opaque publishable
key's project binding is finally checked by the hosted gateway. Custom domains,
local URLs, redirects, unknown identities, public config permissions and CI runs
are refused. The script does not discover projects or read environment credentials.

Separately approve creating these seven Auth accounts. In **Authentication → Users
→ Add user / Create user**, create each planned email/password with Auto Confirm
(not Invite). Copy its **actual Auth UUID** into that config entry's `id` field;
do not generate a user UUID yourself. Verify email, UUID and confirmation in the
dashboard. Only these seven users may exist in this fresh test project.

| Category | Restaurant A: Fictional Juniper Cafe | Restaurant B: Fictional Moonbeam Diner |
| --- | --- | --- |
| admin-A | admin | none |
| closer-A | closer | none |
| admin-B | none | admin |
| closer-B | none | closer |
| dual-admin-A-closer-B | admin | closer |
| dual-closer-A-admin-B | closer | admin |
| nonmember | none | none |

Use the printed path in all following commands (replace the placeholder):

```bash
node scripts/hosted-supabase.mjs prepare work/hosted-<run-uuid>/config.json
```

Preparation is **offline**. It validates config and produces private `setup.sql`,
`revoke.sql`, `cleanup.sql` and a config fingerprint. Existing artifacts are never
overwritten. Changing config after preparation requires a new plan. Do not run
generated SQL until you review it and explicitly approve its exact DEV target.

In the DEV SQL editor, approve and execute **only `setup.sql`**. It requires all
four application tables to be empty, exactly seven real confirmed Auth identities
matching planned UUID/email pairs, and creates two run-named fictional restaurants,
one role/employee each, and the eight memberships above in one transaction.
This is DEV-only trusted first-admin provisioning: account verification precedes
membership insertion. No user metadata/email assertion can self-grant admin.
Do not use an ordinary admin's session or service-role application grants to seed.
Do not modify `auth.users`, copy local Auth mocks, or expose a provisioning RPC.

## 5. Run the hosted HTTP verifier, with approval

From your private interactive Mac Terminal (Node 24; no CI or piped input):

```bash
node scripts/hosted-supabase.mjs verify work/hosted-<run-uuid>/config.json
```

Before its first request, the verifier requires you to type
`CONNECT DEVELOPMENT <approved-ref>` and `TEST SYNTHETIC <run-uuid>`, after checking
the dashboard and approving both connection and the bounded fixture mutations.
An absent/mistyped approval exits. The verifier signs in the **existing** synthetic
accounts and asks Auth to verify each session; it never creates users. Tokens and
refresh tokens are never written to disk or printed. Requests use only the exact
HTTPS origin, reject redirects, and have 15-second timeouts. An HTTP mismatch or
network error stops further tests and leaves the fixture for owner inspection.

The two retained ordinary admins independently read complete row sets before and
after each forbidden application request. Truncated results are rejected rather
than silently passing. The project must have no concurrent writers. Tests cover:

| Case | Required result |
| --- | --- |
| Real password Auth, `/auth/v1/user`, JWT subject/issuer/role | Verified same synthetic identity; actual issued sessions |
| Admin/closer in both restaurants | Exact allowed rows; own roster INSERT 201 and PATCH 200, persisted fields and timestamps, deactivate/reactivate and later GET |
| Dual memberships | Rights scoped to each restaurant's own role, INSERT allowed in both; existing tenant move denied |
| Nonmember / cross-restaurant | Empty exact visible rows; PATCH 200 with **zero rows**; INSERT 403 / `42501` |
| Anonymous | Reads/writes denied with 401 / `42501` |
| IDs/timestamps/tenant moves; DELETE; membership/organization writes | 403 / `42501`, unchanged application rows; even admins cannot grant/revoke/promote members |
| Cross-restaurant default role FK | 409 / `23503`, unchanged rows |
| Revoked admin/closer with original valid session | Lost restaurant hidden and writes denied; dual member retains B rights |
| Helper/public RPC and private schema profile attempts | 404 / `PGRST202`; 406 / `PGRST106` for `auth` and `tipsplitter_private` |
| Ordinary Auth admin list/elevate/delete; corrupted actual JWT | 403 administration denials; 401 invalid JWT |

PATCH/DELETE denial probes have explicit tenant/row filters; a safeupdate 400 or a
constraint/duplicate error is not accepted as a permission pass. Two observers
are useful independent user contexts, but still share the hosted API; complete
verification also needs the trusted database comparison below. The suite uses
small exact weights only; it does not prove safe transport of maximum numeric values.

When the verifier pauses, review **`revoke.sql`** and approve executing it in the
same DEV SQL editor. It revokes A for closer-A and both dual users, and B for
admin-B. It leaves admin-A and the dual B admin as observers. Do not sign out,
refresh, restart the verifier or change account passwords. After SQL succeeds,
type `REVOKED <run-uuid>` at the prompt. Sessions must still be valid: expiry
causes failure rather than a silent refresh. Finish within the project's token
lifetime; a delayed/failed run needs owner inspection and a fresh approved plan.

After HTTP assertions pass, the script creates private **`persisted.sql`**. Review
and approve it, then run it in the same DEV SQL editor. It compares all four actual
application tables, including timestamps and memberships, with the exact HTTP
records. It fails on missing/extra/changed records and makes no permanent writes.
Repeat the ledger query, catalog audit and dashboard exposed-schema inspection.
Only mark the hosted authorization run passed after **all** manual and HTTP checks
pass. The script's success message explicitly says these manual checks are pending.

## 6. Cleanup and record results separately

No automatic cleanup runs on success, failure, cancellation or process exit.
Keep the private config/artifacts until you understand failures and can identify
all created accounts/rows. Before cleanup, inspect the two organizations by their
exact UUIDs and run-suffixed names, and review each generated DELETE. Separately
approve **`cleanup.sql`**: it checks both organization identities, then deletes
only their employees, job roles, memberships and organizations, in FK-safe order.
It never truncates, resets, drops schemas or deletes Auth rows. If fixture setup
failed/was partial, or an unexpected permitted denial probe created other data,
stop and design a reviewed cleanup for that exact residual data; never broaden
the generated WHERE clauses or delete all users/tables. No project deletion is
part of this workflow.

Confirm the seven account UUIDs have **zero memberships in every organization**.
Then approve deleting only those exact accounts through dashboard Auth. Inactive
memberships also trigger the RESTRICT FK; do not disable it. Independently confirm
the four tables and synthetic Auth accounts are empty. Remove the private run
directory only after cleanup is confirmed, following your secret-retention policy;
log out of CLI and close dashboard SQL tabs containing private identifiers. If a
key/password leaked, rotate it in the exact DEV project after approval.

Privately record reviewed commit, CLI/database versions, project identity, owner,
approval stages, manual ledger/catalog/fixture/persisted checks, HTTP outcomes,
cleanup outcome and untested items. Public PR/issues should contain only redacted
outcomes, versions and assertion categories, never URLs/refs/UUIDs/emails,
passwords, keys, tokens, config, SQL artifacts, account exports or screenshots.

Unverified beyond this procedure: hosted email delivery/confirmation/signup,
recovery, refresh/expiry flows, invitations/MFA for application users, numeric-text
transport, browser login/sync, backup restoration and production readiness. A
successful synthetic authorization run does not establish these. Privileged
service-role application denials are checked via effective SQL ACLs, not by giving
that privileged key to the HTTP verifier.

## Official references audited for this preparation

Supabase documentation checked 2026-10-13. The guide deliberately chooses manual
owner gates instead of adopting the vendor's automated deployment examples:

- [Managing environments](https://supabase.com/docs/guides/deployment/managing-environments)
  and [database migrations](https://supabase.com/docs/guides/local-development/database-migrations).
- [CLI reference](https://supabase.com/docs/reference/cli/introduction): `link`,
  `migration list`, `db push --dry-run`; use the pinned CLI's help for exact flags.
- [API keys](https://supabase.com/docs/guides/getting-started/api-keys) and
  [exposed schemas](https://supabase.com/docs/guides/api/using-custom-schemas).
- [Password Auth](https://supabase.com/docs/guides/auth/passwords) and
  [Auth user management](https://supabase.com/docs/guides/auth/managing-user-data).
- [Available regions](https://supabase.com/docs/guides/platform/regions),
  [security checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
  and [backup limitations](https://supabase.com/docs/guides/platform/backups).
