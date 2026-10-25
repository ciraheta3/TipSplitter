// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import ManageSharedRoster from './ManageSharedRoster';
import Calculator from './Calculator';
import SharedRoster from './SharedRoster';
import AuthGate from './AuthGate';
import { accountRosterKey } from './supabase';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const userId = id(1), org = id(2), foreign = id(3);
const session = { user: { id: userId }, access_token: 'fictional-session', expires_at: Date.now() / 1000 + 3600 } as Session;
type Table = 'job_roles' | 'employees' | 'organization_memberships' | 'organizations';
type Row = Record<string, unknown>;
let tables: Record<Table, Row[]>;
let client: SupabaseClient;
let requests: { table: Table; url: URL; init: RequestInit }[];
let intercept: (table: Table, url: URL, init: RequestInit) => Response | Promise<Response> | undefined;
let emit: (event?: AuthChangeEvent, candidate?: Session | null) => void;
let auth: { getSession: ReturnType<typeof vi.fn>; getUser: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn>; onAuthStateChange: ReturnType<typeof vi.fn> };
function response(rows: unknown[], status = 200, count = rows.length) {
  return new Response(JSON.stringify(rows), { status, headers: { 'Content-Type': 'application/json', 'Content-Range': rows.length ? `0-${rows.length - 1}/${count}` : `*/${count}` } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function query(table: Table, url: URL, init: RequestInit) {
  const matches = (row: Row) => [...url.searchParams].every(([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3));
  const method = init.method ?? 'GET';
  let rows = tables[table].filter(matches);
  if (method === 'PATCH') {
    const body = JSON.parse(String(init.body));
    rows.forEach(row => Object.assign(row, body, { xmin: String(BigInt(String(row.xmin)) + 1n) }));
  }
  if (method === 'POST') {
    const row = { ...JSON.parse(String(init.body)), id: id(100 + requests.length), xmin: '1000' };
    tables[table].push(row); rows = [row];
  }
  const fields = url.searchParams.get('select')!.split(',').map(column => column.replace('::text', ''));
  return response(rows.map(row => Object.fromEntries(fields.map(field => [field, row[field]]))), method === 'POST' ? 201 : 200);
}
beforeEach(() => {
  tables = {
    organizations: [{ id: org, name: 'Fictional restaurant A' }],
    organization_memberships: [{ organization_id: org, user_id: userId, role: 'admin', is_active: true }],
    job_roles: [
      { id: id(4), organization_id: org, name: 'Fictional server', is_active: true, default_weight: '100.50', xmin: '701' },
      { id: id(5), organization_id: org, name: 'Fictional retired role', is_active: false, default_weight: '50', xmin: '702' },
    ],
    employees: [{ id: id(6), organization_id: org, name: 'Fictional Avery', is_active: true, default_role_id: id(5), default_weight_override: null, xmin: '703' }],
  };
  requests = [];
  intercept = () => undefined;
  const sdk = createClient('https://fictional.example.test', 'sb_publishable_fictional_placeholder', {
    accessToken: async () => 'fictional-session', auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1) as Table;
      expect(['job_roles', 'employees', 'organization_memberships', 'organizations']).toContain(table);
      expect(['GET', 'POST', 'PATCH']).toContain(init.method ?? 'GET');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fictional-session');
      requests.push({ table, url, init });
      return await (intercept(table, url, init) ?? query(table, url, init));
    } },
  });
  const listeners = new Set<(event: AuthChangeEvent, candidate: Session | null) => void>();
  emit = (event = 'TOKEN_REFRESHED', candidate = session) => listeners.forEach(callback => callback(event, candidate));
  auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: session.user }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(callback => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    }),
  };
  client = { from: sdk.from.bind(sdk), auth } as unknown as SupabaseClient;
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });
function manager() { return <ManageSharedRoster client={client} userId={userId} organizationId={org} onClose={() => {}} />; }
const mutations = () => requests.filter(request => ['POST', 'PATCH'].includes(request.init.method ?? 'GET'));
function expandEmployeeGroups() {
  const employees = screen.queryByRole('region', { name: 'Employees' });
  if (!employees) return;
  for (const toggle of within(employees).queryAllByRole('button', { expanded: false })) {
    if (!(toggle as HTMLButtonElement).disabled) fireEvent.click(toggle);
  }
}
async function loaded(expand = true) {
  await waitFor(() => expect(screen.queryByText('Verifying access and exact shared defaults…')).not.toBeInTheDocument());
  const add = await screen.findByRole('button', { name: 'Add role' });
  if (expand) expandEmployeeGroups();
  return add;
}
async function addRole(name = '  Fictional custom  ', weight = '90071992547409.91') {
  await userEvent.click(await loaded());
  await userEvent.type(screen.getByLabelText('Shared role name'), name);
  await userEvent.type(screen.getByLabelText('Default share weight'), weight);
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
}
async function submitEmployee(name = 'Fictional delayed employee') {
  await userEvent.click(screen.getByRole('button', { name: 'Add employee' }));
  fireEvent.change(screen.getByLabelText('Shared employee name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Default shared job role'), { target: { value: id(4) } });
  fireEvent.submit(screen.getByRole('form', { name: 'Add shared employee' }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
}
async function inspectAndAcknowledge(expected = 'Fictional delayed employee · Active') {
  await userEvent.click(screen.getByRole('button', { name: 'Inspect current roster' }));
  await loaded();
  expect(await screen.findByText(expected)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  await userEvent.click(await screen.findByRole('button', { name: 'I inspected the roster; allow new edits' }));
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeEnabled();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
}

it.each(['admin', 'closer'])('allows active %s exact-string inserts, rechecks access and reloads server state', async role => {
  tables.organization_memberships[0].role = role;
  render(manager());
  await addRole();
  expect(await screen.findByText('Save confirmed. Shared roster refreshed.')).toBeVisible();
  expect(screen.getByText('Fictional custom · Active')).toBeVisible();
  expect(screen.getByText('Default share weight: 90071992547409.91')).toBeVisible();
  expect(mutations()).toHaveLength(1);
  const request = mutations()[0];
  expect(JSON.parse(String(request.init.body))).toEqual({ organization_id: org, name: 'Fictional custom', default_weight: '90071992547409.91', is_active: true });
  expect(request.url.searchParams.get('select')).toBe('id,organization_id,name,is_active,default_weight::text,xmin::text');
  expect(new Headers(request.init.headers).get('Prefer')).toContain('count=exact');
  expect(new Headers(request.init.headers).get('Prefer')).toContain('return=representation');
  expect(auth.getUser.mock.calls.length).toBeGreaterThanOrEqual(6);
});

it('preserves inactive existing links and changes employee NULL to explicit zero and back with version filters', async () => {
  render(manager()); await loaded();
  expect(screen.getByText('Effective default share weight: 50 · Inherited from role')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Edit shared employee Fictional Avery' }));
  expect(screen.getByLabelText('Default shared job role')).toHaveValue(id(5));
  expect(screen.getByRole('option', { name: /Fictional retired role/ })).toBeEnabled();
  await userEvent.type(screen.getByLabelText('Default share weight override (blank inherits role)'), '0');
  await userEvent.click(screen.getByLabelText('Active shared employee'));
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  await screen.findByText('Save confirmed. Shared roster refreshed.');
  expandEmployeeGroups();
  expect(screen.getByText('Effective default share weight: 0.00 · Explicit zero override')).toBeVisible();
  expect(screen.getByText('Fictional Avery · Inactive')).toBeVisible();
  const patch = mutations()[0];
  expect(patch.url.searchParams.get('organization_id')).toBe(`eq.${org}`);
  expect(patch.url.searchParams.get('id')).toBe(`eq.${id(6)}`);
  expect(patch.url.searchParams.get('xmin')).toBe('eq.703');
  expect(JSON.parse(String(patch.init.body))).toEqual({ name: 'Fictional Avery', default_role_id: id(5), default_weight_override: '0.00', is_active: false });
  await userEvent.click(screen.getByRole('button', { name: 'Edit shared employee Fictional Avery' }));
  await userEvent.clear(screen.getByLabelText('Default share weight override (blank inherits role)'));
  await userEvent.click(screen.getByLabelText('Active shared employee'));
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  await screen.findByText('Save confirmed. Shared roster refreshed.');
  expandEmployeeGroups();
  expect(JSON.parse(String(mutations()[1].init.body)).default_weight_override).toBeNull();
  expect(mutations()[1].url.searchParams.get('xmin')).toBe('eq.704');
  expect(screen.getByText('Effective default share weight: 50 · Inherited from role')).toBeVisible();
});

it('disables new inactive-role assignments, allows duplicate employee names, and retains an explicit override when changing roles', async () => {
  tables.job_roles.push({ id: id(7), organization_id: org, name: 'Fictional second active', is_active: true, default_weight: '25', xmin: '704' });
  render(manager()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Add employee' }));
  expect(screen.getByRole('option', { name: /Fictional retired role/ })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Shared employee name'), 'Fictional Avery');
  await userEvent.selectOptions(screen.getByLabelText('Default shared job role'), id(4));
  await userEvent.type(screen.getByLabelText('Default share weight override (blank inherits role)'), '0.01');
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  await screen.findByText('Save confirmed. Shared roster refreshed.');
  expandEmployeeGroups();
  expect(screen.getAllByText('Fictional Avery · Active')).toHaveLength(2);
  expect(screen.getByText('Effective default share weight: 0.01 · Employee override')).toBeVisible();
  const form = screen.getByRole('button', { name: new RegExp(`Edit shared employee Fictional Avery.*${tables.employees[1].id}`) });
  await userEvent.click(form);
  expect(screen.getByLabelText('Default share weight override (blank inherits role)')).toHaveValue('0.01');
  await userEvent.selectOptions(screen.getByLabelText('Default shared job role'), id(7));
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  await screen.findByText('Save confirmed. Shared roster refreshed.');
  expandEmployeeGroups();
  expect(JSON.parse(String(mutations()[1].init.body))).toMatchObject({ default_role_id: id(7), default_weight_override: '0.01' });
});

it('requires an active role for new employees and allows role reactivation without changing links', async () => {
  tables.job_roles[0].is_active = false;
  render(manager()); await loaded();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Edit shared role Fictional server' }));
  await userEvent.click(screen.getByLabelText('Active shared role'));
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  await screen.findByText('Save confirmed. Shared roster refreshed.');
  expandEmployeeGroups();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeEnabled();
  expect(tables.employees[0].default_role_id).toBe(id(5));
});

it('rechecks a new default role and blocks it if it became inactive', async () => {
  render(manager()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Add employee' }));
  await userEvent.type(screen.getByLabelText('Shared employee name'), 'Fictional new employee');
  await userEvent.selectOptions(screen.getByLabelText('Default shared job role'), id(4));
  tables.job_roles[0].is_active = false;
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('selected role changed');
  expect(mutations()).toHaveLength(0);
});

it.each(['numeric', 'foreign', 'version', 'truncated', 'missing-role'])('fails closed for %s editing snapshots', async kind => {
  if (kind === 'numeric') tables.job_roles[0].default_weight = 100.5;
  if (kind === 'foreign') intercept = table => table === 'job_roles' ? response([{ ...tables.job_roles[0], organization_id: foreign }]) : undefined;
  if (kind === 'version') tables.job_roles[0].xmin = 701;
  if (kind === 'truncated') intercept = table => table === 'employees' ? response(tables.employees, 200, 1001) : undefined;
  if (kind === 'missing-role') tables.employees[0].default_role_id = id(99);
  render(manager());
  expect(await screen.findByRole('alert')).toHaveTextContent('Shared data could not be verified');
  expect(screen.queryByRole('button', { name: 'Add role' })).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});

it.each(['1e2', '1.001', '1.000', '90071992547409.92'])('rejects invalid share input %s before mutations', async weight => {
  render(manager()); await addRole('Fictional invalid', weight);
  expect(await screen.findByRole('alert')).toHaveTextContent('at most two decimal places');
  expect(mutations()).toHaveLength(0);
  expect(screen.getByLabelText('Default share weight')).toHaveValue(weight);
});

it.each([['role', 101], ['employee', 161]] as const)('enforces the %s name limit after trimming', async (kind, length) => {
  render(manager()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: kind === 'role' ? 'Add role' : 'Add employee' }));
  fireEvent.change(screen.getByLabelText(`Shared ${kind} name`), { target: { value: 'x'.repeat(length) } });
  if (kind === 'role') fireEvent.change(screen.getByLabelText('Default share weight'), { target: { value: '1' } });
  else await userEvent.selectOptions(screen.getByLabelText('Default shared job role'), id(4));
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Name is required');
  expect(mutations()).toHaveLength(0);
});

it.each([
  ['23505', 'already exists'], ['23503', 'default role is unavailable'], ['23514', 'server rejected'], ['42501', 'access could not be verified'],
])('handles database %s safely without success or automatic retries', async (code, message) => {
  intercept = (_table, _url, init) => init.method === 'POST' ? new Response(JSON.stringify({ code, message: 'private SQL token detail' }), { status: code === '42501' ? 403 : 409 }) : undefined;
  render(manager()); await addRole();
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(1);
});

it('blocks stale edits on a zero-row compare and requires a fresh reload', async () => {
  render(manager()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Edit shared role Fictional server' }));
  tables.job_roles[0].xmin = '900'; tables.job_roles[0].name = 'Fictional other operator';
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('row changed or access was revoked');
  expect(screen.queryByRole('button', { name: 'Save shared roster' })).not.toBeInTheDocument();
  expect(tables.job_roles[0].name).toBe('Fictional other operator');
  await userEvent.click(screen.getByRole('button', { name: 'Reload management / discard draft' }));
  expect(await screen.findByText('Fictional other operator · Active')).toBeVisible();
});

it.each(['network', 'multiple-rows', 'wrong-org', 'numeric-weight', 'missing-count'])('blocks uncertain %s insert results and discards the add draft', async kind => {
  intercept = (_table, _url, init) => {
    if (init.method !== 'POST') return;
    if (kind === 'network') throw new Error('private token');
    const result = { ...JSON.parse(String(init.body)), id: id(90), xmin: '900' };
    if (kind === 'multiple-rows') return response([result, { ...result, id: id(91) }]);
    if (kind === 'wrong-org') result.organization_id = foreign;
    if (kind === 'numeric-weight') result.default_weight = 0.01;
    if (kind === 'missing-count') return new Response(JSON.stringify([result]), { status: 201 });
    return response([result], 201);
  };
  render(manager()); await addRole();
  expect(await screen.findByRole('alert')).toHaveTextContent('Save could not be confirmed');
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(1);
});

it.each(['no-session', 'wrong-user', 'unverified', 'nonmember', 'revoked', 'foreign', 'wrong-role'])('exposes no controls with %s context', async kind => {
  if (kind === 'no-session') auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  if (kind === 'wrong-user') auth.getSession.mockResolvedValue({ data: { session: { ...session, user: { id: id(99) } } }, error: null });
  if (kind === 'unverified') auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'private token' } });
  if (kind === 'nonmember') tables.organization_memberships = [];
  if (kind === 'revoked') tables.organization_memberships[0].is_active = false;
  if (kind === 'foreign') intercept = table => table === 'organization_memberships' ? response([{ ...tables.organization_memberships[0], organization_id: foreign }]) : undefined;
  if (kind === 'wrong-role') tables.organization_memberships[0].role = 'owner';
  render(manager());
  expect(await screen.findByRole('alert')).toHaveTextContent('access could not be verified');
  expect(screen.queryByRole('button', { name: 'Add role' })).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});

it('rechecks revoked membership immediately before saving', async () => {
  render(manager()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Add role' }));
  await userEvent.type(screen.getByLabelText('Shared role name'), 'Fictional revoked');
  await userEvent.type(screen.getByLabelText('Default share weight'), '1');
  tables.organization_memberships = [];
  await userEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  await screen.findByRole('alert');
  expect(mutations()).toHaveLength(0);
});

it('does not report a returned save as success after access is revoked', async () => {
  intercept = (table, url, init) => {
    if (init.method !== 'POST') return;
    const result = query(table, url, init); tables.organization_memberships = []; return result;
  };
  render(manager()); await addRole();
  expect(await screen.findByRole('alert')).toHaveTextContent('Save could not be confirmed');
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
});

it('handles offline loading and explicit retry with fresh access verification', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  render(manager());
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  expect(requests).toHaveLength(0);
  online.mockReturnValue(true);
  await userEvent.click(screen.getByRole('button', { name: 'Reload management / discard draft' }));
  expect(await loaded()).toBeVisible();
});

it.each(['unmount', 'auth-event', 'reload'])('ignores delayed saves after %s and never retries the insert', async kind => {
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  const view = render(manager()); await addRole();
  await waitFor(() => expect(mutations()).toHaveLength(1));
  const request = mutations()[0];
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  if (kind === 'unmount') view.unmount();
  if (kind === 'auth-event') { auth.getSession.mockResolvedValue({ data: { session: null }, error: null }); act(() => emit()); }
  if (kind === 'reload') fireEvent.click(screen.getByRole('button', { name: 'Reload management / discard draft' }));
  expect(request.init.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(response([{ ...JSON.parse(String(request.init.body)), id: id(90), xmin: '900' }], 201)));
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(1);
});

it.each(['offline', 'blocked-tenant-switch'])('parent context blocks navigation and aborts a pending mutation on %s without stale success or data disclosure', async kind => {
  tables.organizations.push({ id: foreign, name: 'Fictional restaurant B' });
  tables.organization_memberships.push({ organization_id: foreign, user_id: userId, role: 'closer', is_active: true });
  render(<SharedRoster client={client} userId={userId} />);
  await userEvent.selectOptions(await screen.findByLabelText('Restaurant'), org);
  await userEvent.click(await screen.findByRole('button', { name: 'Manage roster' }));
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  await addRole();
  expect(mutations()).toHaveLength(1);
  const request = mutations()[0];
  if (kind === 'offline') {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent(window, new Event('offline'));
    await screen.findByRole('alert');
  } else {
    expect(screen.getByLabelText('Restaurant')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back to calculator' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Restaurant'), foreign);
    expect(screen.getByLabelText('Restaurant')).toHaveValue(org);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent(window, new Event('offline'));
    await screen.findByRole('alert');
  }
  expect(request.init.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(response([{ ...JSON.parse(String(request.init.body)), id: id(90), xmin: '900' }], 201)));
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  expect(screen.queryByText('Fictional custom · Active')).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(1);
});

it('expires the write snapshot without losing input through several minutes of access checks', async () => {
  vi.useFakeTimers();
  render(manager());
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
  fireEvent.change(screen.getByLabelText('Shared role name'), { target: { value: 'Fictional unsent' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional unsent');
  expect(screen.getByRole('alert')).toHaveTextContent('snapshot expired');
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeDisabled();
  const checked = auth.getUser.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional unsent');
  expect(auth.getUser.mock.calls.length).toBeGreaterThan(checked);
  fireEvent.submit(screen.getByRole('form'));
  expect(mutations()).toHaveLength(0);
});

it('rejects an expired snapshot after OS sleep even before a browser timer fires', async () => {
  render(manager()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Add role' }));
  await userEvent.type(screen.getByLabelText('Shared role name'), 'Fictional sleeping draft');
  await userEvent.type(screen.getByLabelText('Default share weight'), '1');
  const resumedAt = Date.now() + 60_001;
  vi.spyOn(Date, 'now').mockReturnValue(resumedAt);
  fireEvent.click(screen.getByRole('button', { name: 'Save shared roster' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('editing snapshot expired');
  expect(mutations()).toHaveLength(0);
});

it('keeps local/account calculator storage and payouts isolated from shared writes', async () => {
  const own = JSON.stringify([{ id: 'local', name: 'Fictional local', jobTitle: 'Local', weight: 100 }]);
  localStorage.setItem('fictional-account', own); localStorage.setItem('employees', 'unrelated legacy');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  render(<>{manager()}<Calculator storageKey="fictional-account" /></>);
  await userEvent.type(screen.getByLabelText('Cash Tips ($)'), '100');
  await addRole(); await screen.findByText('Save confirmed. Shared roster refreshed.');
  expect(within(screen.getByRole('group', { name: 'Employee Fictional local' })).getByText('$100.00')).toBeVisible();
  expect(localStorage.getItem('fictional-account')).toBe(own);
  expect(localStorage.getItem('employees')).toBe('unrelated legacy');
  expect(write).not.toHaveBeenCalled();
});

it.each(['reload', 'auth-refresh', 'unmount', 'parent-focus'])('retains uncertainty across %s when the insert commits after the next read', async kind => {
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  const view = render(kind === 'parent-focus' ? <SharedRoster client={client} userId={userId} /> : manager());
  if (kind === 'parent-focus') await userEvent.click(await screen.findByRole('button', { name: 'Manage roster' }));
  await loaded(); await submitEmployee();
  const request = mutations()[0];
  if (kind === 'reload') fireEvent.click(screen.getByRole('button', { name: 'Reload management / discard draft' }));
  if (kind === 'auth-refresh') act(() => emit());
  if (kind === 'unmount') { view.unmount(); render(manager()); }
  if (kind === 'parent-focus') {
    fireEvent(window, new Event('focus'));
    expect(screen.getByRole('region', { name: 'Manage shared roster · DEV' })).toBeVisible();
  }
  await loaded();
  expect(request.init.signal?.aborted).toBe(true);
  expect(requests.filter(r => r.table === 'employees' && r.init.method === 'GET').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('Fictional delayed employee · Active')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('may have committed');
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Inspect current roster' })).toBeDisabled();
  // The server accepts the original insert despite the browser's aborted fetch.
  await act(async () => pending.resolve(query(request.table, request.url, request.init)));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Inspect current roster' })).toBeEnabled());
  expect(tables.employees.filter(row => row.name === 'Fictional delayed employee')).toHaveLength(1);
  expect(screen.queryByText('Fictional delayed employee · Active')).not.toBeInTheDocument();
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'I inspected the roster; allow new edits' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  await inspectAndAcknowledge();
  expect(screen.getByText('Inspection acknowledged. No write was retried.')).toBeVisible();
  expect(mutations()).toHaveLength(1);
});

it('keeps additions blocked when one-minute expiry interrupts an insert', async () => {
  vi.useFakeTimers();
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  render(manager());
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
  fireEvent.change(screen.getByLabelText('Shared employee name'), { target: { value: 'Fictional expiring insert' } });
  fireEvent.change(screen.getByLabelText('Default shared job role'), { target: { value: id(4) } });
  fireEvent.submit(screen.getByRole('form', { name: 'Add shared employee' }));
  await act(async () => {});
  expect(mutations()).toHaveLength(1);
  const request = mutations()[0];
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(request.init.signal?.aborted).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent('may have committed');
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  await act(async () => pending.resolve(query(request.table, request.url, request.init)));
  expect(screen.getByRole('button', { name: 'Inspect current roster' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(1);
});

it('retains uncertainty when fetch rejects on abort but the database commits later', async () => {
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => {
    if (init.method !== 'POST') return;
    init.signal?.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true });
    return pending.promise;
  };
  render(manager()); await loaded(); await submitEmployee();
  const request = mutations()[0];
  fireEvent.click(screen.getByRole('button', { name: 'Reload management / discard draft' }));
  await loaded();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Inspect current roster' })).toBeEnabled());
  expect(screen.queryByText('Fictional delayed employee · Active')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('A slow write may appear later');
  query(request.table, request.url, request.init); // independent, late DB commit
  await inspectAndAcknowledge();
  expect(mutations()).toHaveLength(1);
});

it('distinguishes a confirmed write from its failed refresh and requires inspection, not resubmission', async () => {
  let committed = false;
  let refreshFails = true;
  intercept = (table, url, init) => {
    if (init.method === 'POST') { const result = query(table, url, init); committed = true; return result; }
    if (committed && refreshFails && table === 'job_roles') return new Response(JSON.stringify({ code: 'XX000', message: 'private server detail' }), { status: 500 });
  };
  render(manager()); await loaded(); await submitEmployee();
  expect(await screen.findByRole('alert')).toHaveTextContent('Save was confirmed, but the roster refresh did not complete');
  expect(screen.getByRole('alert')).toHaveTextContent('Do not repeat the write');
  expect(screen.queryByText(/private server detail|Unable to save/)).not.toBeInTheDocument();
  expect(tables.employees.filter(row => row.name === 'Fictional delayed employee')).toHaveLength(1);
  // Even an explicitly requested inspection cannot acknowledge a failed read.
  await userEvent.click(screen.getByRole('button', { name: 'Inspect current roster' }));
  await screen.findByText('Unable to load shared data. Check your connection and refresh access.');
  expect(screen.queryByRole('button', { name: 'I inspected the roster; allow new edits' })).not.toBeInTheDocument();
  refreshFails = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reload management / discard draft' }));
  await loaded();
  expect(await screen.findByText('Fictional delayed employee · Active')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'I inspected the roster; allow new edits' })).not.toBeInTheDocument();
  await inspectAndAcknowledge();
  expect(mutations()).toHaveLength(1);
});

it.each(['insert', 'patch'])('blocks repeated Save submissions for an in-flight %s and never automatically repeats it', async kind => {
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => ['POST', 'PATCH'].includes(init.method ?? '') ? pending.promise : undefined;
  render(manager()); await loaded();
  if (kind === 'insert') {
    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    fireEvent.change(screen.getByLabelText('Shared employee name'), { target: { value: 'Fictional single insert' } });
    fireEvent.change(screen.getByLabelText('Default shared job role'), { target: { value: id(4) } });
  } else { expandEmployeeGroups(); fireEvent.click(screen.getByRole('button', { name: 'Edit shared employee Fictional Avery' })); }
  const form = screen.getByRole('form', { name: kind === 'insert' ? 'Add shared employee' : 'Edit shared employee' });
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  await waitFor(() => expect(mutations()).toHaveLength(1));
  fireEvent.submit(form);
  expect(mutations()).toHaveLength(1);
  const request = mutations()[0];
  if (kind === 'patch') expect(request.url.searchParams.get('xmin')).toBe('eq.703');
  expect(JSON.parse(String(request.init.body)).default_weight_override).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reload management / discard draft' }));
  await loaded();
  await act(async () => pending.resolve(query(request.table, request.url, request.init)));
  await inspectAndAcknowledge(kind === 'insert' ? 'Fictional single insert · Active' : 'Fictional Avery · Active');
  expect(mutations()).toHaveLength(1);
});

it.each(['account', 'restaurant', 'project'])('isolates recovery flags and data across a %s change, retaining the original scope warning', async kind => {
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  const view = render(manager()); await loaded(); await submitEmployee();
  const request = mutations()[0];
  if (kind === 'account') {
    auth.getSession.mockResolvedValue({ data: { session: { ...session, user: { id: id(99) } } }, error: null });
    auth.getUser.mockResolvedValue({ data: { user: { id: id(99) } }, error: null });
    view.rerender(<ManageSharedRoster client={client} userId={id(99)} organizationId={org} onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('access could not be verified');
  } else if (kind === 'restaurant') {
    tables.organization_memberships.push({ organization_id: foreign, user_id: userId, role: 'closer', is_active: true });
    view.rerender(<ManageSharedRoster client={client} userId={userId} organizationId={foreign} onClose={() => {}} />);
    expect(await loaded()).toBeEnabled();
  } else {
    // New SDK client identity represents a different project. Its own reads must
    // still verify access; the original project's recovery flags do not transfer.
    view.rerender(<ManageSharedRoster client={{ ...client } as SupabaseClient} userId={userId} organizationId={org} onClose={() => {}} />);
    expect(await loaded()).toBeEnabled();
  }
  expect(request.init.signal?.aborted).toBe(true);
  expect(screen.queryByText(/Save could not be confirmed|earlier save is still settling/)).not.toBeInTheDocument();
  expect(screen.queryByText('Fictional delayed employee · Active')).not.toBeInTheDocument();
  await act(async () => pending.resolve(query(request.table, request.url, request.init)));
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: session.user }, error: null });
  view.rerender(manager());
  await loaded();
  expect(screen.getByRole('alert')).toHaveTextContent('Save could not be confirmed');
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  await inspectAndAcknowledge();
  expect(mutations()).toHaveLength(1);
});

it('discards a cancelled inspection and requires a later verified inspection before acknowledgment', async () => {
  intercept = (_table, _url, init) => {
    if (init.method === 'POST') throw new TypeError('private network detail');
  };
  render(manager()); await loaded(); await submitEmployee();
  await screen.findByRole('alert');
  const lateRead = deferred<Response>();
  let captured: Response | undefined;
  intercept = (table, url, init) => {
    if (table === 'job_roles' && !captured) { captured = query(table, url, init); return lateRead.promise; }
  };
  fireEvent.click(screen.getByRole('button', { name: 'Inspect current roster' }));
  await waitFor(() => expect(captured).toBeDefined());
  act(() => emit());
  await loaded();
  await act(async () => lateRead.resolve(captured!));
  expect(screen.queryByRole('button', { name: 'I inspected the roster; allow new edits' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  await inspectAndAcknowledge('Fictional Avery · Active');
  expect(mutations()).toHaveLength(1);
});

async function openDraft(kind: 'role' | 'employee', parent = false) {
  render(parent ? <SharedRoster client={client} userId={userId} /> : manager());
  await act(async () => {});
  if (parent) {
    fireEvent.click(screen.getByRole('button', { name: 'Manage roster' }));
    await act(async () => {});
  }
  fireEvent.click(screen.getByRole('button', { name: kind === 'role' ? 'Add role' : 'Add employee' }));
  fireEvent.change(screen.getByLabelText(`Shared ${kind} name`), { target: { value: 'Fictional retained input' } });
  fireEvent.change(screen.getByLabelText(kind === 'role' ? 'Default share weight' : 'Default share weight override (blank inherits role)'), { target: { value: '0.01' } });
  if (kind === 'employee') fireEvent.change(screen.getByLabelText('Default shared job role'), { target: { value: id(4) } });
}

it.each(['role', 'employee'] as const)('keeps the parent %s editor open through four minutes, requiring explicit revalidation before a single save', async kind => {
  vi.useFakeTimers();
  await openDraft(kind, true);
  const verified = auth.getUser.mock.calls.length;
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
  expect(screen.getByRole('region', { name: 'Manage shared roster · DEV' })).toBeVisible();
  expect(screen.getByLabelText(`Shared ${kind} name`)).toHaveValue('Fictional retained input');
  expect(screen.getByRole('alert')).toHaveTextContent('snapshot expired');
  expect(auth.getUser.mock.calls.length).toBeGreaterThan(verified);
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('form'));
  expect(mutations()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Revalidate draft' }));
  await act(async () => {});
  expect(screen.getByLabelText(`Shared ${kind} name`)).toHaveValue('Fictional retained input');
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeEnabled();
  const form = screen.getByRole('form');
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  await act(async () => {});
  expect(mutations()).toHaveLength(1);
  expect(JSON.parse(String(mutations()[0].init.body))).toMatchObject({ name: 'Fictional retained input', [kind === 'role' ? 'default_weight' : 'default_weight_override']: '0.01' });
  expect(screen.getByText('Save confirmed. Shared roster refreshed.')).toBeVisible();
  expect(storage).not.toHaveBeenCalled();
});

it.each(['focus', 'visibility', 'manual-access-refresh'] as const)('preserves input and blocks only Save while %s rechecks access', async event => {
  await openDraft('role', true);
  const pending = deferred<Response>();
  const captured = response(tables.organization_memberships);
  intercept = table => table === 'organization_memberships' ? pending.promise : undefined;
  if (event === 'focus') fireEvent(window, new Event('focus'));
  if (event === 'visibility') fireEvent(document, new Event('visibilitychange'));
  if (event === 'manual-access-refresh') fireEvent.click(screen.getByRole('button', { name: 'Refresh access / retry' }));
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional retained input');
  expect(screen.getByLabelText('Shared role name')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Shared role name'), { target: { value: 'Fictional still typing' } });
  fireEvent.submit(screen.getByRole('form'));
  expect(mutations()).toHaveLength(0);
  intercept = () => undefined;
  await act(async () => pending.resolve(captured));
  await loaded();
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional still typing');
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeEnabled();
});

it.each(['role', 'employee'] as const)('detects a changed %s on expired-draft revalidation and requires cancellation before using the current row', async kind => {
  vi.useFakeTimers();
  render(manager()); await act(async () => {});
  expandEmployeeGroups();
  fireEvent.click(screen.getByRole('button', { name: kind === 'role' ? 'Edit shared role Fictional server' : 'Edit shared employee Fictional Avery' }));
  fireEvent.change(screen.getByLabelText(`Shared ${kind} name`), { target: { value: 'Fictional my unsaved edit' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
  const row = kind === 'role' ? tables.job_roles[0] : tables.employees[0];
  row.xmin = '1200'; row.name = 'Fictional other operator';
  fireEvent.click(screen.getByRole('button', { name: 'Revalidate draft' }));
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('record changed');
  expect(screen.getByLabelText(`Shared ${kind} name`)).toHaveValue('Fictional my unsaved edit');
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('form'));
  expect(mutations()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel draft' }));
  fireEvent.click(screen.getByRole('button', { name: `Edit shared ${kind === 'role' ? 'role' : 'employee'} Fictional other operator` }));
  expect(screen.getByLabelText(`Shared ${kind} name`)).toHaveValue('Fictional other operator');
  fireEvent.submit(screen.getByRole('form'));
  await act(async () => {});
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].url.searchParams.get('xmin')).toBe('eq.1200');
  expect(JSON.parse(String(mutations()[0].init.body)).name).toBe('Fictional other operator');
});

it.each(['changed-token', 'changed-value', 'removed-row'] as const)('background refresh detects %s without rebasing or losing the draft', async change => {
  render(manager()); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Edit shared employee Fictional Avery' }));
  fireEvent.change(screen.getByLabelText('Shared employee name'), { target: { value: 'Fictional local draft' } });
  if (change === 'changed-token') tables.employees[0].xmin = '999';
  if (change === 'changed-value') tables.employees[0].name = 'Fictional changed value';
  if (change === 'removed-row') tables.employees = [];
  fireEvent(window, new Event('focus'));
  await loaded();
  expect(screen.getByRole('alert')).toHaveTextContent('record changed');
  expect(screen.getByLabelText('Shared employee name')).toHaveValue('Fictional local draft');
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('form'));
  expect(mutations()).toHaveLength(0);
});

it('revalidates an unchanged update draft with fresh time bounds and retains xmin filtering', async () => {
  vi.useFakeTimers();
  render(manager()); await act(async () => {});
  expandEmployeeGroups();
  fireEvent.click(screen.getByRole('button', { name: 'Edit shared employee Fictional Avery' }));
  fireEvent.change(screen.getByLabelText('Shared employee name'), { target: { value: 'Fictional revalidated update' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  fireEvent.click(screen.getByRole('button', { name: 'Revalidate draft' }));
  await act(async () => {});
  fireEvent.submit(screen.getByRole('form'));
  await act(async () => {});
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].url.searchParams.get('xmin')).toBe('eq.703');
  expect(JSON.parse(String(mutations()[0].init.body))).toMatchObject({ name: 'Fictional revalidated update', default_weight_override: null });
});

it('preserves input if the snapshot expires during preflight verification before a timer can run', async () => {
  await openDraft('role');
  const identity = deferred<{ data: { user: Session['user'] }; error: null }>();
  auth.getUser.mockReturnValueOnce(identity.promise);
  const verified = auth.getUser.mock.calls.length;
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() => expect(auth.getUser.mock.calls.length).toBeGreaterThan(verified));
  const resumedAt = Date.now() + 60_001;
  vi.spyOn(Date, 'now').mockReturnValue(resumedAt);
  await act(async () => identity.resolve({ data: { user: session.user }, error: null }));
  expect(screen.getByRole('alert')).toHaveTextContent('snapshot expired');
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional retained input');
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeDisabled();
  expect(mutations()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Revalidate draft' }));
  await loaded();
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeEnabled();
});

it.each(['periodic', 'focus', 'revalidate'] as const)('clears protected input after %s detects revoked access', async event => {
  vi.useFakeTimers();
  await openDraft('role', true);
  tables.organization_memberships = [];
  if (event === 'periodic') await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  if (event === 'focus') { fireEvent(window, new Event('focus')); await act(async () => {}); }
  if (event === 'revalidate') { fireEvent.click(screen.getByRole('button', { name: 'Revalidate draft' })); await act(async () => {}); }
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByText('Fictional server · Active')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Fictional retained input')).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});

it.each(['SIGNED_IN', 'TOKEN_REFRESHED'] as const)('keeps editor and calculator drafts through verified same-user %s', async event => {
  const storageKey = accountRosterKey('https://fictional.example.test', userId);
  localStorage.setItem(storageKey, JSON.stringify([{ id: 'local', name: 'Fictional calculator', jobTitle: 'Local', weight: 100 }]));
  render(<AuthGate runtime={{ mode: 'configured', project: 'https://fictional.example.test', client }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage roster' }));
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
  fireEvent.change(screen.getByLabelText('Shared role name'), { target: { value: 'Fictional Auth draft' } });
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '50' } });
  const verified = auth.getUser.mock.calls.length;
  const refreshed = { ...session, access_token: 'fictional-refreshed' };
  auth.getSession.mockResolvedValue({ data: { session: refreshed }, error: null });
  act(() => emit(event, refreshed));
  await loaded();
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional Auth draft');
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('50');
  expect(localStorage.getItem(storageKey)).toContain('Fictional calculator');
  expect(auth.getUser.mock.calls.length).toBeGreaterThan(verified);
  expect(mutations()).toHaveLength(0);
});

it.each(['sign-out', 'account-switch'] as const)('hides drafts immediately on %s and ignores a delayed prior-account read', async event => {
  await openDraft('employee');
  const pending = deferred<Response>();
  let captured: Response | undefined;
  intercept = (table, url, init) => {
    if (table === 'job_roles' && !captured) { captured = query(table, url, init); return pending.promise; }
  };
  fireEvent.click(screen.getByRole('button', { name: 'Revalidate draft' }));
  await waitFor(() => expect(captured).toBeDefined());
  // Even stale getSession mocks must not resurrect the invalidated old scope.
  act(() => emit(event === 'sign-out' ? 'SIGNED_OUT' : 'SIGNED_IN', event === 'sign-out' ? null : { ...session, user: { ...session.user, id: id(99) } }));
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByText('Fictional Avery · Active')).not.toBeInTheDocument();
  const reads = requests.length;
  fireEvent(window, new Event('focus'));
  await act(async () => pending.resolve(captured!));
  expect(requests).toHaveLength(reads);
  expect(screen.queryByDisplayValue('Fictional retained input')).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});

it.each(['sign-out', 'account-switch'] as const)('hides an interrupted save warning on %s while retaining recovery for the returning original user', async event => {
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  render(manager()); await loaded(); await submitEmployee();
  const request = mutations()[0];
  act(() => emit(event === 'sign-out' ? 'SIGNED_OUT' : 'SIGNED_IN', event === 'sign-out' ? null : { ...session, user: { ...session.user, id: id(99) } }));
  expect(request.init.signal?.aborted).toBe(true);
  expect(screen.queryByText(/Save could not be confirmed|earlier save is still settling/)).not.toBeInTheDocument();
  expect(screen.queryByText('Fictional Avery · Active')).not.toBeInTheDocument();
  await act(async () => pending.resolve(query(request.table, request.url, request.init)));
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  expect(screen.queryByText('Save could not be confirmed', { exact: false })).not.toBeInTheDocument();
  act(() => emit('SIGNED_IN', session));
  await loaded();
  expect(screen.getByRole('alert')).toHaveTextContent('Save could not be confirmed');
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  await inspectAndAcknowledge();
  expect(mutations()).toHaveLength(1);
});

it('does not carry input to another restaurant and keeps the automatically selected restaurant when another membership is added', async () => {
  await openDraft('role', true);
  tables.organizations.push({ id: foreign, name: 'Fictional restaurant B' });
  tables.organization_memberships.push({ organization_id: foreign, user_id: userId, role: 'closer', is_active: true });
  fireEvent(window, new Event('focus'));
  await loaded();
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional retained input');
  expect(screen.getByLabelText('Restaurant')).toHaveValue(org);
  expect(screen.getByLabelText('Restaurant')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to calculator' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft and return' }));
  await userEvent.selectOptions(screen.getByLabelText('Restaurant'), foreign);
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(await screen.findByText('No shared employees.')).toBeVisible();
  expect(screen.queryByText('Fictional server · Active')).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});

it.each(['cancel', 'close', 'discard-reload'] as const)('discards input only when the user explicitly chooses %s', async action => {
  await openDraft('role', true);
  fireEvent.click(screen.getByRole('button', { name: action === 'cancel' ? 'Cancel draft' : action === 'close' ? 'Back to calculator' : 'Reload management / discard draft' }));
  if (action === 'close') {
    expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional retained input');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to calculator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft and return' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage roster' }));
  }
  await loaded();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
  expect(screen.getByLabelText('Shared role name')).toHaveValue('');
  expect(mutations()).toHaveLength(0);
});

it('preserves recovery when a parent periodic check interrupts a save, without duplicate requests', async () => {
  vi.useFakeTimers();
  render(<SharedRoster client={client} userId={userId} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Manage roster' }));
  await act(async () => {});
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
  fireEvent.change(screen.getByLabelText('Shared employee name'), { target: { value: 'Fictional periodic save' } });
  fireEvent.change(screen.getByLabelText('Default shared job role'), { target: { value: id(4) } });
  const form = screen.getByRole('form');
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  await act(async () => {});
  expect(mutations()).toHaveLength(1);
  const request = mutations()[0];
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(request.init.signal?.aborted).toBe(true);
  expect(screen.getByRole('region', { name: 'Manage shared roster · DEV' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('may have committed');
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  await act(async () => pending.resolve(query(request.table, request.url, request.init)));
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect current roster' }));
  await act(async () => {});
  expandEmployeeGroups();
  expect(screen.getByText('Fictional periodic save · Active')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'I inspected the roster; allow new edits' }));
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeEnabled();
  expect(mutations()).toHaveLength(1);
});

it.each(['role', 'employee'] as const)('clears the %s draft on a roster-only failure, retaining only freshly verified restaurant options', async kind => {
  await openDraft(kind, true);
  tables.organizations.push({ id: foreign, name: 'Fictional freshly verified B' });
  tables.organization_memberships.push({ organization_id: foreign, user_id: userId, role: 'closer', is_active: true });
  // The manager's exact-default read succeeds; only the parent's summary fails.
  intercept = (table, url) => table === 'employees' && !url.searchParams.get('select')!.includes('::text')
    ? response([], 200, 1001) : undefined;
  fireEvent(window, new Event('focus'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Management is unavailable and any unsaved draft was cleared');
  expect(screen.getByLabelText('Restaurant')).toHaveValue(org);
  expect(screen.getByRole('option', { name: 'Fictional freshly verified B' })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Manage shared roster · DEV' })).not.toBeInTheDocument();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByText('Fictional Avery · Active')).not.toBeInTheDocument();
  intercept = () => undefined;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh access / retry' }));
  await loaded();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: kind === 'role' ? 'Add role' : 'Add employee' }));
  expect(screen.getByLabelText(`Shared ${kind} name`)).toHaveValue('');
  expect(mutations()).toHaveLength(0);
});

it('ignores a delayed failed roster request after switching restaurants without restoring the old form', async () => {
  await openDraft('role', true);
  tables.organizations.push({ id: foreign, name: 'Fictional restaurant B' });
  tables.organization_memberships.push({ organization_id: foreign, user_id: userId, role: 'closer', is_active: true });
  const late = deferred<Response>();
  let oldSignal: AbortSignal | null | undefined;
  intercept = (table, url, init) => {
    if (table === 'employees' && url.searchParams.get('organization_id') === `eq.${org}` && !url.searchParams.get('select')!.includes('::text')) {
      oldSignal = init.signal;
      return late.promise;
    }
  };
  fireEvent(window, new Event('focus'));
  await screen.findByLabelText('Restaurant');
  await waitFor(() => expect(oldSignal).toBeDefined());
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional retained input');
  expect(screen.getByLabelText('Restaurant')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to calculator' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft and return' }));
  await userEvent.selectOptions(screen.getByLabelText('Restaurant'), foreign);
  expect(oldSignal?.aborted).toBe(true);
  expect(await screen.findByText('No shared employees.')).toBeVisible();
  await act(async () => late.resolve(response([], 500)));
  expect(screen.getByLabelText('Restaurant')).toHaveValue(foreign);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByText('Fictional server · Active')).not.toBeInTheDocument();
  intercept = () => undefined;
  await userEvent.selectOptions(screen.getByLabelText('Restaurant'), org);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage roster' }));
  fireEvent.click(await loaded());
  expect(screen.getByLabelText('Shared role name')).toHaveValue('');
  expect(mutations()).toHaveLength(0);
});

it('retains the interrupted-save lock after a roster-only failure and tenant switch until explicit inspection and acknowledgment', async () => {
  await openDraft('employee', true);
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  const form = screen.getByRole('form');
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  await waitFor(() => expect(mutations()).toHaveLength(1));
  const request = mutations()[0];
  tables.organizations.push({ id: foreign, name: 'Fictional restaurant B' });
  tables.organization_memberships.push({ organization_id: foreign, user_id: userId, role: 'closer', is_active: true });
  intercept = (table, url, init) => {
    if (init.method === 'POST') return pending.promise;
    if (table === 'employees' && url.searchParams.get('organization_id') === `eq.${org}` && !url.searchParams.get('select')!.includes('::text')) return response([], 500);
  };
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Management is unavailable'));
  expect(request.init.signal?.aborted).toBe(true);
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Restaurant'), foreign);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage roster' }));
  expect(await loaded()).toBeEnabled();
  expect(screen.queryByText(/may have committed/)).not.toBeInTheDocument();
  // Simulate the server committing after the new restaurant's read completed.
  await act(async () => pending.resolve(query(request.table, request.url, request.init)));
  expect(screen.queryByText('Fictional retained input · Active')).not.toBeInTheDocument();
  expect(screen.queryByText('Save confirmed. Shared roster refreshed.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to calculator' }));
  await userEvent.selectOptions(screen.getByLabelText('Restaurant'), org);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load shared data');
  intercept = () => undefined;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh access / retry' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Manage roster' }));
  expect(await screen.findByText(/may have committed/)).toBeVisible();
  expect(await loaded()).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'I inspected the roster; allow new edits' })).not.toBeInTheDocument();
  await inspectAndAcknowledge('Fictional retained input · Active');
  expect(mutations()).toHaveLength(1);
});

