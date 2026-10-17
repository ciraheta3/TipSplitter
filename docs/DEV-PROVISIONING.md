# Offline owner-controlled DEV provisioning (Issue #35)

This proposed foundation generates private review plans and SQL files only. It has
**no network, credentials, login, Auth Admin, database driver or SQL execution path**.
It does not provision anything by running the CLI. Merging it or reading this guide
**authorizes no hosted action**. Independent review and owner Mac testing remain
required. Issue #36's separate owner-only acceptance checks are not performed here.

PR #34 is merged. The owner reports its authorized roster read, unrelated nonmember
denial, revocation with an existing session, four-table HTTP GET-only inspection and
cleanup of two temporary synthetic users/fixture passed. Codex did not independently
perform those hosted checks. Extended browser/owner cases remain separate. The
read-only UI, calculator, existing migrations, grants, FORCE RLS, private helper,
local/hosted verifiers and CI security boundaries are unchanged by this workflow.

## Scope and trust

One generated fictional restaurant; an explicitly approved first active admin;
up to 15 additional approved admins/closers; exact membership revocation; read-only
verification; separately approved cleanup of an **empty-roster** disposable fixture.
There is no roster seed/edit/import, invitation, role promotion, reactivation,
account creation/deletion, production administration, public RPC or privileged UI.
Employees are not Auth users. An ordinary browser admin cannot write memberships.
Only a trusted owner database operation can apply the reviewed SQL.

The generator deliberately stores **no project name/reference/URL or credentials**.
The owner compares their private dashboard organization, DEV project name and
reference against an independent private record **before each action**, outside this
plan. A typed attestation is an owner assertion, not technical proof of DEV identity,
synthetic account status or permission. SQL cannot establish the target's purpose.
It must never be used on production or an uncertain target. Do not ask Codex for,
reuse, or paste identifiers from past chats. No seven-user verifier is required.

## 1. Offline plan and review

Use Node 24 on a trusted POSIX machine (Mac Terminal or Linux), in an unlinked
checkout of the independently reviewed commit. No Docker or Supabase CLI is needed
for **generation**. All commands below are offline:

```bash
umask 077
node scripts/dev-roster-provision.mjs plan
```

The command prints only a generated `work/dev-roster-<run>/plan.json` path. `work/`
is already ignored. If it exists with shared permissions, stop, inspect its contents
privately, and make it owner-only before continuing (`chmod 700 work` on an approved
local directory). Do not relax permission checks. Generated directories are 700,
draft input files 600 and immutable identity/sealed/SQL files 400. Symlinks,
hardlinked input files, alternate roots, shared permissions and overwrites fail.
Unsupported POSIX ownership checks fail; do not bypass them on Windows.

Open `plan.json` privately in an editor; never print it to a terminal log. Preserve
`identity.json` unchanged: it fixes the unique run, organization UUID and exact
`Fictional Lantern DEV <run>` name. Names cannot be customized. The initial Auth UUID
slot is **empty**; the script never generates Auth IDs. Before sealing:

1. Independently verify the exact dedicated synthetic DEV dashboard against your
   private record. This instruction does not authorize connecting or creating users.
2. After separate owner approval for the exact accounts and roles, obtain **existing,
   confirmed, synthetic** accounts' actual UUIDs from the owner's dashboard. Do not
   create accounts as part of this CLI workflow. If none exist, stop; account creation
   requires a separate owner decision/procedure. Never insert/update `auth.users`.
3. Fill the first member's `userId`; retain `role: "admin"`; set
   `confirmedSynthetic: true` only after independent verification. For each additional
   preapproved account, append `{ "userId": "<existing-confirmed-synthetic-uuid>",
   "role": "closer", "confirmedSynthetic": true }` (or explicitly approved `admin`).
   These are private editor placeholders, not command arguments or usable fixture IDs.
   Slots are one-based; the first is always admin. UUIDs must be distinct. No email,
   metadata, client-selected role, password, project reference, key or token belongs
   in the plan. Unknown fields are rejected.
4. Copy the exact exported `attestation` sentence from
   `scripts/dev-roster-provision.mjs` into `ownerAttestation`, only if true. Record
   owner, reviewed commit, account confirmation and approvals separately and privately.
5. Review every identity and role before sealing. Replace `<run-directory>` below
   with the printed directory (not the `plan.json` file):

