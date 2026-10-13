// Ordinary Auth sessions + publishable/anon API key only. No SQL/CLI/admin key.
import { randomUUID } from 'node:crypto'

const tables = ['organizations', 'organization_memberships', 'job_roles', 'employees']
const roster = ['job_roles', 'employees']
const require = (ok, label) => {
  if (!ok) { console.error(`Hosted assertion failed: ${label}; response and credentials withheld.`); throw new Error('Hosted assertion failed') }
}
const key = row => row.id ?? `${row.organization_id}:${row.user_id}`
const canonical = rows => JSON.stringify(rows.map(r => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)))).sort((a, b) => key(a).localeCompare(key(b))))

export async function hostedHttp(c, memberships, pause) {
  let requests = 0
  const users = []
  const revoked = new Set()
  const insertedRoles = new Map()
  async function request(path, user, { method = 'GET', body, headers = {} } = {}) {
    requests++
    const result = await fetch(`${c.apiUrl}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { apikey: c.apiKey, ...(user ? { Authorization: `Bearer ${user.token}` } : {}), 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    let data
    try { data = await result.json() } catch { data = null }
    return { status: result.status, data, range: result.headers.get('content-range') }
  }
  const expect = (r, status, code, label) => require(r.status === status && (!code || r.data?.code === code), label)
  async function api(user, table, method = 'GET', body, query = '', headers = {}) {
    return request(`/rest/v1/${table}${query ? `?${query}` : ''}`, user, { method, body, headers: { Prefer: 'return=representation,count=exact', ...headers } })
  }
  async function read(user, table) {
    const r = await api(user, table, 'GET', undefined, 'select=*')
    expect(r, 200, null, `read ${table}`)
    require(Array.isArray(r.data) && /\/\d+$/.test(r.range ?? '') && Number(r.range.split('/')[1]) === r.data.length, `complete ${table} rows; no pagination truncation`)
    return r.data
  }
  for (const planned of c.users) {
    const r = await request('/auth/v1/token?grant_type=password', null, { method: 'POST', body: { email: planned.email, password: planned.password } })
    expect(r, 200, null, `${planned.category} password sign-in`)
    require(typeof r.data?.access_token === 'string' && typeof r.data?.refresh_token === 'string' && r.data.user?.id === planned.id, 'Auth-issued account/session matches plan')
    const user = { ...planned, token: r.data.access_token }
    const claims = JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url').toString())
    require(claims.sub === user.id && claims.role === 'authenticated' && claims.iss === `${c.apiUrl}/auth/v1`, 'session subject/role/issuer')
    const verified = await request('/auth/v1/user', user)
    expect(verified, 200, null, 'independent Auth session verification')
    require(verified.data.id === user.id && verified.data.email === user.email, 'verified synthetic account')
    user.appMetadata = verified.data.app_metadata
    users.push(user)
  }
  console.log('Hosted synthetic sign-in and Auth session verification passed.')
  // Two ordinary admins observe all application rows, including hidden denials.
  // admin-A and dual-closer-A/admin-B retain these observer rights after revocation.
  async function snapshot() {
    const state = {}
    for (const table of tables) {
      const a = await read(users[0], table), b = await read(users[5], table)
      const rows = new Map(a.map(row => [key(row), row]))
      for (const row of b) {
        require(!rows.has(key(row)) || canonical([rows.get(key(row))]) === canonical([row]), 'observers agree on overlapping committed row')
        rows.set(key(row), row)
      }
      state[table] = [...rows.values()]
    }
    return state
  }
  const initial = await snapshot()
  for (const [table, ids] of [['organizations', c.orgs], ['job_roles', c.roles], ['employees', c.employees]]) {
    require(JSON.stringify(initial[table].map(r => r.id).sort()) === JSON.stringify([...ids].sort()), `initial exact ${table} fixture`)
  }
  const membershipRows = () => memberships.map(([o, i, role]) => ({ organization_id: c.orgs[o], user_id: users[i].id, role, is_active: !revoked.has(`${o}:${i}`) }))
  const membershipFields = rows => rows.map(({ organization_id, user_id, role, is_active }) => ({ organization_id, user_id, role, is_active }))
  require(canonical(membershipFields(initial.organization_memberships)) === canonical(membershipRows()), 'exact provisioned memberships')
  for (let o = 0; o < 2; o++) {
    require(initial.job_roles.find(r => r.id === c.roles[o]).organization_id === c.orgs[o]
      && initial.employees.find(r => r.id === c.employees[o]).organization_id === c.orgs[o]
      && initial.employees.find(r => r.id === c.employees[o]).default_role_id === c.roles[o], 'fixture tenant and role references')
  }
  async function unchanged(action) {
    const before = await snapshot()
    const result = await action()
    const after = await snapshot()
    require(tables.every(t => canonical(before[t]) === canonical(after[t])), 'denial leaves all persisted application rows unchanged')
    return result
  }
  const denied = async (user, table, method, body, query, code = '42501', http = user ? 403 : 401) => {
    const r = await unchanged(() => api(user, table, method, body, query))
    expect(r, http, code, `${user?.category ?? 'anonymous'} denied ${method} ${table}`)
  }
  async function hidden(user, table, org) {
    const r = await unchanged(() => api(user, table, 'PATCH', { name: 'Synthetic forbidden edit' }, `organization_id=eq.${org}`))
    expect(r, 200, null, 'RLS hidden PATCH')
    require(Array.isArray(r.data) && r.data.length === 0, 'hidden PATCH changes zero rows')
  }
  async function visibility(i) {
    const own = membershipRows().filter(m => m.user_id === users[i].id && m.is_active)
    const allowed = own.map(m => m.organization_id)
    const all = await snapshot()
    for (const t of tables) {
      const expected = t === 'organization_memberships' ? all[t].filter(m => own.some(a => a.organization_id === m.organization_id && (a.role === 'admin' || m.user_id === users[i].id && m.is_active)))
        : all[t].filter(row => allowed.includes(t === 'organizations' ? row.id : row.organization_id))
      require(canonical(await read(users[i], t)) === canonical(expected), `${users[i].category} exact ${t} visibility`)
    }
  }
  const insertBody = (table, o, name = 'Synthetic forbidden') => ({ organization_id: c.orgs[o], name,
    ...(table === 'job_roles' ? { default_weight: 0.25 } : { default_role_id: c.roles[o], default_weight_override: 0 }) })
  for (const t of tables) {
    await denied(null, t, 'GET')
    await denied(null, t, 'DELETE', undefined, `${t === 'organizations' ? 'id' : 'organization_id'}=eq.${c.orgs[0]}`)
  }
  for (const t of roster) {
    await denied(null, t, 'POST', insertBody(t, 0))
    await denied(null, t, 'PATCH', { name: 'Synthetic forbidden' }, `organization_id=eq.${c.orgs[0]}`)
  }
  for (let i = 0; i < 7; i++) {
    await visibility(i)
    for (let o = 0; o < 2; o++) {
      const own = memberships.some(([org, u]) => org === o && u === i)
      for (const t of roster) {
        if (!own) {
          await denied(users[i], t, 'POST', insertBody(t, o))
          await hidden(users[i], t, c.orgs[o])
          continue
        }
        const body = { ...insertBody(t, o, `Synthetic ${c.run} ${i}-${o}-${t}`), ...(t === 'employees' ? { default_role_id: insertedRoles.get(`${i}:${o}`) } : {}) }
        const r = await api(users[i], t, 'POST', body)
        expect(r, 201, null, `${users[i].category} own roster INSERT`)
        require(Array.isArray(r.data) && r.data.length === 1 && Object.entries(body).every(([k, v]) => r.data[0][k] === v), 'inserted tenant/fields')
        const row = r.data[0]
        if (t === 'job_roles') insertedRoles.set(`${i}:${o}`, row.id)
        require(typeof row.id === 'string' && row.created_at && row.updated_at, 'server-generated metadata')
        const edit = { name: body.name + ' edited', is_active: false, ...(t === 'job_roles' ? { default_weight: 1.25 } : { default_role_id: c.roles[o], default_weight_override: null }) }
        const edited = await api(users[i], t, 'PATCH', edit, `id=eq.${row.id}`)
        expect(edited, 200, null, 'own roster edit/deactivation')
        require(edited.data.length === 1 && edited.data[0].created_at === row.created_at && Date.parse(edited.data[0].updated_at) >= Date.parse(row.updated_at)
          && Object.entries(edit).every(([k, v]) => edited.data[0][k] === v), 'exact edited fields and timestamps')
        const active = await api(users[i], t, 'PATCH', { is_active: true }, `id=eq.${row.id}`)
        expect(active, 200, null, 'own roster reactivation')
        require(active.data.length === 1 && active.data[0].is_active === true, 'reactivation persisted')
        require(canonical((await read(users[i], t)).filter(r => r.id === row.id)) === canonical(active.data), 'subsequent GET confirms committed edit')
        await denied(users[i], t, 'PATCH', { organization_id: c.orgs[1 - o] }, `id=eq.${row.id}`)
        for (const protectedBody of [{ id: randomUUID() }, { created_at: '2100-01-01T00:00:00Z' }, { updated_at: '2100-01-01T00:00:00Z' }]) {
          await denied(users[i], t, 'POST', { ...body, name: body.name + ' protected', ...protectedBody })
          await denied(users[i], t, 'PATCH', protectedBody, `id=eq.${row.id}`)
        }
        await denied(users[i], t, 'DELETE', undefined, `id=eq.${row.id}`)
      }
      if (own) {
        await denied(users[i], 'employees', 'POST', { ...insertBody('employees', o), default_role_id: c.roles[1 - o] }, '', '23503', 409)
        await denied(users[i], 'employees', 'PATCH', { default_role_id: c.roles[1 - o] }, `id=eq.${c.employees[o]}`, '23503', 409)
      }
    }
    await denied(users[i], 'organizations', 'POST', { name: 'Synthetic forbidden organization' })
    await denied(users[i], 'organizations', 'PATCH', { name: 'Synthetic forbidden' }, `id=eq.${c.orgs[0]}`)
    await denied(users[i], 'organizations', 'DELETE', undefined, `id=eq.${c.orgs[0]}`)
    await denied(users[i], 'organization_memberships', 'POST', { organization_id: c.orgs[0], user_id: users[i].id, role: 'admin' })
    for (const body of [{ role: 'admin' }, { is_active: false }, { is_active: true }, { user_id: users[6].id }, { organization_id: c.orgs[1] }]) {
      await denied(users[i], 'organization_memberships', 'PATCH', body, `organization_id=eq.${c.orgs[0]}&user_id=eq.${users[i].id}`)
    }
    await denied(users[i], 'organization_memberships', 'DELETE', undefined, `organization_id=eq.${c.orgs[0]}&user_id=eq.${users[i].id}`)
  }
  console.log('Hosted admin/closer writes, nonmember/anonymous denials, dual memberships, tenant immutability and independent observer reads passed.')
  await pause() // No automated privileged database mutation; preserve original JWTs.
  for (const [o, i] of [[0, 1], [0, 4], [0, 5], [1, 2]]) revoked.add(`${o}:${i}`)
  require(canonical(membershipFields((await snapshot()).organization_memberships)) === canonical(membershipRows()), 'owner revocation persisted exactly as planned')
  for (const i of [1, 2, 4, 5]) {
    const r = await request('/auth/v1/user', users[i])
    expect(r, 200, null, 'unchanged Auth session after membership revocation')
    require(r.data.id === users[i].id, 'same session subject after revocation')
    await visibility(i)
    const lost = i === 2 ? 1 : 0
    for (const t of roster) {
      await denied(users[i], t, 'POST', insertBody(t, lost))
      await hidden(users[i], t, c.orgs[lost])
    }
    await denied(users[i], 'organization_memberships', 'PATCH', { is_active: true, role: 'admin' }, `organization_id=eq.${c.orgs[lost]}&user_id=eq.${users[i].id}`)
    if (i >= 4) {
      const retained = await api(users[i], 'employees', 'PATCH', { name: `Synthetic retained ${i}` }, `id=eq.${c.employees[1]}`)
      expect(retained, 200, null, 'retained restaurant B edit')
      require(retained.data.length === 1 && retained.data[0].name === `Synthetic retained ${i}`, 'retained edit persisted')
    }
  }
  for (const u of [null, users[0], users[6]]) {
    const rpc = await api(u, 'rpc/membership_role', 'POST', { target_organization: c.orgs[0] })
    expect(rpc, 404, 'PGRST202', 'private helper absent from public RPC')
    for (const schema of ['tipsplitter_private', 'auth']) {
      expect(await api(u, 'rpc/membership_role', 'POST', { target_organization: c.orgs[0] }, '', { 'Content-Profile': schema }), 406, 'PGRST106', 'private write schema not exposed')
      expect(await api(u, 'users', 'GET', undefined, '', { 'Accept-Profile': schema }), 406, 'PGRST106', 'private read schema not exposed')
    }
  }
  for (const u of users) {
    expect(await request('/auth/v1/admin/users', u), 403, null, 'ordinary users cannot list Auth accounts')
    expect(await request(`/auth/v1/admin/users/${users[6].id}`, u, { method: 'PUT', body: { app_metadata: { role: 'admin' } } }), 403, null, 'ordinary users cannot elevate Auth accounts')
    expect(await request(`/auth/v1/admin/users/${users[6].id}`, u, { method: 'DELETE' }), 403, null, 'ordinary users cannot delete Auth accounts')
  }
  const target = await request('/auth/v1/user', users[6])
  expect(target, 200, null, 'nonmember account survives forbidden administration')
  require(JSON.stringify(target.data.app_metadata) === JSON.stringify(users[6].appMetadata), 'forbidden Auth administration leaves account privileges unchanged')
  const parts = users[0].token.split('.')
  parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1)
  expect(await request('/rest/v1/employees', { token: parts.join('.') }), 401, null, 'corrupted real JWT rejected')
  for (let i = 0; i < 7; i++) await visibility(i)
  console.log(`Hosted revocation with original sessions, retained tenant rights, private helper non-exposure and Auth administration denials passed (${requests} HTTP requests).`)
  return snapshot()
}
