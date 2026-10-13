# Secure roster foundation (Issue #14)

PostgreSQL provides exact numeric storage, foreign keys, transactions and row-level
security (RLS). Supabase is the intended managed PostgreSQL/Auth platform for the
future shared application. This PR adds portable SQL with Supabase API role names;
it creates no hosted project, Auth integration, client SDK, API or frontend connection.
The existing React application still uses its browser-local roster.

## Entities and tenant boundary

One `organization` represents one restaurant/workspace. The MVP can have a single
organization, but there is no global/default tenant ID or seed tenant. Future
multi-location organizations would require an explicit schema/product decision.

| Table | Purpose and constraints |
| --- | --- |
| `public.organizations` | UUID tenant ID, nonblank trimmed name, creation/update timestamps. Names need not be globally unique. |
| `public.job_roles` | UUID ID, required organization, configurable name and required default weight, active flag, timestamps. Role names are unique ignoring case within an organization using PostgreSQL `lower`; no fixed enum or predefined weights. |
| `public.employees` | UUID ID, required organization and default role, optional default weight override, active flag, timestamps. Duplicate employee names are allowed. Employees are roster records, not login accounts. |

The composite foreign key `(organization_id, default_role_id)` references
`job_roles(organization_id, id)`. An employee cannot reference another tenant's role,
including through updates. Foreign keys prevent orphan tenants/roles. UUID defaults
use PostgreSQL's built-in `gen_random_uuid()`; no extension is required. UUIDs are
identifiers, never proof of permission. The unique role-name index and employee
`(organization_id, default_role_id)` index support tenant queries and FK checks.

Role/default weight changes are current roster metadata. They do not assert that an
employee works the same role every shift. Any later shift participation record must
have its own organization-scoped role and weight snapshot. Changing a roster default
must never rewrite historical payouts. No shift or financial tables exist here.

## Exact weights and input boundaries

Weights store **displayed shares** as PostgreSQL `numeric` without a precision/scale
modifier. CHECK constraints require a nonnegative value, at most two fractional
digits, and at most `90071992547409.91`. The upper bound also excludes `NaN` and
positive infinity; the lower bound excludes negative infinity. A `numeric(p, 2)`
column would round an over-precision input *before* a CHECK could reject it, so it
is deliberately avoided. Even trailing extra fractional zeros are rejected.

The existing engine uses `WEIGHT_SCALE = 100`: `100` shares maps to `10000` units,
`0.25` to `25`, and the maximum maps to `Number.MAX_SAFE_INTEGER` units. Zero is
valid. A `NULL` employee override means inherit the role's default; an override of
`0` explicitly means zero shares. Use `COALESCE(employee.default_weight_override,
role.default_weight)` for the roster default, never a truthiness test.

A future adapter must retrieve exact decimal **text** (e.g. an authorized SQL/API
projection casting numeric to text) and use the existing `parseWeightInput` before
creating a numeric `weightUnits` value. Do not route large decimals through JSON
floating-point numbers or multiply JavaScript decimal numbers by 100. The schema
ensures individual weights fit; the existing engine must still validate the sum of
participant units. This PR does not implement that adapter or change the engine.

Required names are trimmed, nonblank text with bounded lengths (100 characters for
roles, 160 for organizations/employees). Unicode names and duplicate employee names
are supported. `is_active` enables retiring roles/employees while retaining references;
there is no rule yet preventing selection of an inactive default role.

Timestamps use `timestamptz` with statement-time defaults. A trigger preserves
`created_at` on UPDATE and sets `updated_at` to the database statement time. Its
function uses invoker security and an empty search path. Timestamps are metadata,
not a durable audit trail, conflict-resolution protocol or history ledger.

## Access remains closed

All three application tables enable **and force RLS**, with **zero policies**.
The migration explicitly revokes all table privileges from `PUBLIC`, `anon`,
`authenticated` and `service_role`, including possible Supabase default grants.
It also revokes execution grants on the trigger function. No service-role grant,
security-definer function or privileged API is introduced. RLS and table ACLs are
separate defenses: both are tested.

The SQL migration owner owns the database objects; this does not mean a closer or
admin owns every restaurant's data. FORCE RLS covers ordinary table owners, but
PostgreSQL superusers and `BYPASSRLS` roles remain privileged. Do not supply any
privileged key to a browser or treat RLS as a boundary against database administrators.
The local test superuser is used only to apply migrations and synthetic fixtures.

Future authorization must use verified Supabase Auth identities and explicit,
active organization memberships. A guessed organization ID or a client-supplied
JWT organization claim is insufficient. No membership or Auth dependency is modeled
yet; without them there is no safe application access policy to add.

Suggested next small PRs:

1. Agree account/invitation/admin permissions and implement membership records tied
   to verified `auth.users` IDs. Add narrow operation-specific grants and policies
   requiring membership in the row's organization. Test unauthenticated users,
   nonmembers, two distinct tenants, revoked memberships, closer/admin write limits,
   and attempts to change a row's tenant (`USING` **and** `WITH CHECK`). Decide whether
   organization IDs become immutable for app users. Keep employee identities separate
   from login accounts and avoid privileged paths to bypass these checks.
2. Add shared roster access/sync after those policies are reviewed, with exact numeric
   transport, validation and conflict behavior. Plan localStorage import explicitly;
   never upload existing browser data automatically.
3. Introduce shift participation and snapshots in separate work after unresolved
   override/finalization/retention decisions are agreed. Preserve actual money and
   historical payouts.

## Environments, migrations and verification

`supabase/migrations/*.sql` are ordered, forward-only, transactional migrations.
Apply each once through a migration ledger; append a new migration for changes.
Do not edit an applied migration or use `IF NOT EXISTS` to conceal schema drift.
Repeatability means replaying the ordered history onto an empty database, not
reapplying CREATE TABLE to an already migrated database.

No Supabase CLI configuration is needed for this small schema. Avoiding a full
Supabase local stack keeps the existing frontend install/start workflow independent
of backend services. The existing Codex Cloud install script and Start Skill are
unchanged. Hosted dev/staging/production projects and the Supabase CLI version/config
will be chosen in subsequent work; do not link or push this PR to a hosted project.

With Node 24, Bash and a running **local** Docker daemon at
`/var/run/docker.sock` (Docker Desktop or the GitHub Actions Ubuntu runner):

```bash
npm ci
npm audit
npm run check       # Existing test/lint/build; does NOT validate SQL
npm run check:db    # Actual PostgreSQL migration/schema/security assertions
```

The database check can also run without npm dependencies:

```bash
bash -n scripts/check-db.sh
bash scripts/check-db.sh
```

The runner uses `postgres:17-bookworm`, reports `SELECT version()`, and uses `psql -X
--set=ON_ERROR_STOP=1` to apply every migration in filename order. It recreates the
schema and simulated Supabase role/default-grant setup, then replays and tests a
second time. PostgreSQL major 17 is selected; patch updates follow the image tag.
For strict byte-for-byte tool reproduction, record/pin the image digest from a check
run. No ports, host directories, database URL, credentials or existing data are used:
the container has no network, stores its database in tmpfs and is removed on exit.
The fixed password is a disposable local test value, never a hosted secret.

`supabase/tests/bootstrap.sql` creates only simulated API roles/default ACLs in the
disposable database. **Never apply it to a hosted project.** `roster.sql` tests real
catalog RLS/ACL state, constraints on INSERT/UPDATE, cross-tenant references, exact
weight bounds/precision/non-finite values, NULL vs zero, role flexibility, timestamps
and restricted deletion. It tests denied client operations, then temporarily grants
DML privileges to verify RLS still hides all rows and rejects inserts. All synthetic
fixtures, claims and test grants roll back. SQL assertion failures fail CI. A separate
database job supplements the unchanged Node 24 frontend checks.

These checks validate PostgreSQL SQL execution and database authorization, not the
full hosted Supabase environment. Supabase Auth/JWT issuance, PostgREST behavior,
numeric JSON transport, hosted default/inherited grants, CLI migration-ledger
integration, backups and restore are unverified here. Before eventual shared access,
validate those in an isolated development project with synthetic data and inspect
table/column ACLs, role inheritance and policies. Never use production credentials
for this validation. If Docker is unavailable, report SQL as **not executed**; the
frontend check is not a substitute.

Verification on 2026-10-12: Node `24.19.0`, npm `11.9.0`; `npm ci` passed,
`npm audit` reported zero vulnerabilities, and `npm run check` passed all 60 tests,
lint and production build. `bash -n scripts/check-db.sh`, `git diff --check` and
`npm run check:db` passed, including both clean replays on PostgreSQL `17.11`.
The database image digest was
`sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826`.
No hosted Supabase, Auth/PostgREST or CLI-ledger checks were performed. Manual UI
smoke checks were not repeated; there are no frontend source changes in this PR.

## Lifecycle and open decisions

There is no seed or real restaurant/staff data. Foreign keys use `ON DELETE RESTRICT`
instead of cascading a tenant/role deletion into its roster. Active flags support
retirement; neither flag nor timestamps implement audit, retention or erasure policy.
No financial record can be inferred from this schema.

Open product/security decisions are also tracked in [PRD.md](PRD.md): membership and
admin capabilities for roughly 14 rotating closers; invitation/revocation and account
recovery; inactive-role behavior; whether changing an employee's default role retains
or clears its override; shift-specific override precedence; tenant moves; retention,
deletion, audit and backup requirements; offline/simultaneous-edit conflicts; and
future deployment ownership. Early departure, understaffing, residual allocation,
finalization and corrections remain undecided. This foundation settles none of them.
