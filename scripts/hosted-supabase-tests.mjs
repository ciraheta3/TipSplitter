// Offline safety checks only; never hosted authorization evidence.
// Separate from Vitest discovery to preserve the existing frontend workflow.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'
import { newPlan, validate, fixtureSql, persistedSql, memberships } from './hosted-supabase.mjs'
import { hostedHttp } from '../supabase/integration/hosted-http.mjs'

function config() {
  const c = newPlan()
  // Fictional reference/key for offline validation only; no project queried.
  Object.assign(c, { projectName: 'tipsplitter-dev', projectRef: 'a'.repeat(20), approvedProjectRef: 'a'.repeat(20),
    apiUrl: `https://${'a'.repeat(20)}.supabase.co`, apiKey: 'sb_publishable_offline_fixture', ownerAttestedDedicatedDev: true })
  c.users.forEach(u => { u.id = randomUUID() })
  return c
}

for (const projectName of ['tipsplitter-dev', 'TipSplitter-dev', 'TIPSPLITTER-DEV', 'tipsplitter-dev-offline', 'TipSplitter-DEV-Offline-27']) {
  test(`accept explicit DEV name ${projectName} without changing the private config`, () => {
    const c = { ...config(), projectName }, before = structuredClone(c)
    assert.equal(validate(c), c)
    assert.ok(fixtureSql(c).setup.includes(c.users[0].id))
    assert.deepEqual(c, before)
    assert.ok(Object.hasOwn(c, 'apiKey'))
    assert.ok(!Object.hasOwn(c, 'publishableKey'))
  })
}

for (const projectName of ['TipSplitter', 'tipsplitter-prod', 'TipSplitter-Production', 'tipsplitter-staging',
  'tipsplitter-development', 'tipsplitter-devops', 'tipsplitter-dev-', 'other-dev', 'prod-tipsplitter-dev',
  'tipsplitterdev', 'tipsplitter-dev_test', 'tipsplitter-dev/test', 'tipsplitter-dev test']) {
  test(`reject non-DEV or malformed project name ${projectName}`, () => {
    assert.throws(() => validate({ ...config(), projectName }), /Project name must be tipsplitter-dev.*explicit -dev designation is required/)
  })
}

test('reject ambiguous/production identity, privileged keys and non-synthetic fixtures', () => {
  const c = config()
  assert.equal(validate(c), c)
  for (const change of [
    { environment: 'production' }, { ownerAttestedDedicatedDev: false }, { projectName: 'tipsplitter-production' },
    { approvedProjectRef: 'b'.repeat(20) }, { apiUrl: c.apiUrl + '/' }, { apiUrl: 'http://localhost:54321' },
    { apiUrl: 'https://example.test' }, { apiKey: 'sb_secret_offline' }, { apiKey: 'unknown' },
    { apiKey: undefined, publishableKey: c.apiKey },
    { run: "'); DROP SCHEMA public; --" }, { orgs: [c.orgs[0], c.orgs[0]] },
  ]) assert.throws(() => validate({ ...c, ...change }))
  const legacy = role => `header.${Buffer.from(JSON.stringify({ ref: c.projectRef, role })).toString('base64url')}.signature`
  assert.throws(() => validate({ ...c, apiKey: legacy('service_role') }))
  assert.throws(() => validate({ ...c, apiKey: `header.${Buffer.from(JSON.stringify({ ref: 'b'.repeat(20), role: 'anon' })).toString('base64url')}.signature` }))
  assert.equal(validate({ ...c, apiKey: legacy('anon') }).projectRef, c.projectRef)
  const other = structuredClone(c)
  other.users[0].email = 'employee@example.com'
  assert.throws(() => validate(other))
  other.users[0] = other.users[1]
  assert.throws(() => validate(other))
})

test('manual SQL has scoped ownership guards, FK-safe cleanup and no managed Auth writes/secrets', () => {
  const c = config(), sql = fixtureSql(c)
  for (const s of Object.values(sql)) {
    assert.doesNotMatch(s, /(?:INSERT INTO|UPDATE|DELETE FROM) auth\.|TRUNCATE|DROP|GRANT|CREATE POLICY/i)
    assert.ok(!s.includes(c.apiKey) && !s.includes(c.projectRef) && c.users.every(u => !s.includes(u.password)))
  }
  assert.match(sql.setup, /email_confirmed_at IS NOT NULL/)
  assert.match(sql.setup, /requires empty application tables/)
  assert.match(sql.cleanup, /Fixture ownership mismatch/)
  assert.match(sql.cleanup, /DELETE FROM public\.employees WHERE organization_id IN/)
  assert.ok(sql.cleanup.indexOf('DELETE FROM public.employees') < sql.cleanup.indexOf('DELETE FROM public.job_roles'))
  assert.ok(sql.cleanup.indexOf('DELETE FROM public.organization_memberships') < sql.cleanup.indexOf('DELETE FROM public.organizations'))
})