```bash
node scripts/dev-roster-provision.mjs seal work/<run-directory>
node scripts/dev-roster-provision.mjs verify work/<run-directory>
```

`seal` writes a read-only snapshot and SHA-256 fingerprint once. Later commands
compare original fixture identity, draft, sealed snapshot and fingerprint. These
catch accidental edits; **they are not signatures or protection against a malicious
local owner who can replace both plan and hash**. Keep the machine, filesystem and
reviewed source trusted. Do not edit a sealed plan or generated SQL. Each operation
creates its own private directory with `review.sql` and the plan fingerprint.
Existing operation directories are refused, including after partial file writes.

## 2. Read-only first; explicit execution gates

The owner reviews `verify/review.sql` before separately approving any read-only
execution in the independently verified DEV SQL Editor. It reads only the exact org
ID/name, selected Auth UUIDs/confirmation, target roster and **all organizations' active
and inactive memberships for the planned users**. Keep all query results private.
It grants no permission to run mutations. Before bootstrap, confirm absence of the
fixture and independently inspect confirmation/identity. Before every later action,
repeat fresh read-only inspection; an old result is not an authorization record.
The same verification file may be reviewed/reused; generation itself never repeats
or overwrites output.

| Offline generation command (after sealing) | Required owner review before separate execution |
| --- | --- |
| `node scripts/dev-roster-provision.mjs bootstrap work/<run-directory>` | Exact fictional org absent by ID and case-insensitive name, confirmed first synthetic UUID, no conflicting target rows; approve only this org and first active admin. |
| `node scripts/dev-roster-provision.mjs member work/<run-directory> 2` | Approve this exact additional account/role. Earlier planned slots must all exist active with exact roles, and no other target memberships may exist. Add slots in order, one transaction at a time. |
| `node scripts/dev-roster-provision.mjs revoke work/<run-directory> 2` | Approve only this exact organization/user/expected-role active membership becoming inactive. Review the loss of access, including when revoking the last admin. No automatic sign-out. |
| `node scripts/dev-roster-provision.mjs cleanup work/<run-directory>` | Separate cleanup review below; never run as a finalizer or on failure automatically. |

Read the entire operation's `review.sql`, compare all exact IDs/name/roles to the
sealed private plan and independent dashboard record, approve that **one operation**,
then the owner alone may execute that exact complete transaction in the verified
DEV SQL Editor. Stop on any failed guard or uncertain result. Reinspect rows with
read-only SQL after every operation before advancing. Record only sanitized outcome
categories publicly. No generated SQL, user IDs, dashboard URLs/refs, emails,
passwords, keys, tokens, HARs, screenshots or account exports in Git, PRs or CI artifacts.
Do not force-add ignored files or upload `work/`.

Mutations use qualified fixed tables, a fixed dollar delimiter with strictly checked
values, escaped SQL literals and `standard_conforming_strings=on`. Checks and writes
share a transaction; locks prevent check/write races including concurrent inserts.
Table locks can briefly block unrelated DEV writers and Auth updates: coordinate an
exclusive short owner maintenance window. Lock timeout is 5 seconds, statement
timeout 30 seconds; failures abort. A trusted database identity must be able to
inspect all relevant rows and acquire these locks. A permission mismatch is a stop,
not a reason to widen grants/RLS or change managed Auth. No hosted compatibility
pass is claimed by the local mock-Auth tests.

No operation uses upsert, silently promotes/reactivates a membership, or treats a
retry as success. Duplicate/inactive memberships refuse member creation. Adding a
later slot after an earlier revocation refuses unexpected state. Successful
bootstrap is atomic; another bootstrap fails. Missing organization, partial manual
execution, name duplicates/rename, changed role/state and unknown rows require
private investigation. A failed transaction commits nothing; an interrupted SQL
Editor may leave an uncertain result or open transaction. Inspect/roll back that
session explicitly and inspect persisted rows before deciding anything else. Never
paste isolated statements, remove guards, regenerate a new fixture to mask failure,
or retry blindly. Preserve partial local output for inspection; do not overwrite it.

## 3. Owner-only DEV acceptance worksheet (not executed)

This worksheet documents expectations, not approval. Keep each row **pending** until
separately authorized and performed by the owner. Issue #36's extended owner-only
checks remain separate; no new hosted fixture or browser acceptance is authorized
by Issue #35 implementation, this PR, merging, or the commands above.

