# Roster schema and authorization (Issues #14 and #21)

PostgreSQL provides exact numeric storage, foreign keys, transactions and row-level
security (RLS). Supabase is the intended managed PostgreSQL/Auth platform for the
future shared application. The migrations use Supabase API role names and reference
its managed Auth identities.
They create no hosted project, login flow, client SDK, API or frontend connection.
The existing React application still uses its browser-local roster.

## Entities and tenant boundary

One `organization` represents one restaurant/workspace. The MVP can have a single
organization, but there is no global/default tenant ID or seed tenant. Future
multi-location organizations would require an explicit schema/product decision.

| Table | Purpose and constraints |
| --- | --- |
| `public.organizations` | UUID tenant ID, nonblank trimmed name, creation/update timestamps. Names need not be globally unique. |
| `public.job_roles` | UUID ID, required organization, configurable name and required default weight, active flag, timestamps. Role names are unique ignoring case within an organization using PostgreSQL `lower`; no fixed enum or predefined weights. |
| `public.organization_memberships` | One `(organization_id, user_id)` primary key per restaurant/Auth identity, required `admin` or `closer` role, `is_active` revocation flag and database-managed timestamps. |
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

## V1 authorization model

The forward migration `20261013090000_roster_authorization.sql` adds memberships
and operation-specific RLS policies without rewriting the merged roster migration.
All four tables enable **and force RLS**. Table ACLs and RLS are separate defenses.

| Operation within a restaurant | Active admin | Active closer | Anon / nonmember / revoked |
| --- | --- | --- | --- |
| Read organization, roles and employees | Allow | Allow | Deny |
| Add/edit/activate/deactivate roles and employees | Allow | Allow | Deny |
| Read own active membership | Allow | Allow | Deny |
| Read other members, including inactive records | Allow | Deny | Deny |
| Create/edit/revoke memberships or assign admin privileges | Deny; future trusted administration | Deny | Deny |
| Create/rename/delete organizations | Deny | Deny | Deny |
| Permanently delete roster records | Deny; use `is_active` | Deny; use `is_active` | Deny |
| Change roster IDs or move records between restaurants | Deny | Deny | Deny |

`authenticated` receives SELECT on the four tables and **column-level** INSERT and
UPDATE only on roster fields. Inserts supply the organization and editable fields;
IDs and timestamps come from the database. Updates permit names, weights, employee
default roles and active flags, never `id`, `organization_id` or timestamps. This
prevents tenant reassignment even when a user belongs to both restaurants, which
`USING` and `WITH CHECK` alone would allow. The existing same-organization role FK
still applies. Organization and membership tables have no client write grants or
write policies; no table has a DELETE policy. `PUBLIC`, `anon` and `service_role`
have no table grants. No browser service key or client membership-management RPC
is supplied. Database administrators remain trusted: superusers and `BYPASSRLS`
roles bypass RLS, and future grant changes must preserve the column restrictions.

Memberships reference the real Supabase-managed `auth.users(id)`; employees remain
independent roster records, never login accounts. Policies use `auth.uid()` and an
**active database membership for that row's restaurant**, ignoring tenant/role
claims from clients. A valid session without membership grants nothing. Setting
`is_active = false` removes access on the next statement even with the same session;
revoking one restaurant leaves unrelated active memberships intact. Authorization
uses current statement visibility, not an audit ledger or session invalidation.

### Private membership lookup

Querying memberships from their own RLS policy would recurse. The sole elevated
helper, `tipsplitter_private.membership_role(uuid)`, returns only the current
`auth.uid()` caller's active role for a requested restaurant, or NULL. There is no
arbitrary user argument or write path. It is STABLE, SECURITY DEFINER, has an empty
`search_path`, fully qualified `public.organization_memberships`/`auth.uid()`
references and a fixed `postgres` owner. The migration fails closed unless that
trusted owner is superuser or has BYPASSRLS, necessary to read through FORCE RLS.
Only `authenticated` gets schema USAGE and helper EXECUTE; nobody receives CREATE
on this private schema. PUBLIC/anon/service_role execution is revoked. Keep
`tipsplitter_private` **out of PostgREST's exposed schemas**; no elevated function
is created in the exposed public schema. The existing timestamp trigger remains
SECURITY INVOKER with client execution revoked.

