import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { credentials, sql } from '../../scripts/supabase-local.mjs'

const tables = ['organizations', 'organization_memberships', 'job_roles', 'employees']
const roster = ['job_roles', 'employees']
const categories = ['admin-A', 'closer-A', 'admin-B', 'closer-B',
  'dual-admin-A-closer-B', 'dual-closer-A-admin-B', 'nonmember']
const uuid = value => {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'fixture UUID')
  return `'${value}'`
}
const same = (actual, expected, label) => assert.deepEqual(actual, expected, label)
const ids = rows => rows.map(r => r.id).sort()
const membershipKeys = rows => rows.map(r => `${r.organization_id}:${r.user_id}:${r.role}:${r.is_active}`).sort()

export async function integration() {
  const config = credentials() // Runtime local keys only, never environment/hosted credentials.
  same(sql('SELECT (SELECT count(*) FROM auth.users) + (SELECT count(*) FROM public.organizations);'), '0', 'fresh fixture database required')
  const orgs = [randomUUID(), randomUUID()]
  const roles = [randomUUID(), randomUUID()]
  const employees = [randomUUID(), randomUUID()]
  let requests = 0
  async function request(path, { token, method = 'GET', body, headers = {}, key = config.ANON_KEY } = {}) {
    requests++
    const response = await fetch(`${config.API_URL}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { data = null }
    return { status: response.status, data }
  }
  function status(result, expected, label) {
    const code = typeof result.data?.code === 'string' && /^(?:PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(result.data.code) ? result.data.code : 'withheld'
    same(result.status, expected, `${label} HTTP status (${result.context ?? 'no fixture context'}; API error code: ${code}; response withheld)`)
  }
  async function api(user, table, { query = '', headers = {}, ...options } = {}) {
    // Ordinary fixture requests must never silently replace the user's JWT/key.
    assert.ok(!('token' in options) && !('key' in options)
      && !Object.keys(headers).some(k => ['authorization', 'apikey'].includes(k.toLowerCase())), 'fixture identity headers cannot be overridden')
    let context = `${user?.category ?? 'anonymous'}; key=anon`
    if (roster.includes(table) && options.method === 'POST') {
      context = await insertContext(user, options.body.organization_id)
    }
    const result = await request(`/rest/v1/${table}${query ? `?${query}` : ''}`, {
      ...options, token: user?.token, key: config.ANON_KEY,
      headers: { Prefer: 'return=representation', ...headers },
    })
    return { ...result, context }
  }
  async function read(user, table, query = '') {
    const result = await api(user, table, { query })
    status(result, 200, `read ${table}`)
    assert.ok(Array.isArray(result.data), `row array for ${table}`)
    return result.data
  }
  async function denied(user, table, options, code = '42501', http = user ? 403 : 401) {
    const before = snapshot()
    const result = await api(user, table, options)
    // Read before asserting status, so an unexpected 201 cannot skip this check.
    const changed = snapshot() !== before
    result.context += `; persisted=${changed ? 'changed' : 'unchanged'}`
    status(result, http, `deny ${options.method ?? 'GET'} ${table}`)
    same(result.data?.code, code, `deny ${table} database code`)
    assert.ok(!changed, `deny ${table}: ${result.context}`)
  }
  const snapshot = () => sql(`SELECT jsonb_build_array(${tables.map(t => `(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.${t} t)`).join(',')});`)
  async function unchanged(action) {
    // Trusted local read only checks actual persisted rows after forbidden calls.
    const before = snapshot()
    try { await action() } catch (error) {
      error.message += `; forbidden group persisted=${snapshot() === before ? 'unchanged' : 'changed'}`
      throw error
    }
    assert.ok(snapshot() === before, 'forbidden requests leave all persisted rows unchanged')
  }

  // Actual signup AND password sign-in, not forged JWTs or SQL-inserted users.
  const users = []
  for (let i = 0; i < 7; i++) {
    const email = `synthetic-${randomUUID()}@example.test`
    const password = randomBytes(32).toString('base64url')
    const signup = await request('/auth/v1/signup', { method: 'POST', body: {
      email, password, data: { role: 'admin', organization_id: orgs[1], membership_role: 'admin' },
    } })
    status(signup, 200, 'Auth signup')
    const signedIn = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })
    status(signedIn, 200, 'Auth password sign-in')
    assert.ok(signedIn.data.access_token && signedIn.data.refresh_token, 'real Auth session issued')
    same(signedIn.data.user.id, signup.data.user.id, 'sign-in resolves same real identity')
    const user = { id: signedIn.data.user.id, token: signedIn.data.access_token, category: categories[i] }
    uuid(user.id)
    const session = await request('/auth/v1/user', { token: user.token })
    status(session, 200, 'Auth verifies session')
    same(session.data.id, user.id, 'session subject')
    users.push(user)
  }
  // admin A, closer A, admin B, closer B, mixed dual admin-A/closer-B,
  // mixed dual closer-A/admin-B, authenticated nonmember with hostile metadata.
  const memberships = [[0, 0, 'admin'], [0, 1, 'closer'], [1, 2, 'admin'], [1, 3, 'closer'],
    [0, 4, 'admin'], [1, 4, 'closer'], [0, 5, 'closer'], [1, 5, 'admin']]
  const revoked = new Set()
  sql(`BEGIN;
    INSERT INTO public.organizations (id,name) VALUES (${uuid(orgs[0])},'Fictional Juniper Cafe'),(${uuid(orgs[1])},'Fictional Moonbeam Diner');
    INSERT INTO public.job_roles (id,organization_id,name,default_weight) VALUES
      (${uuid(roles[0])},${uuid(orgs[0])},'Synthetic server',1),(${uuid(roles[1])},${uuid(orgs[1])},'Synthetic server',1);
    INSERT INTO public.employees (id,organization_id,name,default_role_id) VALUES
      (${uuid(employees[0])},${uuid(orgs[0])},'Synthetic employee A',${uuid(roles[0])}),
      (${uuid(employees[1])},${uuid(orgs[1])},'Synthetic employee B',${uuid(roles[1])});
    INSERT INTO public.organization_memberships (organization_id,user_id,role) VALUES
      ${memberships.map(([o, u, r]) => `(${uuid(orgs[o])},${uuid(users[u].id)},'${r}')`).join(',')};
    COMMIT;`)
  console.log('Synthetic signup/sign-in/session verification and restricted local fixture setup passed.')

  async function insertContext(user, organization) {
    const target = orgs.indexOf(organization)
    assert.ok(target >= 0, 'INSERT targets a known synthetic restaurant')
    if (!user) return `anonymous; target=${'AB'[target]}; jwt=absent; key=anon`
    const n = users.indexOf(user)
    assert.ok(n >= 0, 'INSERT uses a known fixture identity')
    const label = `${user.category}; target=${'AB'[target]}`
    // Decode only for comparison; Auth and PostgREST still verify the signature.
    let claims
    try { claims = JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url').toString()) }
    catch { throw new Error(`${label}: malformed session claims; token withheld`) }
    assert.ok(claims.sub === user.id && claims.role === 'authenticated', `${label}: JWT subject/role match fixture`)
    const session = await request('/auth/v1/user', { token: user.token })
    status(session, 200, `${label}: Auth independently verifies INSERT session`)
    assert.ok(session.data.id === claims.sub, `${label}: verified Auth subject matches JWT`)
    const expected = memberships.filter(([, i]) => i === n).map(([o, , role]) => ({
      organization_id: orgs[o], role, is_active: !revoked.has(`${o}:${n}`),
    })).sort((a, b) => a.organization_id.localeCompare(b.organization_id))
    const actual = JSON.parse(sql(`SELECT jsonb_build_object('identity_exists', EXISTS(SELECT FROM auth.users WHERE id=${uuid(user.id)}),
      'memberships', (SELECT coalesce(jsonb_agg(jsonb_build_object('organization_id', organization_id, 'role', role, 'is_active', is_active) ORDER BY organization_id),'[]')
        FROM public.organization_memberships WHERE user_id=${uuid(user.id)}));`))
    assert.ok(actual.identity_exists && JSON.stringify(actual.memberships.map(m => [m.organization_id, m.role, m.is_active]))
      === JSON.stringify(expected.map(m => [m.organization_id, m.role, m.is_active])), `${label}: independent persisted identity/membership fixture check`)
    const active = expected.filter(m => m.is_active)
    const visible = await read(user, 'organization_memberships', `user_id=eq.${user.id}`)
    assert.ok(JSON.stringify(membershipKeys(visible)) === JSON.stringify(active.map(m => `${m.organization_id}:${user.id}:${m.role}:true`).sort()),
      `${label}: PostgREST self-memberships match verified identity and database`)
    // Supplement HTTP checks with a rolled-back helper audit for this verified
    // subject. This local SQL context is not a substitute for real HTTP auth.
    const helper = JSON.parse(sql(`BEGIN; SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claims = '{"sub":"${user.id}","role":"authenticated"}';
      SELECT jsonb_build_object('identity_matches', auth.uid()=${uuid(user.id)}, 'api_role', current_user,
        'roles', jsonb_build_array(${orgs.map(o => `tipsplitter_private.membership_role(${uuid(o)})`).join(',')})); ROLLBACK;`))
    const expectedRoles = orgs.map(o => active.find(m => m.organization_id === o)?.role ?? null)
    assert.ok(helper.identity_matches && helper.api_role === 'authenticated'
      && JSON.stringify(helper.roles) === JSON.stringify(expectedRoles), `${label}: private helper matches effective memberships`)
    return `${label}; membership=${expectedRoles[target] ?? 'none'}; jwt=authenticated; key=anon`
  }

  function persistedInsert(table, row, body, label) {
    uuid(row.id)
    const actual = JSON.parse(sql(`SELECT coalesce(jsonb_agg(t),'[]') FROM public.${table} t WHERE id=${uuid(row.id)};`))
    assert.ok(actual.length === 1 && Object.entries(body).every(([key, value]) => actual[0][key] === value),
      `${label}: trusted read confirms one committed row with the requested tenant and fields`)
  }

  async function visibility(u, allowedOrgs, visibleMemberships) {
    same(ids(await read(u, 'organizations')), allowedOrgs.slice().sort(), 'exact organization visibility')
    for (const t of roster) {
      // Full row sets, without trusting a client tenant filter.
      const all = JSON.parse(sql(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.${t} t;`))
      same(ids(await read(u, t)), all.filter(r => allowedOrgs.includes(r.organization_id)).map(r => r.id).sort(), `exact ${t} visibility`)
    }
    same(membershipKeys(await read(u, 'organization_memberships')), visibleMemberships.map(([o, n, r, active = true]) => `${orgs[o]}:${users[n].id}:${r}:${active}`).sort(), 'exact membership list visibility')
  }
  async function noAccess(u) {
    await visibility(u, [], [])
    await unchanged(async () => {
      for (const t of roster) {
        for (const organization of orgs) {
          const result = await api(u, t, { method: 'PATCH', query: `organization_id=eq.${organization}`, body: { name: 'Forbidden' } })
          status(result, 200, 'RLS hidden UPDATE')
          same(result.data, [], 'RLS hidden UPDATE touches zero rows')
          await denied(u, t, { method: 'POST', body: t === 'job_roles'
            ? { organization_id: organization, name: 'Forbidden', default_weight: 1 }
            : { organization_id: organization, name: 'Forbidden', default_role_id: roles[orgs.indexOf(organization)] } })
        }
      }
    })
  }
  await unchanged(async () => {
    for (const t of tables) {
      await denied(null, t, {})
      await denied(null, t, { method: 'DELETE', query: `${t === 'organizations' ? 'id' : 'organization_id'}=eq.${orgs[0]}` })
    }
    for (const t of roster) {
      await denied(null, t, { method: 'PATCH', query: `organization_id=eq.${orgs[0]}`, body: { name: 'Forbidden' } })
      await denied(null, t, { method: 'POST', body: t === 'job_roles'
        ? { organization_id: orgs[0], name: 'Forbidden', default_weight: 1 }
        : { organization_id: orgs[0], name: 'Forbidden', default_role_id: roles[0] } })
    }
  })
  await noAccess(users[6])

  for (let n = 0; n < 6; n++) {
    const u = users[n]
    const own = memberships.filter(([, i]) => i === n)
    const allowedOrgs = own.map(([o]) => orgs[o])
    const visible = memberships.filter(([o, i]) => i === n || own.some(([a, , r]) => a === o && r === 'admin'))
    await visibility(u, allowedOrgs, visible)
    for (const [o] of own) {
      const roleBody = { organization_id: orgs[o], name: `Synthetic ${n}-${o}`, default_weight: 0.25 }
      const insertedRole = await api(u, 'job_roles', { method: 'POST', body: roleBody })
      status(insertedRole, 201, 'own role INSERT')
      const r = insertedRole.data[0]
      assert.ok(r.id && r.created_at && r.updated_at, 'database-generated role metadata')
      persistedInsert('job_roles', r, roleBody, insertedRole.context)
      const employeeBody = { organization_id: orgs[o], name: `Synthetic ${n}-${o}`, default_role_id: r.id, default_weight_override: 0 }
      const insertedEmployee = await api(u, 'employees', { method: 'POST', body: employeeBody })
      status(insertedEmployee, 201, 'own employee INSERT')
      const e = insertedEmployee.data[0]
      persistedInsert('employees', e, employeeBody, insertedEmployee.context)
      for (const [t, row, edits] of [['job_roles', r, { default_weight: 1.25 }], ['employees', e, { default_role_id: roles[o], default_weight_override: null }]]) {
        const edited = await api(u, t, { method: 'PATCH', query: `id=eq.${row.id}`, body: { name: `Synthetic edited ${n}-${o}`, is_active: false, ...edits } })
        status(edited, 200, 'own roster UPDATE')
        same(edited.data.length, 1, 'exactly one edited row')
        same(edited.data[0].created_at, row.created_at, 'creation timestamp preserved')
        assert.ok(Date.parse(edited.data[0].updated_at) >= Date.parse(row.updated_at), 'database update timestamp')
        for (const [key, value] of Object.entries(edits)) same(edited.data[0][key], value, 'persisted edit')
        same(edited.data[0].is_active, false, 'deactivated')
        same(edited.data[0].name, `Synthetic edited ${n}-${o}`, 'persisted name')
        const active = await api(u, t, { method: 'PATCH', query: `id=eq.${row.id}`, body: { is_active: true } })
        status(active, 200, 'reactivate roster')
        same(active.data[0].is_active, true, 'reactivated')
        same(await read(u, t, `id=eq.${row.id}`), active.data, 'subsequent GET confirms persisted record')
      }
    }
    await unchanged(async () => {
      // Supabase's safeupdate guard rejects unfiltered DELETE before ACL checks.
      // Target each member's own seeded restaurant so this tests forbidden deletion.
      for (const [o] of own) {
        for (const t of tables) await denied(u, t, { method: 'DELETE', query: `${t === 'organizations' ? 'id' : 'organization_id'}=eq.${orgs[o]}` })
      }
      await denied(u, 'organizations', { method: 'POST', body: { name: 'Forbidden' } })
      await denied(u, 'organizations', { method: 'PATCH', query: `id=eq.${orgs[own[0][0]]}`, body: { name: 'Forbidden' } })
      await denied(u, 'organization_memberships', { method: 'POST', body: { organization_id: orgs[1], user_id: u.id, role: 'admin' } })
      for (const body of [{ role: 'admin' }, { is_active: false }, { is_active: true }, { user_id: users[6].id }, { organization_id: orgs[1] }, { created_at: '2100-01-01T00:00:00Z' }, { updated_at: '2100-01-01T00:00:00Z' }]) {
        await denied(u, 'organization_memberships', { method: 'PATCH', query: `user_id=eq.${u.id}`, body })
      }
      for (const [o] of own) {
        for (const t of roster) {
          // Tenant assignment is required on INSERT and allowed for either active
          // membership. Moving an existing row is forbidden even for dual members.
          await denied(u, t, { method: 'PATCH', query: `organization_id=eq.${orgs[o]}`, body: { organization_id: orgs[1 - o] } })
          for (const body of [{ id: randomUUID() }, { created_at: '2100-01-01T00:00:00Z' }, { updated_at: '2100-01-01T00:00:00Z' }]) {
            await denied(u, t, { method: 'PATCH', query: `organization_id=eq.${orgs[o]}`, body })
            await denied(u, t, { method: 'POST', body: { organization_id: orgs[o], name: 'Forbidden', ...(t === 'job_roles' ? { default_weight: 1 } : { default_role_id: roles[o] }), ...body } })
          }
        }
        await denied(u, 'employees', { method: 'POST', body: { organization_id: orgs[o], name: 'Forbidden FK', default_role_id: roles[1 - o] } }, '23503', 409)
        await denied(u, 'employees', { method: 'PATCH', query: `id=eq.${employees[o]}`, body: { default_role_id: roles[1 - o] } }, '23503', 409)
      }
      for (let o = 0; o < 2; o++) {
        if (allowedOrgs.includes(orgs[o])) continue
        for (const t of tables) same(await read(u, t, `${t === 'organizations' ? 'id' : 'organization_id'}=eq.${orgs[o]}`), [], 'cross restaurant read')
        for (const t of roster) {
          const edited = await api(u, t, { method: 'PATCH', query: `organization_id=eq.${orgs[o]}`, body: { name: 'Stolen' } })
          status(edited, 200, 'cross restaurant UPDATE')
          same(edited.data, [], 'zero rows stolen')
          await denied(u, t, { method: 'POST', body: { organization_id: orgs[o], name: 'Stolen', ...(t === 'job_roles' ? { default_weight: 1 } : { default_role_id: roles[o] }) } })
        }
      }
    })
  }
  console.log('Admin/closer writes, exact row visibility, dual memberships, immutable columns, FK and escalation denials passed.')

  // Real sessions remain valid; database membership is revoked without re-sign-in.
  for (const n of [0, 1, 4, 5]) {
    const u = users[n]
    sql(`UPDATE public.organization_memberships SET is_active=false WHERE organization_id=${uuid(orgs[0])} AND user_id=${uuid(u.id)};`)
    revoked.add(`0:${n}`)
    status(await request('/auth/v1/user', { token: u.token }), 200, 'same Auth session remains valid after membership revocation')
    if (n < 2) await noAccess(u)
    else {
      const visible = memberships.filter(([o, i]) => o === 1 && (i === n || n === 5))
      await visibility(u, [orgs[1]], visible)
      same(await read(u, 'job_roles', `organization_id=eq.${orgs[0]}`), [], 'dual member loses A')
      await unchanged(async () => {
        for (const t of roster) {
          const result = await api(u, t, { method: 'PATCH', query: `organization_id=eq.${orgs[0]}`, body: { name: 'Revoked' } })
          status(result, 200, 'revoked dual UPDATE')
          same(result.data, [], 'revoked dual UPDATE zero rows')
          await denied(u, t, { method: 'POST', body: { organization_id: orgs[0], name: 'Revoked', ...(t === 'job_roles' ? { default_weight: 1 } : { default_role_id: roles[0] }) } })
        }
      })
      const retained = await api(u, 'employees', { method: 'PATCH', query: `id=eq.${employees[1]}`, body: { name: `Synthetic retained ${n}` } })
      status(retained, 200, 'retained B write')
      same(retained.data.length, 1, 'retained B changed exactly one row')
    }
    await unchanged(() => denied(u, 'organization_memberships', { method: 'PATCH', query: `user_id=eq.${u.id}`, body: { is_active: true, role: 'admin' } }))
  }
  // A remaining B admin sees inactive memberships; revoked B closer sees none.
  sql(`UPDATE public.organization_memberships SET is_active=false WHERE organization_id=${uuid(orgs[1])} AND user_id=${uuid(users[3].id)};`)
  revoked.add('1:3')
  status(await request('/auth/v1/user', { token: users[3].token }), 200, 'revoked B session remains valid')
  await noAccess(users[3])
  await visibility(users[2], [orgs[1]], memberships.filter(([o]) => o === 1).map(([o, n, r]) => [o, n, r, n !== 3]))
  await visibility(users[4], [orgs[1]], [[1, 4, 'closer']])
  await unchanged(() => denied(users[3], 'organization_memberships', { method: 'PATCH', query: `user_id=eq.${users[3].id}`, body: { is_active: true } }))
  console.log('Revocation with unchanged real sessions and retained second-restaurant permissions passed.')

  const accountBefore = await request('/auth/v1/user', { token: users[6].token })
  status(accountBefore, 200, 'account state before prohibited administration')
  await unchanged(async () => {
    const u = users[6]
    // Signed user-controlled metadata and impersonation headers are not membership.
    same(await read(u, 'employees'), [], 'hostile user metadata ignored')
    const spoofed = await api(u, 'employees', { headers: { 'X-Organization-Id': orgs[1], 'X-User-Id': users[2].id, 'X-Role': 'admin' } })
    status(spoofed, 200, 'spoofed headers')
    same(spoofed.data, [], 'spoofed headers confer no access')
    for (const rpc of ['set_config', 'exec_sql']) {
      const result = await api(users[2], `rpc/${rpc}`, { method: 'POST', body: {} })
      status(result, 404, 'no SQL/session impersonation RPC')
      same(result.data.code, 'PGRST202', 'no arbitrary SQL RPC')
    }
    await denied(u, 'organization_memberships', { method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: { organization_id: orgs[1], user_id: u.id, role: 'admin', is_active: true } })
    // Corrupt an actual Auth token to verify signature enforcement, never use a
    // self-signed token to simulate any authorized test session.
    const parts = users[2].token.split('.')
    parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1)
    status(await request('/rest/v1/employees', { token: parts.join('.') }), 401, 'tampered session JWT')
    status(await request('/rest/v1/employees', { key: '' }), 401, 'no API key or session')
    for (const candidate of [null, users[2], users[6]]) {
      const helper = await api(candidate, 'rpc/membership_role', { method: 'POST', body: { target_organization: orgs[0] } })
      status(helper, 404, 'private helper absent from public RPC')
      same(helper.data.code, 'PGRST202', 'no public RPC lookup')
      for (const schema of ['tipsplitter_private', 'auth']) {
        const profile = await api(candidate, 'rpc/membership_role', { method: 'POST', body: { target_organization: orgs[0] }, headers: { 'Content-Profile': schema } })
        status(profile, 406, 'private schema cannot be selected')
        same(profile.data.code, 'PGRST106', 'schema exposure denial')
        const getProfile = await api(candidate, 'users', { headers: { 'Accept-Profile': schema } })
        status(getProfile, 406, 'private schema cannot be read')
        same(getProfile.data.code, 'PGRST106', 'read schema exposure denial')
      }
    }
    // Ordinary admins/closers/nonmembers cannot administer Auth accounts.
    for (const candidate of users) {
      status(await request('/auth/v1/admin/users', { token: candidate.token }), 403, 'no Auth account list')
      status(await request(`/auth/v1/admin/users/${users[6].id}`, { token: candidate.token, method: 'PUT', body: { app_metadata: { role: 'admin' } } }), 403, 'no Auth account elevation')
      status(await request(`/auth/v1/admin/users/${users[6].id}`, { token: candidate.token, method: 'DELETE' }), 403, 'no Auth account deletion')
    }
    // Preserve custom service_role revokes, despite its managed BYPASSRLS.
    for (const t of tables) {
      const result = await request(`/rest/v1/${t}`, { token: config.SERVICE_ROLE_KEY, key: config.SERVICE_ROLE_KEY })
      status(result, 403, 'service_role application ACL denied')
      same(result.data.code, '42501', 'service_role cannot bypass missing ACL')
    }
  })
  const accountAfter = await request('/auth/v1/user', { token: users[6].token })
  status(accountAfter, 200, 'target account survived prohibited administration')
  same(accountAfter.data.app_metadata, accountBefore.data.app_metadata, 'Auth account privileges unchanged')
  console.log(`Private API exposure, Auth administration and bypass attempts passed (${requests} real HTTP requests).`)
}