test('persisted comparison safely quotes database-returned text and uses fixed table names', () => {
  const state = { organizations: [{ id: randomUUID(), name: "Fictional ' quote $$; END $$; --" }], organization_memberships: [], job_roles: [], employees: [] }
  const sql = persistedSql(state)
  assert.match(sql, /standard_conforming_strings = on/)
  assert.match(sql, /Fictional '' quote \$\$/)
  const delimiter = /DO (\$hosted_[a-f0-9]+\$)/.exec(sql)?.[1]
  assert.ok(delimiter)
  assert.equal(sql.split(delimiter).length, 3)
  assert.match(sql, /ROLLBACK;/)
})

test('CLI refuses noninteractive execution, insecure config and symlinks before connecting', () => {
  mkdirSync('work', { recursive: true })
  const dir = mkdtempSync('work/hosted-offline-test-')
  chmodSync(dir, 0o700)
  try {
    const c = { ...config(), projectName: 'TipSplitter-dev' }, path = resolve(dir, 'config.json')
    writeFileSync(path, JSON.stringify(c), { mode: 0o600 })
    const blocker = resolve(dir, 'no-network.mjs')
    writeFileSync(blocker, "globalThis.fetch = () => { process.stderr.write('UNEXPECTED NETWORK ATTEMPT'); throw new Error('offline blocker') }\n")
    const invoke = (action, target = path) => {
      const result = spawnSync(process.execPath, ['--import', blocker, 'scripts/hosted-supabase.mjs', action, target], { encoding: 'utf8', env: { ...process.env, CI: 'true' } })
      assert.ifError(result.error)
      assert.doesNotMatch(result.stderr, /UNEXPECTED NETWORK ATTEMPT/)
      return result
    }
    assert.equal(invoke('prepare').status, 0)
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), c)
    const result = invoke('verify')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Hosted verification requires an interactive owner terminal/)
    assert.doesNotMatch(result.stdout, /Hosted synthetic sign-in/)
    assert.ok(!result.stderr.includes(c.apiKey) && !result.stderr.includes(c.projectRef) && c.users.every(u => !result.stderr.includes(u.password)))
    symlinkSync(path, resolve(dir, 'symlink.json'))
    assert.equal(invoke('verify', resolve(dir, 'symlink.json')).status, 1)
    chmodSync(path, 0o644)
    assert.equal(invoke('verify').status, 1)
    assert.equal(invoke('reset').status, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('HTTP driver stops on mismatched session identity before roster mutation (mock transport)', async t => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  const c = config(), requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ access_token: 'withheld', refresh_token: 'withheld', user: { id: randomUUID() } }), { status: 200 })
  })
  await assert.rejects(() => hostedHttp(c, memberships, () => { throw new Error('Unexpected pause') }))
  assert.equal(requests.length, 1)
  assert.ok(requests.every(r => !r.url.includes('/rest/')))
  assert.equal(requests[0].options.redirect, 'error')
})

test('HTTP driver refuses incomplete observer rows before roster writes (mock transport)', async t => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  const c = config(), requests = []
  let account = -1
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    if (url.includes('/token?')) {
      account++
      const claims = { sub: c.users[account].id, role: 'authenticated', iss: c.apiUrl + '/auth/v1' }
      return new Response(JSON.stringify({ access_token: `offline.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.mock`, refresh_token: 'mock', user: { id: claims.sub } }))
    }
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: c.users[account].id, email: c.users[account].email }))
    return new Response('[]', { headers: { 'content-range': '*/1001' } })
  })
  await assert.rejects(() => hostedHttp(c, memberships, () => { throw new Error('Unexpected pause') }))
  assert.ok(requests.filter(r => r.url.includes('/rest/')).every(r => r.options.method === 'GET'))
})

test('observer comparison detects committed changes even when denial status looks correct (mock transport)', async t => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  const c = config()
  const state = {
    organizations: c.orgs.map(id => ({ id })),
    job_roles: c.roles.map((id, o) => ({ id, organization_id: c.orgs[o] })),
    employees: c.employees.map((id, o) => ({ id, organization_id: c.orgs[o], default_role_id: c.roles[o] })),
    organization_memberships: memberships.map(([o, i, role]) => ({ organization_id: c.orgs[o], user_id: c.users[i].id, role, is_active: true })),
  }
  let account = -1, denials = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/token?')) {
      account++
      const claims = { sub: c.users[account].id, role: 'authenticated', iss: c.apiUrl + '/auth/v1' }
      return new Response(JSON.stringify({ access_token: `offline.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.mock`, refresh_token: 'mock', user: { id: claims.sub } }))
    }
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: c.users[account].id, email: c.users[account].email }))
    if (!options.headers.Authorization) {
      denials++
      state.job_roles.push({ id: randomUUID(), organization_id: c.orgs[0] })
      return new Response(JSON.stringify({ code: '42501' }), { status: 401 })
    }
    const claims = JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1], 'base64url').toString())
    const org = claims.sub === c.users[0].id ? c.orgs[0] : c.orgs[1]
    const table = new URL(url).pathname.split('/').at(-1)
    const rows = state[table].filter(row => (table === 'organizations' ? row.id : row.organization_id) === org)
    return new Response(JSON.stringify(rows), { headers: { 'content-range': `*/${rows.length}` } })
  })
  await assert.rejects(() => hostedHttp(c, memberships, () => { throw new Error('Unexpected pause') }))
  assert.equal(denials, 1)
  assert.equal(state.job_roles.length, 3)
})
