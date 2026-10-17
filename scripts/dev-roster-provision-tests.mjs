import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, lstatSync, chmodSync, rmSync, symlinkSync, linkSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { newPlan, identity, validate, attestation, literal, generateSql, createPlan, sealPlan, readSealed, writeSql } from './dev-roster-provision.mjs'

function approvedPlan() {
  const p = newPlan()
  p.ownerAttestation = attestation
  p.members = ['admin', 'closer', 'admin'].map(role => ({ userId: randomUUID(), role, confirmedSynthetic: true }))
  return p
}
const change = (p, fn) => { const q = structuredClone(p); fn(q); return q }

test('new plan generates fictional fixture identities but never Auth IDs or credentials', () => {
  const p = newPlan(), other = newPlan()
  assert.notEqual(p.run, other.run)
  assert.notEqual(p.organization.id, other.organization.id)
  assert.deepEqual(p.members, [{ userId: '', role: 'admin', confirmedSynthetic: false }])
  assert.throws(() => validate(p, identity(p)))
  assert.doesNotMatch(JSON.stringify(p), /password|token|apiKey|projectRef|apiUrl|email/i)
})

test('strict plan validates original identity, DEV attestation, approved UUIDs, roles and shape', () => {
  const p = approvedPlan(), original = identity(p)
  assert.equal(validate(p, original), p)
  for (const edit of [
    q => { q.environment = 'production' }, q => { q.version = 2 }, q => { q.run = randomUUID() },
    q => { q.organization.id = randomUUID() }, q => { q.organization.name += ' changed' },
    q => { q.organization.name = "'); END $dev_roster$; --" }, q => { q.ownerAttestation = true },
    q => { q.password = 'forbidden' }, q => { q.organization.projectRef = 'forbidden' },
    q => { q.members = [] }, q => { q.members = Array(17).fill(q.members[0]) },
    q => { q.members[0].role = 'closer' }, q => { q.members[1].role = 'owner' },
    q => { q.members[1].role = "admin'); --" }, q => { q.members[1].confirmedSynthetic = false },
    q => { q.members[1].userId = '' }, q => { q.members[1].userId = "'); --" },
    q => { q.members[1].userId = '00000000-0000-0000-0000-000000000000' },
    q => { q.members[1].userId = q.members[0].userId }, q => { q.members[1].userId = q.organization.id },
    q => { q.members[1].email = 'invented@example.test' }, q => { q.members[1] = null },
  ]) assert.throws(() => validate(change(p, edit), original))
})

test('quote defense doubles quotes; arbitrary SQL text/dollar delimiters are refused', () => {
  assert.equal(literal("Fictional ' \\ $$ $dev_roster$"), "'Fictional '' \\ $$ $dev_roster$'")
  assert.throws(() => generateSql(change(approvedPlan(), q => { q.organization.name += "' $$" }), 'bootstrap'))
})

test('bootstrap guards precede inserts; no upsert/reactivation or roster seed', () => {
  const p = approvedPlan(), sql = generateSql(p, 'bootstrap')
  assert.match(sql, /email_confirmed_at IS NOT NULL/)
  assert.ok(sql.indexOf('Confirmed Auth identity missing') < sql.indexOf('INSERT INTO'))
  for (const label of ['Organization already present or conflicting', 'Unexpected memberships', 'Unexpected roster rows', 'affected <> 1']) assert.ok(sql.includes(label))
  assert.match(sql, /'admin',true/)
  assert.ok(sql.includes(p.organization.id) && sql.includes(p.members[0].userId))
  assert.ok(!sql.includes(p.members[1].userId))
  assert.doesNotMatch(sql, /ON CONFLICT|UPDATE|INSERT INTO public\.(employees|job_roles)/)
})

test('additional member requires exact active predecessors, confirmed identity and approved role', () => {
  const p = approvedPlan(), sql = generateSql(p, 'member', 2)
  for (const label of ['EXCEPT SELECT * FROM expected', 'Unexpected membership set or state', 'Exact organization identity mismatch', 'Confirmed Auth identity missing']) assert.ok(sql.includes(label))
  assert.ok(sql.includes(p.members[0].userId) && sql.includes(p.members[1].userId))
  assert.ok(!sql.includes(p.members[2].userId))
  assert.match(sql, /'closer',true/)
  for (const slot of [undefined, 0, 1, 4, 1.5, '2', NaN]) assert.throws(() => generateSql(p, 'member', slot))
})