The trust boundary assumes Supabase verifies tokens and supplies `auth.uid()`
through its authenticated request context. Never distribute database login
credentials that let a client impersonate the API role or set raw JWT session
variables. The disposable fixture simulates this context; it does not validate it.

### Trusted provisioning and lifecycle

This migration seeds no organizations, identities or memberships. Before eventual
shared access, a secured manual/server administrative operation must verify a
Supabase Auth account's actual UUID, create the intended restaurant through a
trusted database identity, and explicitly insert its first admin membership. Never
derive membership from submitted organization IDs, emails, user metadata or a
self-selected role. This PR supplies no provisioning endpoint or invitation flow.
Subsequent invitations, account recovery, role changes and revocation need a
separately reviewed trusted administrative flow, authorization and audit design.
Even an active admin cannot perform these operations through ordinary API access.

Both membership FKs use ON DELETE RESTRICT. Auth-user deletion is blocked while
any active **or inactive** membership remains: trusted account-erasure work must
explicitly handle memberships first. It cannot cascade into employees or financial
history. `is_active = false` retains the membership but is not an erasure/audit
policy. There is no tenant-move API or client permanent deletion.

Migrations are forward-only. Rollback means a reviewed compensating migration;
to close access during an incident, first revoke authenticated roster grants
(including column grants) and helper execution through a trusted operation. Dropping membership records/tables
as a rollback would lose authorization metadata and must not be automated.

Next work remains live Auth/API validation, trusted account administration and
shared roster sync with exact numeric transport and explicit localStorage import.
Shift participation, finalization/reopening, invitations and historical snapshots
remain separate work. No financial logic or browser-local behavior changes here.

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

`supabase/tests/bootstrap.sql` creates simulated API roles/default ACLs plus a
**test-only** `auth.users` table and `auth.uid()` reading synthetic session claims.
**Never apply it to a hosted project.** The production migration neither creates
nor alters Supabase-managed Auth objects. Both clean replays recreate public,
private and test Auth schemas. `roster.sql` retains the prior schema, exact weight,
NULL vs zero, FK and timestamp assertions. `authorization.sql` continues in the
same transaction, exercising real ACL/RLS behavior for admins and closers in two
restaurants, member-list visibility, anonymous/missing/unassigned identities,
revocation with unchanged claims, mixed-role dual memberships, tenant/key changes,
self-invitation/promotion/reactivation, deletion, helper replacement and search-path
shadowing. Test-only
extra grants isolate RLS INSERT/UPDATE checks from ACLs. Fixtures, claims and grants
roll back. SQL failures fail the separate database CI job.

These checks validate PostgreSQL SQL execution and database authorization, not the
full hosted Supabase environment. Supabase Auth/JWT issuance, PostgREST behavior,
numeric JSON transport, hosted default/inherited grants, CLI migration-ledger
integration, backups and restore are unverified here. Before eventual shared access,
validate those in an isolated development project with synthetic data and inspect
table/column ACLs, role inheritance and policies. Never use production credentials
for this validation. If Docker is unavailable, report SQL as **not executed**; the
frontend check is not a substitute.

Verification for Issue #21 is recorded in its PR. Hosted Supabase authentication,
PostgREST and CLI-ledger integration have not been tested by this SQL harness.

## Lifecycle and open decisions

There is no seed or real restaurant/staff data. Foreign keys use `ON DELETE RESTRICT`
instead of cascading a tenant/role deletion into its roster. Active flags support
retirement; neither flag nor timestamps implement audit, retention or erasure policy.
No financial record can be inferred from this schema.

Open product/security decisions are also tracked in [PRD.md](PRD.md): trusted account
administration for roughly 14 rotating closers; invitations, audited revocation and account
recovery; inactive-role behavior; whether changing an employee's default role retains
or clears its override; shift-specific override precedence; tenant moves; retention,
deletion, audit and backup requirements; offline/simultaneous-edit conflicts; and
future deployment ownership. Early departure, understaffing, residual allocation,
finalization and corrections remain undecided. The V1 roster permission matrix above
is approved; these later lifecycle and financial decisions remain open.