it('editing permanent defaults in management does not reload the frozen calculation; explicit reload still clears temporary changes', async () => {
  tables.employees[0].default_role_id = id(4);
  render(<AuthGate runtime={{ mode: 'configured', project: 'https://fictional.example.test', client }} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'Restaurant shared roster' }));
  const list = await screen.findByRole('group', { name: 'Participating employees' });
  fireEvent.click(within(list).getByRole('button', { name: /Fictional server/ }));
  fireEvent.click(within(list).getByRole('checkbox', { name: /Fictional Avery/ }));
  const weight = screen.getByLabelText('Temporary share weight · Fictional Avery');
  fireEvent.change(weight, { target: { value: '13.25' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Cash Tips ($)' }), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Manage roster' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit shared role Fictional server' }));
  fireEvent.change(screen.getByLabelText('Default share weight'), { target: { value: '200' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Edit shared job role' }));
  await screen.findByText('Save confirmed. Shared roster refreshed.');
  expandEmployeeGroups();
  fireEvent.click(screen.getByRole('button', { name: 'Back to calculator' }));
  expect(screen.getByLabelText('Temporary share weight · Fictional Avery')).toBe(weight);
  expect(weight).toHaveValue('13.25');
  expect(screen.getByText('Permanent default share weight: 100.50')).toBeVisible();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.00');
  expect(mutations()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Reload shared roster / clear selection' }));
  await waitFor(() => expect(screen.getByText('Verifying shared calculation access and loading exact defaults…')).not.toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: /Fictional server.*selected/ }));
  expect(screen.getByText('Permanent default share weight: 200.00')).toBeVisible();
  expect(screen.getByLabelText('Temporary share weight · Fictional Avery')).toHaveValue('200.00');
  expect(screen.getByRole('checkbox', { name: /Fictional Avery/ })).not.toBeChecked();
});

it.each(['local', 'shared'])('guards a %s management draft on Back and browser unload without saving', async source => {
  render(<AuthGate runtime={{ mode: 'configured', project: 'https://fictional.example.test', client }} />);
  await screen.findByRole('button', { name: 'Manage roster' });
  if (source === 'shared') fireEvent.click(screen.getByRole('radio', { name: 'Restaurant shared roster' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manage roster' }));
  fireEvent.click(await loaded());
  fireEvent.change(screen.getByLabelText('Shared role name'), { target: { value: 'Fictional retained' } });
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Back to calculator' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Discard the unsaved management draft');
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByLabelText('Shared role name')).toHaveValue('Fictional retained');
  fireEvent.click(screen.getByRole('button', { name: 'Back to calculator' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft and return' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manage roster' }));
  fireEvent.click(await loaded());
  expect(screen.getByLabelText('Shared role name')).toHaveValue('');
  expect(mutations()).toHaveLength(0);
});

it('allows return after an uncertain save settles and retains the recovery lock on reentry without replaying a write', async () => {
  await openDraft('role', true);
  const pending = deferred<Response>();
  intercept = (_table, _url, init) => init.method === 'POST' ? pending.promise : undefined;
  fireEvent.submit(screen.getByRole('form', { name: 'Add shared job role' }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  expect(screen.getByRole('button', { name: 'Back to calculator' })).toBeDisabled();
  await act(async () => pending.reject(new TypeError('fictional network failure')));
  await screen.findByText(/Save could not be confirmed/);
  expect(screen.getByRole('button', { name: 'Back to calculator' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to calculator' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manage roster' }));
  await screen.findByText(/Save could not be confirmed/);
  expect(await loaded()).toBeDisabled();
  expect(mutations()).toHaveLength(1);
});

function largeManagementRoster() {
  const names = ['Zulu service', 'Bar', 'Kitchen', 'Dining', 'Hosts'];
  tables.job_roles = names.map((name, index) => ({ id: id(20 + index), organization_id: org, name, is_active: index !== 2, default_weight: `${index + 1}.25`, xmin: String(800 + index) }));
  tables.employees = Array.from({ length: 49 }, (_, index) => ({
    id: id(1000 + index), organization_id: org,
    name: index === 0 || index === 5 || index === 1 ? 'Fictional Duplicate' : `Fictional Employee ${String(49 - index).padStart(2, '0')}`,
    is_active: index % 4 !== 0, default_role_id: id(20 + index % 5), default_weight_override: index === 0 ? '0.00' : null, xmin: String(900 + index),
  })).reverse();
}
const employeeSection = () => screen.getByRole('region', { name: 'Employees' });
const roleSection = () => screen.getByRole('region', { name: 'Job roles' });
const employeeGroup = (roleName: string) => within(employeeSection()).getByRole('region', { name: `Employees in ${roleName}` });
const groupToggle = (roleName: string) => within(employeeGroup(roleName)).getByRole('button', { name: new RegExp(`^${roleName}`) });
const employeeEdit = (row: Row) => within(employeeSection()).getByRole('button', { name: new RegExp(`^Edit shared employee ${row.name}.*${row.id}`) });

it('organizes 49 employees into initially collapsed alphabetic role groups with counts, stable duplicate IDs and visible inactive statuses', async () => {
  largeManagementRoster();
  const originalRoles = tables.job_roles.map(row => row.name);
  const originalEmployees = tables.employees.map(row => row.id);
  render(manager()); await loaded(false);
  const roles = [...tables.job_roles].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  expect(within(roleSection()).getByRole('heading', { name: 'Job roles' })).toBeVisible();
  expect(within(employeeSection()).getByRole('heading', { name: 'Employees' })).toBeVisible();
  expect(within(roleSection()).getByRole('button', { name: 'Add role' })).toHaveClass('min-h-12', 'w-full');
  expect(within(employeeSection()).getByRole('button', { name: 'Add employee' })).toHaveClass('min-h-12', 'w-full');
  expect(within(roleSection()).getAllByRole('listitem').map(row => row.querySelector('p')!.textContent)).toEqual(roles.map(row => `${row.name} · ${row.is_active ? 'Active' : 'Inactive'}`));
  for (const role of roles) {
    expect(within(roleSection()).getByText(`Default share weight: ${role.default_weight}`)).toBeVisible();
    expect(within(roleSection()).getByRole('button', { name: `Edit shared role ${role.name}` })).toBeEnabled();
  }
  const toggles = within(employeeSection()).getAllByRole('button', { expanded: false });
  expect(toggles).toHaveLength(5);
  expect(toggles.map(toggle => toggle.textContent)).toEqual(roles.map(role => `▸${role.name}${role.is_active ? '' : ' · Inactive role'}${tables.employees.filter(row => row.default_role_id === role.id).length} employees`));
  expect(within(employeeSection()).queryByRole('listitem')).not.toBeInTheDocument();
  expect(within(employeeSection()).queryByRole('button', { name: /Edit shared employee/ })).not.toBeInTheDocument();
  fireEvent.click(groupToggle('Bar'));
  expect(groupToggle('Bar')).toHaveAttribute('aria-expanded', 'true');
  expect(groupToggle('Zulu service')).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(groupToggle('Zulu service'));
  fireEvent.click(groupToggle('Bar'));
  expect(groupToggle('Zulu service')).toHaveAttribute('aria-expanded', 'true');
  expect(groupToggle('Bar')).toHaveAttribute('aria-expanded', 'false');
  expandEmployeeGroups();
  for (const role of roles) {
    const expected = tables.employees.filter(row => row.default_role_id === role.id).sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
    expect(within(employeeGroup(String(role.name))).getAllByRole('listitem').map(row => row.querySelector('p')!.textContent)).toEqual(expected.map(row => `${row.name} · ${row.is_active ? 'Active' : 'Inactive'}`));
  }
  const duplicates = tables.employees.filter(row => row.name === 'Fictional Duplicate');
  expect(new Set(duplicates.map(row => employeeEdit(row).getAttribute('aria-label'))).size).toBe(3);
  for (const row of duplicates) expect(within(employeeSection()).getByText(`Employee ID: ${row.id}`)).toBeVisible();
  expect(tables.job_roles.map(row => row.name)).toEqual(originalRoles);
  expect(tables.employees.map(row => row.id)).toEqual(originalEmployees);
  expect(mutations()).toHaveLength(0);
});

it.each(['role', 'employee'] as const)('places the add %s form immediately beneath its button, focuses it and keeps only one draft', async kind => {
  largeManagementRoster(); render(manager()); await loaded(false);
  const add = screen.getByRole('button', { name: kind === 'role' ? 'Add role' : 'Add employee' });
  add.focus(); await userEvent.keyboard('{Enter}');
  const form = screen.getByRole('form', { name: kind === 'role' ? 'Add shared job role' : 'Add shared employee' });
  expect(add.nextElementSibling).toContainElement(form);
  expect(screen.getByLabelText(`Shared ${kind} name`)).toHaveFocus();
  fireEvent.change(screen.getByLabelText(`Shared ${kind} name`), { target: { value: 'Fictional protected inline draft' } });
  const otherAdd = screen.getByRole('button', { name: kind === 'role' ? 'Add employee' : 'Add role' });
  expect(otherAdd).toBeDisabled(); fireEvent.click(otherAdd);
  expandEmployeeGroups();
  expect(screen.getAllByRole('form')).toHaveLength(1);
  expect(screen.getByLabelText(`Shared ${kind} name`)).toHaveValue('Fictional protected inline draft');
  expect(screen.getAllByRole('button', { name: /^Edit shared/ }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel draft' }));
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(otherAdd).toBeEnabled();
  expect(mutations()).toHaveLength(0);
});

it('places a role edit under its own row, retains the same form during checks, and resorts a confirmed rename', async () => {
  largeManagementRoster(); render(manager()); await loaded(false);
  const edit = screen.getByRole('button', { name: 'Edit shared role Zulu service' });
  const row = edit.closest('li')!;
  fireEvent.click(edit);
  const form = screen.getByRole('form', { name: 'Edit shared job role' });
  expect(row).toContainElement(form);
  expect(edit.parentElement!.nextElementSibling).toContainElement(form);
  const input = screen.getByLabelText('Shared role name'); expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'Aardvark service' } });
  fireEvent.change(screen.getByLabelText('Default share weight'), { target: { value: '0.01' } });
  fireEvent(window, new Event('focus')); await loaded(false);
  expect(screen.getByRole('form', { name: 'Edit shared job role' })).toBe(form);
  expect(input).toHaveValue('Aardvark service');
  fireEvent.submit(form);
  await screen.findByText('Save confirmed. Shared roster refreshed.');
  expect(within(roleSection()).getAllByRole('listitem')[0]).toHaveTextContent('Aardvark service · Active');
  expect(within(roleSection()).getAllByRole('listitem')[0]).toHaveTextContent('Default share weight: 0.01');
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].url.searchParams.get('xmin')).toBe('eq.800');
  expect(JSON.parse(String(mutations()[0].init.body))).toMatchObject({ name: 'Aardvark service', default_weight: '0.01' });
});

it('keeps an employee editor directly under the correct duplicate row, locks only its group, and moves a confirmed reassignment after refresh', async () => {
  largeManagementRoster(); render(manager()); await loaded(false);
  fireEvent.click(groupToggle('Zulu service'));
  const employee = tables.employees.find(row => row.id === id(1000))!;
  const edit = employeeEdit(employee), row = edit.closest('li')!;
  fireEvent.click(edit);
  const form = screen.getByRole('form', { name: 'Edit shared employee' });
  const name = screen.getByLabelText('Shared employee name');
  expect(name).toHaveFocus();
  expect(row).toContainElement(form);
  expect(edit.parentElement!.nextElementSibling).toContainElement(form);
  expect(employeeGroup('Zulu service')).toContainElement(form);
  fireEvent.change(name, { target: { value: 'Fictional Reassigned' } });
  expect(groupToggle('Zulu service')).toBeDisabled();
  fireEvent.click(groupToggle('Zulu service'));
  expect(form).toBeVisible();
  groupToggle('Bar').focus(); await userEvent.keyboard('{Enter}');
  expect(groupToggle('Bar')).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(groupToggle('Bar'));
  expect(groupToggle('Bar')).toHaveAttribute('aria-expanded', 'false');
  expect(name).toHaveValue('Fictional Reassigned');
  expect(screen.getAllByRole('form')).toHaveLength(1);
  expect(screen.getByRole('option', { name: /Kitchen/ })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Default shared job role'), { target: { value: id(21) } });
  fireEvent(window, new Event('focus')); await loaded(false);
  expect(screen.getByRole('form', { name: 'Edit shared employee' })).toBe(form);
  expect(name).toHaveValue('Fictional Reassigned');
  fireEvent.submit(form);
  await screen.findByText('Save confirmed. Shared roster refreshed.');
  expect(groupToggle('Bar')).toHaveAttribute('aria-expanded', 'true');
  expect(within(employeeGroup('Bar')).getByText('Fictional Reassigned · Inactive')).toBeVisible();
  expect(within(employeeGroup('Bar')).getByText('Effective default share weight: 0.00 · Explicit zero override')).toBeVisible();
  expect(within(employeeGroup('Zulu service')).queryByText('Fictional Reassigned · Inactive')).not.toBeInTheDocument();
  expect(groupToggle('Bar')).toHaveTextContent('11 employees');
  expect(groupToggle('Zulu service')).toHaveTextContent('9 employees');
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].url.searchParams.get('id')).toBe(`eq.${employee.id}`);
  expect(mutations()[0].url.searchParams.get('xmin')).toBe('eq.900');
  expect(JSON.parse(String(mutations()[0].init.body))).toMatchObject({ default_role_id: id(21), default_weight_override: '0.00', is_active: false });
});

it.each(['reassigned', 'removed'] as const)('keeps the same inline employee draft mounted when a background check finds its record %s', async change => {
  largeManagementRoster(); render(manager()); await loaded(false);
  fireEvent.click(groupToggle('Zulu service'));
  const employee = tables.employees.find(row => row.id === id(1000))!;
  fireEvent.click(employeeEdit(employee));
  const form = screen.getByRole('form', { name: 'Edit shared employee' });
  fireEvent.change(screen.getByLabelText('Shared employee name'), { target: { value: 'Fictional conflict draft' } });
  if (change === 'reassigned') Object.assign(employee, { default_role_id: id(21), xmin: '9999' });
  else tables.employees = tables.employees.filter(row => row.id !== employee.id);
  fireEvent(window, new Event('focus')); await loaded(false);
  expect(screen.getByRole('alert')).toHaveTextContent('record changed');
  expect(screen.getByRole('form', { name: 'Edit shared employee' })).toBe(form);
  expect(employeeGroup('Zulu service')).toContainElement(form);
  expect(screen.getByLabelText('Shared employee name')).toHaveValue('Fictional conflict draft');
  expect(screen.getByRole('button', { name: 'Save shared roster' })).toBeDisabled();
  fireEvent.submit(form);
  expect(mutations()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel draft' }));
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(groupToggle('Zulu service')).toBeEnabled();
});