test('revocation targets exact org/user/role/active row, never reactivates or invalidates JWT', () => {
  const p = approvedPlan(), sql = generateSql(p, 'revoke', 2)
  assert.match(sql, /SET is_active=false WHERE organization_id='[^']+'::uuid AND user_id='[^']+'::uuid AND role='closer' AND is_active=true/)
  assert.match(sql, /does not sign out or invalidate a JWT/)
  assert.match(sql, /Exact active membership and role required/)
  assert.ok(!sql.includes(p.members[0].userId))
  assert.doesNotMatch(sql, /INSERT|DELETE|SET role|SET is_active=true/)
})

test('cleanup requires explicit states and refuses unknown rows before DELETE', () => {
  const p = approvedPlan(), sql = generateSql(p, 'cleanup', undefined, ['active', 'inactive', 'absent'])
  assert.ok(sql.indexOf('Unexpected roster rows') < sql.indexOf('DELETE FROM'))
  assert.ok(sql.indexOf('Unexpected membership set or state') < sql.indexOf('DELETE FROM'))
  assert.match(sql, /role='closer' AND is_active=false/)
  assert.ok(!sql.includes(p.members[2].userId))
  assert.doesNotMatch(sql, /DELETE FROM public\.(job_roles|employees)/)
  for (const states of [undefined, [], ['active'], ['absent', 'absent', 'absent'], ['active', 'unknown', 'active']]) assert.throws(() => generateSql(p, 'cleanup', undefined, states))
})

test('mutations use serialized bounded transactions and no Auth/security/schema writes', () => {
  const p = approvedPlan()
  for (const sql of [generateSql(p, 'bootstrap'), generateSql(p, 'member', 2), generateSql(p, 'revoke', 1), generateSql(p, 'cleanup', undefined, ['active', 'absent', 'absent'])]) {
    for (const label of ['standard_conforming_strings = on', 'search_path = pg_catalog', "lock_timeout = '5s'", 'LOCK TABLE auth.users IN SHARE MODE', 'SHARE ROW EXCLUSIVE MODE']) assert.ok(sql.includes(label))
    assert.match(sql, /BEGIN;[\s\S]+COMMIT;\n$/)
    assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) auth\.|TRUNCATE|CASCADE|ALTER|GRANT|DISABLE|CREATE FUNCTION|\bEXECUTE\b/i)
  }
})

test('read-only verification includes all organizations and active/inactive memberships', () => {
  const p = approvedPlan(), sql = generateSql(p, 'verify')
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/)
  assert.match(sql, /OR user_id IN/)
  assert.match(sql, /ROLLBACK;/)
  assert.ok(p.members.every(m => sql.includes(m.userId)))
  assert.doesNotMatch(sql, /INSERT|UPDATE |DELETE|LOCK TABLE|is_active=true/)
  assert.throws(() => generateSql(p, 'verify', 1))
  assert.throws(() => generateSql(p, 'execute'))
})

