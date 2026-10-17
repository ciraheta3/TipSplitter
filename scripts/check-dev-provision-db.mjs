// Disposable LOCAL PostgreSQL only. No connection strings, remote contexts or Auth API.
// Mock Auth verifies SQL guards, not real Supabase confirmation/JWT behavior.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { newPlan, attestation, generateSql, literal } from './dev-roster-provision.mjs'

const env = { ...process.env }
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key]
function docker(args, input) {
  const r = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { env, input, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
  if (r.error) throw new Error('Local Docker action unavailable/timed out; vendor output withheld.')
  return r
}
const requireSuccess = (r, label) => { assert.equal(r.status, 0, `${label}; vendor output withheld`); return r.stdout.trim() }
let container
function cleanupContainer() {
  if (container) {
    requireSuccess(docker(['rm', '-f', container]), 'Remove disposable PostgreSQL')
    container = undefined
  }
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(signal, () => {
  try { cleanupContainer() } finally { process.exit(code) }
})
const sql = input => docker(['exec', '-i', container, 'psql', '-X', '-qAt', '--set=ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'roster_check'], input)
const run = input => requireSuccess(sql(input), 'Disposable provisioning SQL')
const snapshot = () => run(`SELECT jsonb_build_array(${['organizations', 'organization_memberships', 'job_roles', 'employees'].map(t => `(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM public.${t} t)`).join(',')});`)
function denied(input, label) {
  const before = snapshot(), r = sql(input)
  assert.notEqual(r.status, 0, `${label}: refusal required`)
  assert.ok(r.stderr.includes(label), `${label}: expected guard; raw SQL output withheld`)
  assert.equal(snapshot(), before, `${label}: failed transaction must leave all four tables unchanged`)
}
function fixture() {
  const p = newPlan()
  p.ownerAttestation = attestation
  p.members = ['admin', 'closer', 'admin'].map(role => ({ userId: randomUUID(), role, confirmedSynthetic: true }))
  run(`INSERT INTO auth.users (id,email_confirmed_at) VALUES ${p.members.map(m => `(${literal(m.userId)}::uuid,now())`).join(',')};`)
  return p
}
const bootstrap = p => generateSql(p, 'bootstrap')
const membership = (p, n) => generateSql(p, 'member', n)
const revoke = (p, n) => generateSql(p, 'revoke', n)
const cleanup = (p, states) => generateSql(p, 'cleanup', undefined, states)

async function replay(pass) {
  container = requireSuccess(docker(['run', '-d', '--rm', '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=disposable-test-only', '-e', 'POSTGRES_DB=roster_check', 'postgres:17-bookworm']), 'Start isolated local PostgreSQL')
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (docker(['exec', container, 'sh', '-c', 'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d roster_check']).status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(ready, 'Local PostgreSQL readiness timeout')
  run(readFileSync('supabase/tests/bootstrap.sql', 'utf8'))
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) run(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  // Extend only the disposable mock Auth table, never a migration or managed Auth.
  run('ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz;')
  console.log(`Provisioning SQL replay ${pass}/2: PostgreSQL ${run('SHOW server_version;')}; mock Auth only.`)

  const p = fixture(), org = literal(p.organization.id), first = literal(p.members[0].userId)
  run(`UPDATE auth.users SET email_confirmed_at=NULL WHERE id=${first}::uuid;`)
  denied(bootstrap(p), 'Confirmed Auth identity missing')
  run(`UPDATE auth.users SET email_confirmed_at=now() WHERE id=${first}::uuid;`)
  const wrongUser = structuredClone(p)
  wrongUser.members[0].userId = randomUUID()
  denied(bootstrap(wrongUser), 'Confirmed Auth identity missing')
  run(bootstrap(p))
  assert.equal(run(`SELECT role || ':' || is_active FROM public.organization_memberships WHERE organization_id=${org}::uuid;`), 'admin:true')
  denied(bootstrap(p), 'Organization already present or conflicting')
  denied(membership(p, 3), 'Unexpected membership set or state')
  run(`UPDATE auth.users SET email_confirmed_at=NULL WHERE id=${literal(p.members[1].userId)};`)
  denied(membership(p, 2), 'Confirmed Auth identity missing')
  run(`UPDATE auth.users SET email_confirmed_at=now() WHERE id=${literal(p.members[1].userId)};`)
  run(membership(p, 2))
  denied(membership(p, 2), 'Unexpected membership set or state')
  run(membership(p, 3))
  const beforeVerify = snapshot()
  run(generateSql(p, 'verify'))
  assert.equal(snapshot(), beforeVerify, 'Verification writes nothing')

  // Cross-tenant same-user access must survive exact revocation and cleanup.
  const otherOrg = literal(randomUUID())
  run(`INSERT INTO public.organizations (id,name) VALUES (${otherOrg},'Fictional other DEV');
    INSERT INTO public.organization_memberships (organization_id,user_id,role) VALUES (${otherOrg},${first},'closer');`)
  run(revoke(p, 1))
  assert.equal(run(`SELECT is_active FROM public.organization_memberships WHERE organization_id=${otherOrg} AND user_id=${first};`), 't')
  denied(revoke(p, 1), 'Exact active membership and role required')
  denied(membership(p, 2), 'Unexpected membership set or state')
  denied(cleanup(p, ['active', 'active', 'active']), 'Unexpected membership set or state')
  run(`UPDATE public.organization_memberships SET role='admin' WHERE organization_id=${org} AND user_id=${literal(p.members[1].userId)};`)
  denied(revoke(p, 2), 'Exact active membership and role required')
  denied(cleanup(p, ['inactive', 'active', 'active']), 'Unexpected membership set or state')
  run(`UPDATE public.organization_memberships SET role='closer' WHERE organization_id=${org} AND user_id=${literal(p.members[1].userId)};`)

  // Extra unknown member, role or employee prevents cleanup, even when inactive.
  const stranger = literal(randomUUID()), roleId = literal(randomUUID())
  run(`INSERT INTO auth.users (id,email_confirmed_at) VALUES (${stranger},now());
    INSERT INTO public.organization_memberships (organization_id,user_id,role,is_active) VALUES (${org},${stranger},'closer',false);`)
  denied(cleanup(p, ['inactive', 'active', 'active']), 'Unexpected membership set or state')
  run(`DELETE FROM public.organization_memberships WHERE organization_id=${org} AND user_id=${stranger};
    INSERT INTO public.job_roles (id,organization_id,name,default_weight) VALUES (${roleId},${org},'Fictional role',1);`)
  denied(cleanup(p, ['inactive', 'active', 'active']), 'Unexpected roster rows')
  run(`INSERT INTO public.employees (organization_id,name,default_role_id,is_active) VALUES (${org},'Fictional employee',${roleId},false);`)
  denied(cleanup(p, ['inactive', 'active', 'active']), 'Unexpected roster rows')
  // Test fixture repair only, not generator cleanup: removes these exact test rows.
  run(`DELETE FROM public.employees WHERE organization_id=${org} AND default_role_id=${roleId};
    DELETE FROM public.job_roles WHERE id=${roleId};`)
  run(`UPDATE public.organizations SET name='Fictional renamed DEV' WHERE id=${org};`)
  denied(revoke(p, 2), 'Exact organization identity mismatch')
  denied(cleanup(p, ['inactive', 'active', 'active']), 'Exact organization identity mismatch')
  run(`UPDATE public.organizations SET name=${literal(p.organization.name)} WHERE id=${org};`)
  run(cleanup(p, ['inactive', 'active', 'active']))
  assert.equal(run(`SELECT count(*) FROM public.organizations WHERE id=${org};`), '0')
  assert.equal(run(`SELECT count(*) FROM public.organization_memberships WHERE organization_id=${otherOrg} AND user_id=${first} AND is_active;`), '1')
  assert.equal(run(`SELECT count(*) FROM auth.users WHERE id=${first};`), '1', 'Cleanup never deletes Auth users')
  denied(bootstrap(p).replaceAll(p.organization.id, otherOrg.slice(1, -1)), 'Organization already present or conflicting')

  const duplicateName = fixture()
  run(`INSERT INTO public.organizations (name) VALUES (${literal(duplicateName.organization.name.toUpperCase())});`)
  denied(bootstrap(duplicateName), 'Organization already present or conflicting')
  const partial = fixture()
  run(bootstrap(partial))
  denied(membership(partial, 3), 'Unexpected membership set or state')
  run(cleanup(partial, ['active', 'absent', 'absent']))

  // A failure after the org INSERT must roll the whole generated transaction back.
  const rollback = fixture()
  run(`CREATE FUNCTION public.test_reject_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected local membership failure'; END $$;
    CREATE TRIGGER test_reject_membership BEFORE INSERT ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.test_reject_membership();`)
  denied(bootstrap(rollback), 'Injected local membership failure')
  run('DROP TRIGGER test_reject_membership ON public.organization_memberships; DROP FUNCTION public.test_reject_membership();')
  run(bootstrap(rollback))
  run(revoke(rollback, 1))
  denied(membership(rollback, 2), 'Unexpected membership set or state')
  run(cleanup(rollback, ['inactive', 'absent', 'absent']))
  console.log(`Provisioning SQL replay ${pass}/2 passed: bootstrap/member/revoke/cleanup, conflicts, confirmed identity, cross-tenant preservation, partial state and rollback.`)
}
try {
  requireSuccess(docker(['info']), 'Local Docker daemon required')
  for (let pass = 1; pass <= 2; pass++) {
    try { await replay(pass) } finally {
      cleanupContainer()
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