1. Record reviewed commit, independent DEV identity, owner approvals and existing
   confirmed synthetic UUID/role assignments privately. Public evidence contains
   only sanitized pass/fail, versions and limitations.
2. Review/run approved read-only verification; compare exact pre-state. Separately
   approve bootstrap, then check one exact organization and one active admin row.
3. If separately approved, add the next planned member and verify its exact role
   and active state, plus unchanged earlier rows. Ordinary browser admins still
   have no organization/membership write grants. Do not run mutation probes here.
4. With an already valid synthetic session, the read-only roster should show its
   authorized restaurant (empty roles/employees for this foundation). The calculator
   stays browser-local. Nonmembers see `No restaurant access assigned`.
5. If separately approved, revoke the exact planned membership without re-sign-in.
   RLS denies that restaurant on the next statement. After **Refresh access**, focus
   or the next minute check, old shared rows clear; no-membership users see the
   no-access message. Other active memberships remain selectable. Background timer
   throttling can delay checks; revocation does **not** sign out or invalidate a JWT.
6. Inspect fresh read-only state and record results privately; then use a **separate**
   cleanup approval. Extended multi-tenant/browser/accessibility/expiry cases are
   deferred to Issue #36, not claimed as performed by the generator tests.

## 4. Separate disposable-fixture cleanup

Never clean up automatically on success, error, cancellation or process exit.
First inspect the exact organization, every membership including inactive rows,
and both roster tables with the verification SQL. This tool never seeds roster rows;
**any role or employee row stops generated cleanup**. Unknown memberships or changed
roles/state also stop it. Do not broaden deletion, use TRUNCATE/CASCADE, reset a
schema, disable FK/RLS or write Auth tables. A fixture later used for roster editing
needs a separately reviewed exact-row cleanup plan outside this foundation.

After explicit private cleanup review, create `cleanup-review.json` in the **same**
run directory, mode 600. Its only fields are `ownerApprovedExactCleanup: true` and
`states`, one entry per sealed member in slot order. Each entry must match observed
`"active"`, `"inactive"` or `"absent"` (never added). The first cannot be absent.
For example, for a three-slot plan whose first member is active, second revoked,
and third never added, privately write:

```json
{ "ownerApprovedExactCleanup": true, "states": ["active", "inactive", "absent"] }
```

Generate `cleanup/review.sql`, inspect and approve its exact rows separately, then
owner execution deletes only the listed matching membership rows followed by the
exact org. It compares the **entire target membership set** before any DELETE,
requires zero target roster rows and checks every affected-row count. Missing/extra
rows, wrong role/active state, partial execution and retries fail closed. Other
organizations and their memberships remain untouched. This is fixture disposal,
not general account erasure, audit retention or production lifecycle administration.

After cleanup, run fresh read-only verification. Confirm the org is gone and each
planned user has **zero active AND inactive memberships in EVERY organization**
before any separately approved temporary-account deletion through Dashboard Auth.
Inactive memberships still have `ON DELETE RESTRICT`; revocation alone does not
permit Auth deletion. An unrelated membership is a reason to retain the account
and investigate, never delete that membership to make cleanup pass. Sign out test
browsers as appropriate. Auth deletion itself is separate dashboard-only work,
never generated SQL. Confirm only the exact approved temporary accounts were
removed. Keep private run files until all results are understood and cleanup is
confirmed, then remove only that run directory per the owner's retention policy.

## Automated evidence and limits

`npm run check` preserves all 153 frontend tests and also runs the offline generator
suite. `npm run check:db` first runs the unchanged two clean security replays, then
`check:dev-provision-db` executes generated transactions on two fresh networkless,
portless, tmpfs PostgreSQL containers with disposable **mock Auth**. No schema/RLS
changes to make provisioning pass; the mock table alone adds confirmation timestamp
support. Tests cover positive lifecycle, duplicate/inactive/conflicting state,
wrong/missing/unconfirmed users, cross-tenant preservation and transactional rollback.
They establish SQL behavior, not actual managed Auth, JWT or hosted compatibility.
`check:hosted-preflight` remains offline and independent; `check:supabase` remains the
unchanged separate local full-stack harness. Run-specific results and environmental
limitations are recorded in the PR; do not infer hosted acceptance from local tests.