function withPrivatePlan(fn) {
  const dir = createPlan()
  try {
    const p = JSON.parse(readFileSync(resolve(dir, 'plan.json')))
    p.ownerAttestation = attestation
    p.members[0] = { userId: randomUUID(), role: 'admin', confirmedSynthetic: true }
    writeFileSync(resolve(dir, 'plan.json'), JSON.stringify(p))
    fn(dir, p)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
test('private ignored files, immutable seal/output and safe CLI logs', () => withPrivatePlan((dir, p) => {
  assert.equal(lstatSync(dir).mode & 0o777, 0o700)
  assert.equal(lstatSync(resolve(dir, 'plan.json')).mode & 0o777, 0o600)
  assert.equal(lstatSync(resolve(dir, 'identity.json')).mode & 0o777, 0o400)
  assert.equal(spawnSync('git', ['check-ignore', dir]).status, 0)
  sealPlan(dir)
  assert.deepEqual(readSealed(dir), p)
  assert.throws(() => sealPlan(dir))
  writeSql(dir, 'bootstrap')
  assert.equal(lstatSync(resolve(dir, 'bootstrap/review.sql')).mode & 0o777, 0o400)
  assert.throws(() => writeSql(dir, 'bootstrap'))
  const result = spawnSync(process.execPath, ['scripts/dev-roster-provision.mjs', 'revoke', dir, '1'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.ok(!result.stdout.includes(p.members[0].userId) && !result.stdout.includes(p.organization.id))
}))

test('draft/sealed tampering and missing fingerprints fail before output', () => withPrivatePlan((dir, p) => {
  sealPlan(dir)
  writeFileSync(resolve(dir, 'plan.json'), JSON.stringify(change(p, q => { q.members[0].userId = randomUUID() })))
  assert.throws(() => writeSql(dir, 'bootstrap'))
  assert.equal(existsSync(resolve(dir, 'bootstrap')), false)
  writeFileSync(resolve(dir, 'plan.json'), JSON.stringify(p))
  chmodSync(resolve(dir, 'sealed/plan.json'), 0o600)
  writeFileSync(resolve(dir, 'sealed/plan.json'), JSON.stringify(change(p, q => { q.members[0].role = 'closer' })))
  assert.throws(() => readSealed(dir))
  rmSync(resolve(dir, 'sealed/sha256.json'))
  assert.throws(() => readSealed(dir))
}))

test('insecure files/directories, symlinks, hardlinks, oversized inputs and alternate roots refused', () => withPrivatePlan((dir, p) => {
  const file = resolve(dir, 'plan.json'), other = resolve(dir, 'other.json')
  chmodSync(file, 0o644)
  assert.throws(() => sealPlan(dir))
  chmodSync(file, 0o600)
  chmodSync(dir, 0o755)
  assert.throws(() => sealPlan(dir))
  chmodSync(dir, 0o700)
  writeFileSync(other, JSON.stringify(p), { mode: 0o600 })
  rmSync(file)
  symlinkSync(other, file)
  assert.throws(() => sealPlan(dir))
  rmSync(file)
  linkSync(other, file)
  assert.throws(() => sealPlan(dir))
  rmSync(file)
  writeFileSync(file, ' '.repeat(33_000), { mode: 0o600 })
  assert.throws(() => sealPlan(dir))
  assert.throws(() => sealPlan('/tmp'))
}))

test('cleanup requires separate private approval input; output traversal/symlinks refused', () => withPrivatePlan((dir, p) => {
  sealPlan(dir)
  assert.throws(() => writeSql(dir, 'cleanup'))
  const review = resolve(dir, 'cleanup-review.json')
  writeFileSync(review, JSON.stringify({ ownerApprovedExactCleanup: false, states: ['active'] }), { mode: 0o600 })
  assert.throws(() => writeSql(dir, 'cleanup'))
  writeFileSync(review, JSON.stringify({ ownerApprovedExactCleanup: true, states: ['active'] }))
  writeSql(dir, 'cleanup')
  assert.ok(readFileSync(resolve(dir, 'cleanup/review.sql'), 'utf8').includes(p.members[0].userId))
  assert.throws(() => writeSql(dir, '../escape'))
  symlinkSync(resolve(dir, 'cleanup'), resolve(dir, 'bootstrap'))
  assert.throws(() => writeSql(dir, 'bootstrap'))
}))

test('CLI has no network/executor/dependency imports; errors never echo inputs', () => withPrivatePlan((dir, p) => {
  const source = readFileSync('scripts/dev-roster-provision.mjs', 'utf8')
  assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map(m => m[1]), ['node:crypto', 'node:fs', 'node:path', 'node:url'])
  assert.doesNotMatch(source, /\bfetch\s*\(|\bimport\s*\(|child_process|node:(http|https|net|tls)|process\.env|supabase-js/)
  for (const args of [['execute', dir], ['seal', dir, '1'], ['plan', dir], ['bootstrap', dir, '2'], ['member', dir, p.members[0].userId], ['seal', dir, '1', 'extra']]) {
    const result = spawnSync(process.execPath, ['scripts/dev-roster-provision.mjs', ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.ok(!result.stderr.includes(p.members[0].userId) && !result.stderr.includes(dir))
    assert.equal(result.stdout, '')
  }
}))
