// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import AuthGate from './AuthGate';
import SharedRoster from './SharedRoster';
import SharedCalculation from './SharedCalculation';
import { calculationEmployeeProjection, calculationRoleProjection, loadCalculationRoster } from './sharedCalculationData';
import { accountRosterKey } from './supabase';
import { distributeTips } from './calculation';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const userId = id(1), org = id(2), otherOrg = id(3), otherUser = id(9);
const project = 'https://fictional.example.test';
const restaurant = { id: org, name: 'Fictional Juniper' };
const membership = (organization_id = org, user_id = userId) => ({ organization_id, user_id, role: 'closer', is_active: true });
const role = (organization_id = org) => ({ id: organization_id === org ? id(4) : id(14), organization_id, name: 'Fictional server', is_active: true, default_weight: '100' });
const employee = (organization_id = org) => ({ id: organization_id === org ? id(6) : id(16), organization_id, name: organization_id === org ? 'Fictional Avery' : 'Fictional Blair', is_active: true, default_role_id: role(organization_id).id, default_weight_override: null });
type Table = 'job_roles' | 'employees' | 'organization_memberships' | 'organizations';
type Row = Record<string, unknown>;
type Request = { table: Table; url: URL; init: RequestInit };
let tables: Record<Table, Row[]>;
let requests: Request[];
let intercept: (request: Request) => Response | Promise<Response> | undefined;
let client: SupabaseClient;
let session: Session | null;
let listeners: Set<(event: AuthChangeEvent, candidate: Session | null) => void>;

function response(rows: unknown[], count = rows.length) {
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': rows.length ? `0-${rows.length - 1}/${count}` : `*/${count}` } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function query({ table, url }: Request) {
  const rows = tables[table].filter(row => [...url.searchParams].every(([key, value]) => {
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]));
    return true;
  }));
  const fields = url.searchParams.get('select')!.split(',').map(column => column.replace('::text', ''));
  return response(rows.map(row => Object.fromEntries(fields.map(field => [field, row[field]]))));
}
function makeClient(origin = project) {
  const sdk = createClient(origin, 'sb_publishable_fictional_placeholder', {
    accessToken: async () => 'fictional-session', auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1) as Table;
      expect(init.method ?? 'GET').toBe('GET');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fictional-session');
      expect(new Headers(init.headers).get('Prefer')).toBe('count=exact');
      const request = { table, url, init };
      requests.push(request);
      return await (intercept(request) ?? query(request));
    } },
  });
  return { from: sdk.from.bind(sdk), auth: {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: session?.user }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(callback => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    }),
  } } as unknown as SupabaseClient;
}
const load = (organizationId = org, signal = new AbortController().signal) => loadCalculationRoster(client, userId, organizationId, signal);
const panel = (overrides = {}) => <SharedCalculation client={client} userId={userId} organizationId={org} restaurantName={restaurant.name} accessRevision={0} accessPending={false} {...overrides} />;
const participating = () => screen.getByRole('group', { name: 'Participating employees' });
async function loaded() { return screen.findByRole('group', { name: 'Participating employees' }); }
const choose = (name = 'Fictional Avery') => fireEvent.click(within(participating()).getByRole('checkbox', { name: new RegExp(name) }));
const weightInput = (name = 'Fictional Avery') => screen.getByRole('textbox', { name: `Temporary share weight · ${name}` });
const editWeight = (value: string, name = 'Fictional Avery') => fireEvent.change(weightInput(name), { target: { value } });
const reload = () => fireEvent.click(screen.getByRole('button', { name: 'Reload shared roster / clear selection' }));
const exactReads = () => requests.filter(request => request.url.searchParams.get('select') === calculationEmployeeProjection);
function emit(event: AuthChangeEvent, candidate: Session | null) { session = candidate; listeners.forEach(callback => callback(event, candidate)); }

function addTemporary(name = 'Fictional Guest', weight = '50', jobTitle = 'Fictional visiting server') {
  fireEvent.change(screen.getByLabelText('Temporary participant name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Job title / role label'), { target: { value: jobTitle } });
  fireEvent.change(screen.getByLabelText('Initial share weight'), { target: { value: weight } });
  fireEvent.submit(screen.getByRole('form', { name: 'Add temporary participant' }));
}
const temporaryRow = (name = 'Fictional Guest') => screen.getByRole('group', { name: `Temporary participant ${name}` });
const removeTemporary = (name = 'Fictional Guest') => fireEvent.click(within(temporaryRow(name)).getByRole('button', { name: `Remove temporary participant ${name}` }));

beforeEach(() => {
  tables = { organizations: [restaurant], organization_memberships: [membership()], job_roles: [role()], employees: [employee()] };
  requests = [];
  intercept = () => undefined;
  listeners = new Set();
  session = { user: { id: userId, email: 'fictional@example.test' }, access_token: 'fictional-session', expires_at: Date.now() / 1000 + 3600 } as Session;
  client = makeClient();
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

it.each(['admin', 'closer'])('loads an authorized %s roster through exact, bounded, tenant-filtered GETs', async roleName => {
  tables.organization_memberships[0].role = roleName;
  const participants = await load();
  expect(participants).toEqual([{ id: id(6), name: 'Fictional Avery', jobTitle: 'Fictional server', weightText: '100', weightUnits: 10000, eligible: true, exclusion: undefined }]);
  expect(requests.map(request => request.table)).toEqual(['organization_memberships', 'job_roles', 'employees', 'organization_memberships']);
  for (const { table, url, init } of requests) {
    expect(url.searchParams.get('organization_id')).toBe(`eq.${org}`);
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('limit')).toBe('1000');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (table === 'job_roles') expect(url.searchParams.get('select')).toBe(calculationRoleProjection);
    if (table === 'employees') expect(url.searchParams.get('select')).toBe(calculationEmployeeProjection);
    if (table === 'organization_memberships') {
      expect(url.searchParams.get('user_id')).toBe(`eq.${userId}`);
      expect(url.searchParams.get('is_active')).toBe('eq.true');
    }
  }
  expect(client.auth.getUser).toHaveBeenCalledTimes(2);
});

it.each(['foreign', 'revoked', 'nonmember', 'bad-role', 'wrong-identity', 'expired'])('rejects %s access before any roster reads', async kind => {
  if (kind === 'foreign') tables.organization_memberships = [membership(otherOrg)];
  if (kind === 'revoked') tables.organization_memberships[0].is_active = false;
  if (kind === 'nonmember') tables.organization_memberships = [];
  if (kind === 'bad-role') tables.organization_memberships[0].role = 'owner';
  if (kind === 'wrong-identity') vi.mocked(client.auth.getUser).mockResolvedValue({ data: { user: { id: otherUser } }, error: null } as never);
  if (kind === 'expired') session!.expires_at = Date.now() / 1000 - 1;
  await expect(load()).rejects.toThrow();
  expect(requests.every(request => request.table === 'organization_memberships')).toBe(true);
});

it('rejects membership revocation or account changes during a read, including empty RLS results', async () => {
  intercept = request => {
    if (request.table === 'employees') { tables.organization_memberships = []; return response([]); }
  };
  await expect(load()).rejects.toThrow();
  expect(requests.filter(request => request.table === 'organization_memberships')).toHaveLength(2);
  tables.organization_memberships = [membership()];
  intercept = request => {
    if (request.table === 'employees') session = { ...session!, user: { ...session!.user, id: otherUser } };
    return undefined;
  };
  await expect(load()).rejects.toThrow();
});

it('inherits NULL but retains explicit zero and the exact safe-integer maximum', async () => {
  tables.job_roles[0].default_weight = '90071992547409.91';
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional Zero', default_weight_override: '0' });
  const participants = await load();
  expect(participants.map(row => row.weightUnits)).toEqual([Number.MAX_SAFE_INTEGER, 0]);
  expect(participants[0].weightText).toBe('90071992547409.91');
  expect(distributeTips(10001, participants).payouts.map(row => row.cents)).toEqual([10001, 0]);
  tables.employees[1].default_weight_override = '0.01';
  const overflowing = await load();
  expect(() => distributeTips(10001, overflowing)).toThrow(/safe integer/);
});

it.each([90071992547409.91, '90071992547409.92', '-1', '1e2', '0.001', '100.000', undefined])('rejects unsafe/non-text/malformed shared weight %s', async value => {
  tables.job_roles[0].default_weight = value;
  await expect(load()).rejects.toThrow(/complete shared calculation roster/);
});

it.each(['partial', 'missing-count', 'server', 'denied', 'duplicate', 'foreign-row', 'missing-role', 'invalid-override', 'oversized'])('rejects %s roster responses rather than showing an incomplete snapshot', async kind => {
  intercept = request => {
    if (request.table !== 'employees') return undefined;
    if (kind === 'partial') return response([employee()], 2);
    if (kind === 'missing-count') return Response.json([employee()]);
    if (kind === 'server') return new Response('{}', { status: 500 });
    if (kind === 'denied') return new Response('{"code":"42501"}', { status: 403 });
    if (kind === 'duplicate') return response([employee(), employee()]);
    if (kind === 'foreign-row') return response([employee(otherOrg)]);
    if (kind === 'missing-role') return response([{ ...employee(), default_role_id: id(88) }]);
    if (kind === 'invalid-override') return response([{ ...employee(), default_weight_override: 0 }]);
    return response([employee()], 1001);
  };
  await expect(load()).rejects.toThrow();
});

it('aborts an in-flight exact read without accepting the late response', async () => {
  const late = deferred<Response>(), controller = new AbortController();
  intercept = request => request.table === 'employees' ? late.promise : undefined;
  const result = load(org, controller.signal);
  const rejected = expect(result).rejects.toThrow();
  await waitFor(() => expect(exactReads()).toHaveLength(1));
  controller.abort();
  late.resolve(response([employee()]));
  await rejected;
});

it('starts with no selection; selecting and deselecting uses unchanged cent and dollar previews', async () => {
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional Casey', default_weight_override: '50' });
  render(panel());
  await loaded();
  expect(screen.getByText('0 participants selected for this preview.')).toBeVisible();
  expect(within(participating()).getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true);
  choose(); choose('Fictional Casey');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '40.01' } });
  fireEvent.change(screen.getByLabelText('Credit Tips ($)'), { target: { value: '59.99' } });
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$66.66');
  expect(screen.getByRole('group', { name: 'Employee Fictional Casey' })).toHaveTextContent('$33.33');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$0.01');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Round down to whole dollar' }));
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$66.00');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$1.00');
  choose('Fictional Casey');
  expect(screen.queryByRole('group', { name: 'Employee Fictional Casey' })).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.00');
  expect(screen.queryByRole('button', { name: /Add to Roster|Remove/ })).not.toBeInTheDocument();
});

it('displays inactive records and zero defaults, with only active employee/role pairs selectable', async () => {
  tables.job_roles.push({ ...role(), id: id(5), name: 'Fictional retired role', is_active: false });
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional inactive employee', is_active: false },
    { ...employee(), id: id(8), name: 'Fictional inactive role', default_role_id: id(5) });
  tables.employees[0].default_weight_override = '0';
  render(panel());
  await loaded();
  const boxes = within(participating()).getAllByRole('checkbox');
  expect(boxes[0]).toBeEnabled(); expect(boxes[1]).toBeDisabled(); expect(boxes[2]).toBeDisabled();
  expect(screen.getByText(/Inactive employee — excluded/)).toBeVisible();
  expect(screen.getByText(/Inactive role — excluded/)).toBeVisible();
  choose();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('Share weight: 0');
});

it('accepts an authorized empty roster with a visible status and no participants', async () => {
  tables.job_roles = []; tables.employees = [];
  render(panel());
  expect(await screen.findByText('No shared employees to select.')).toBeVisible();
  expect(screen.getByText('No participants selected.')).toBeVisible();
  expect(requests.filter(request => request.table === 'organization_memberships')).toHaveLength(2);
});

it('keeps defaults/selection during access checks and only explicitly reloads them without duplicates', async () => {
  const view = render(panel());
  await loaded(); choose();
  editWeight('75.25');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  tables.employees[0].default_weight_override = '50';
  view.rerender(panel({ accessRevision: 1, accessPending: true }));
  expect(participating()).toBeVisible();
  expect(participating().closest('[inert]')).not.toBeNull();
  await act(async () => {});
  view.rerender(panel({ accessRevision: 1, accessPending: false }));
  await loaded();
  expect(within(participating()).getByRole('checkbox')).toBeChecked();
  expect(screen.getByText('Permanent default share weight: 100')).toBeVisible();
  expect(weightInput()).toHaveValue('75.25');
  expect(exactReads()).toHaveLength(1);
  for (let i = 0; i < 2; i++) {
    reload(); await loaded();
    expect(within(participating()).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Permanent default share weight: 50')).toBeVisible();
    expect(weightInput()).toHaveValue('50');
    expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('100');
  }
  expect(exactReads()).toHaveLength(3);
});

it.each(['failed', 'partial', 'revoked'])('clears the previous preview and fails visibly on %s reload/check', async kind => {
  const view = render(panel());
  await loaded(); choose();
  editWeight('13.25');
  if (kind === 'revoked') { tables.organization_memberships = []; view.rerender(panel({ accessRevision: 1 })); }
  else {
    intercept = request => request.table === 'employees' ? kind === 'partial' ? response([employee()], 2) : new Response('{}', { status: 500 }) : undefined;
    reload();
  }
  expect(await screen.findByRole('alert')).toHaveTextContent('previous preview was cleared');
  expect(screen.queryByText('Fictional Avery · Fictional server')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Employee Fictional Avery' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Tip Calculator Dashboard' })).not.toBeInTheDocument();
});

it.each(['account', 'project', 'restaurant'])('rejects late exact reads after a %s prop switch', async kind => {
  const late = deferred<Response>();
  intercept = request => request.table === 'employees' && request.url.origin === project && request.url.searchParams.get('organization_id') === `eq.${org}` ? late.promise : undefined;
  const view = render(panel());
  await waitFor(() => expect(exactReads()).toHaveLength(1));
  const firstSignal = exactReads()[0].init.signal!;
  tables.employees[0].name = 'Fictional new scope';
  let overrides = {};
  if (kind === 'account') {
    session = { ...session!, user: { ...session!.user, id: otherUser } };
    tables.organization_memberships = [membership(org, otherUser)]; overrides = { userId: otherUser };
  }
  if (kind === 'project') overrides = { client: makeClient('https://other-fictional.example.test') };
  if (kind === 'restaurant') {
    tables.organization_memberships.push(membership(otherOrg)); tables.job_roles.push(role(otherOrg)); tables.employees.push(employee(otherOrg));
    overrides = { organizationId: otherOrg, restaurantName: 'Fictional Moonbeam' };
  }
  intercept = () => undefined;
  view.rerender(panel(overrides));
  await loaded();
  expect(firstSignal.aborted).toBe(true);
  await act(async () => late.resolve(response([employee()])));
  expect(screen.queryByText(/Fictional Avery/)).not.toBeInTheDocument();
  expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
});

it.each(['SIGNED_OUT', 'SIGNED_IN'] as const)('invalidates in-flight reads on %s Auth events without late resurrection', async event => {
  const late = deferred<Response>();
  intercept = request => request.table === 'employees' ? late.promise : undefined;
  render(panel());
  await waitFor(() => expect(exactReads()).toHaveLength(1));
  act(() => emit(event, event === 'SIGNED_OUT' ? null : { ...session!, user: { ...session!.user, id: otherUser } }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed');
  await act(async () => late.resolve(response([employee()])));
  expect(screen.queryByText(/Fictional Avery/)).not.toBeInTheDocument();
  expect(exactReads()[0].init.signal!.aborted).toBe(true);
});

it('rechecks same-user token refresh without reloading shared defaults or losing selections', async () => {
  render(panel()); await loaded(); choose();
  editWeight('75.25');
  act(() => emit('TOKEN_REFRESHED', { ...session!, access_token: 'fictional-new-session' }));
  await loaded();
  expect(within(participating()).getByRole('checkbox')).toBeChecked();
  expect(exactReads()).toHaveLength(1);
  expect(weightInput()).toHaveValue('75.25');
});

it('reuses the authorized restaurant selector and clears selected A before loading B', async () => {
  tables.organizations.push({ id: otherOrg, name: 'Fictional Moonbeam' });
  tables.organization_memberships.push(membership(otherOrg)); tables.job_roles.push(role(otherOrg)); tables.employees.push(employee(otherOrg));
  render(<SharedRoster client={client} userId={userId} calculationMode />);
  const selector = await screen.findByLabelText('Restaurant');
  expect(exactReads()).toHaveLength(0);
  fireEvent.change(selector, { target: { value: org } });
  await loaded(); choose();
  editWeight('13.25');
  fireEvent.change(screen.getByLabelText('Restaurant'), { target: { value: otherOrg } });
  expect(screen.queryByText(/Fictional Avery/)).not.toBeInTheDocument();
  await loaded();
  expect(screen.getByRole('heading', { name: 'Restaurant shared roster · Fictional Moonbeam' })).toBeVisible();
  expect(within(participating()).getByRole('checkbox', { name: /Fictional Blair/ })).not.toBeChecked();
  expect(weightInput('Fictional Blair')).toHaveValue('100');
});

it('preserves the browser-local roster, inputs and storage through explicit source switching', async () => {
  const saved = JSON.stringify([{ id: 'local', name: 'Fictional Local', jobTitle: 'Local server', weight: 100 }]);
  localStorage.setItem(accountRosterKey(project, userId), saved);
  localStorage.setItem('employees', 'legacy untouched');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const read = vi.spyOn(Storage.prototype, 'getItem');
  render(<AuthGate runtime={{ mode: 'configured', project, client }} />);
  await screen.findByRole('heading', { name: 'Tip Calculator Dashboard' });
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '42.50' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Restaurant shared roster' }));
  await loaded(); choose();
  editWeight('13.25');
  addTemporary();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Employee Fictional Local' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Browser-local roster' }));
  expect(screen.getByRole('group', { name: 'Employee Fictional Local' })).toHaveTextContent('$42.50');
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('42.50');
  fireEvent.click(screen.getByRole('radio', { name: 'Restaurant shared roster' }));
  await loaded();
  expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
  expect(weightInput()).toHaveValue('100');
  expect(screen.queryByRole('group', { name: 'Temporary participant Fictional Guest' })).not.toBeInTheDocument();
  expect(read.mock.calls.every(([key]) => key === accountRosterKey(project, userId))).toBe(true);
  expect(write).not.toHaveBeenCalled();
  expect(localStorage.getItem(accountRosterKey(project, userId))).toBe(saved);
  expect(localStorage.getItem('employees')).toBe('legacy untouched');
});

it('provides labelled mobile controls, keyboard selection, decimal inputs and announced states', async () => {
  const late = deferred<Response>();
  intercept = request => request.table === 'employees' ? late.promise : undefined;
  render(panel());
  expect(screen.getByRole('status')).toHaveTextContent('Verifying shared calculation access');
  await waitFor(() => expect(exactReads()).toHaveLength(1));
  await act(async () => late.resolve(response([employee()])));
  await loaded();
  const checkbox = within(participating()).getByRole('checkbox');
  checkbox.focus(); await userEvent.keyboard(' ');
  expect(checkbox).toBeChecked();
  expect(screen.getByText('1 participants selected for this preview.')).toHaveAttribute('role', 'status');
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveAttribute('inputmode', 'decimal');
  expect(screen.getByLabelText('Credit Tips ($)')).toHaveAttribute('inputmode', 'decimal');
  expect(checkbox.closest('label')).toHaveClass('min-h-12');
  expect(screen.getByText(/Selection does not edit permanent defaults/)).toBeVisible();
});


it('checks focus, reconnect and the minute timer without silently reloading a running snapshot', async () => {
  vi.useFakeTimers();
  render(<SharedRoster client={client} userId={userId} calculationMode />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  choose();
  editWeight('75.25');
  tables.job_roles[0].default_weight = '50';
  for (const event of ['focus', 'online']) {
    const before = requests.filter(request => request.table === 'organization_memberships').length;
    await act(async () => { window.dispatchEvent(new Event(event)); await vi.advanceTimersByTimeAsync(0); });
    expect(requests.filter(request => request.table === 'organization_memberships').length).toBeGreaterThan(before);
    expect(within(participating()).getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('Permanent default share weight: 100')).toBeVisible();
    expect(weightInput()).toHaveValue('75.25');
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(within(participating()).getByRole('checkbox')).toBeChecked();
  expect(exactReads()).toHaveLength(1);
  expect(weightInput()).toHaveValue('75.25');
  tables.organization_memberships = [];
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.queryByText(/Fictional Avery/)).not.toBeInTheDocument();
  expect(screen.getByText('No restaurant access assigned')).toBeVisible();
});

it('allows recovery from a failed reload only through a fresh complete snapshot with no selected IDs', async () => {
  render(panel()); await loaded(); choose();
  intercept = request => request.table === 'employees' ? response([employee()], 2) : undefined;
  reload();
  await screen.findByRole('alert');
  intercept = () => undefined;
  reload(); await loaded();
  expect(within(participating()).getAllByRole('checkbox')).toHaveLength(1);
  expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('cancels an earlier reload when a repeated load finishes first, with no stale overwrite', async () => {
  render(panel()); await loaded(); choose();
  const late = deferred<Response>();
  intercept = request => request.table === 'employees' ? late.promise : undefined;
  reload();
  await waitFor(() => expect(exactReads()).toHaveLength(2));
  intercept = () => undefined;
  tables.employees[0].name = 'Fictional refreshed employee';
  reload(); await loaded();
  expect(exactReads()[1].init.signal!.aborted).toBe(true);
  await act(async () => late.resolve(response([employee()])));
  expect(screen.queryByText(/Fictional Avery/)).not.toBeInTheDocument();
  expect(within(participating()).getByRole('checkbox', { name: /Fictional refreshed employee/ })).not.toBeChecked();
});

it('shows total weight overflow visibly and preserves the exact maximum text in the UI', async () => {
  tables.job_roles[0].default_weight = '90071992547409.91';
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional extra', default_weight_override: '0.01' });
  render(panel()); await loaded();
  expect(screen.getByText('Permanent default share weight: 90071992547409.91')).toBeVisible();
  choose();
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100.01' } });
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.01');
  choose('Fictional extra');
  expect(screen.getByRole('alert')).toHaveTextContent('Total weight units exceeds the safe integer range');
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  choose('Fictional extra');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('initializes decimal text inputs from inherited and explicit-zero defaults and requires selection to edit', async () => {
  tables.job_roles[0].default_weight = '100.50';
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional Zero', default_weight_override: '0' });
  render(panel()); await loaded();
  expect(weightInput()).toHaveValue('100.50');
  expect(weightInput()).toBeDisabled();
  expect(weightInput('Fictional Zero')).toHaveValue('0');
  expect(screen.getByText('Permanent default share weight: 100.50')).toBeVisible();
  expect(screen.getByText('Permanent default share weight: 0')).toBeVisible();
  choose(); choose('Fictional Zero');
  expect(weightInput()).toBeEnabled();
  expect(weightInput()).toHaveAttribute('inputmode', 'decimal');
  expect(weightInput()).toHaveAttribute('type', 'text');
  expect(weightInput()).toHaveClass('min-h-12');
  expect(screen.getByRole('button', { name: 'Reset Fictional Avery to default' })).toHaveClass('min-h-12');
  expect(screen.getByText(/Temporary share weights are relative shares, not tip percentages/)).toBeVisible();
  editWeight('1'); editWeight('25', 'Fictional Zero');
  fireEvent.click(screen.getByRole('button', { name: 'Reset Fictional Avery to default' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset Fictional Zero to default' }));
  expect(weightInput()).toHaveValue('100.50');
  expect(weightInput('Fictional Zero')).toHaveValue('0');
});

it('recalculates independent temporary shares immediately and resets one employee to the frozen default', async () => {
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional Casey', default_weight_override: '50' });
  render(panel()); await loaded(); choose(); choose('Fictional Casey');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  editWeight('50');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$50.00');
  expect(screen.getByRole('group', { name: 'Employee Fictional Casey' })).toHaveTextContent('$50.00');
  editWeight('25', 'Fictional Casey');
  expect(weightInput()).toHaveValue('50');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$66.66');
  expect(screen.getByRole('group', { name: 'Employee Fictional Casey' })).toHaveTextContent('$33.33');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$0.01');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Round down to whole dollar' }));
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$66.00');
  expect(screen.getByRole('group', { name: 'Employee Fictional Casey' })).toHaveTextContent('$33.00');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$1.00');
  tables.job_roles[0].default_weight = '200';
  fireEvent.click(screen.getByRole('button', { name: 'Reset Fictional Avery to default' }));
  expect(weightInput()).toHaveValue('100');
  expect(weightInput('Fictional Casey')).toHaveValue('25');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$80.00');
  expect(screen.getByText('Permanent default share weight: 100')).toBeVisible();
  expect(exactReads()).toHaveLength(1);
});

it('supports zero and two decimal places without floating-point conversion', async () => {
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional Casey', default_weight_override: '0' });
  render(panel()); await loaded(); choose(); choose('Fictional Casey');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '1' } });
  editWeight('0.29'); editWeight('0.01', 'Fictional Casey');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$0.96');
  expect(screen.getByRole('group', { name: 'Employee Fictional Casey' })).toHaveTextContent('$0.03');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$0.01');
  editWeight('0');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$0.00');
  expect(screen.getByRole('group', { name: 'Employee Fictional Casey' })).toHaveTextContent('$1.00');
  editWeight('0', 'Fictional Casey');
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('$0.00');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$1.00');
});

it.each(['', ' ', '-1', 'abc', '1e2', 'Infinity', 'NaN', '0.001', '1.000', '90071992547409.92'])('invalid selected temporary weight %j blocks the entire payout preview without fallback', async value => {
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional Casey', default_weight_override: '50' });
  render(panel()); await loaded(); choose(); choose('Fictional Casey');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  editWeight(value);
  expect(weightInput()).toHaveValue(value);
  expect(weightInput()).toHaveAttribute('aria-invalid', 'true');
  expect(weightInput()).toHaveAccessibleDescription(/Permanent default share weight: 100.*Weight/);
  expect(screen.getAllByRole('alert').some(alert => /Correct the temporary share weight for Fictional Avery/.test(alert.textContent ?? ''))).toBe(true);
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('—');
  expect(screen.queryByRole('group', { name: 'Employee Fictional Casey' })).not.toBeInTheDocument();
  choose(); // Invalid but excluded: the valid selected employee can allocate.
  expect(weightInput()).toHaveValue(value);
  expect(screen.getByRole('group', { name: 'Employee Fictional Casey' })).toHaveTextContent('$100.00');
  choose(); // Reselecting retains the invalid text and blocks payouts again.
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  fireEvent.click(screen.getByRole('button', { name: 'Reset Fictional Avery to default' }));
  expect(weightInput()).toHaveValue('100');
  expect(weightInput()).toHaveAttribute('aria-invalid', 'false');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$66.66');
});

it('preserves editable exact maximum units and blocks overflow of the selected total', async () => {
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional Casey', default_weight_override: '0' });
  render(panel()); await loaded(); choose(); choose('Fictional Casey');
  editWeight('90071992547409.91');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100.01' } });
  expect(weightInput()).toHaveValue('90071992547409.91');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('Share weight: 90071992547409.91');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.01');
  editWeight('0.01', 'Fictional Casey');
  expect(screen.getByRole('alert')).toHaveTextContent('Total weight units exceeds the safe integer range');
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  choose('Fictional Casey');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  choose('Fictional Casey');
  expect(weightInput('Fictional Casey')).toHaveValue('0.01');
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
});

it('retains deselected temporary shares in this preview without including their payouts', async () => {
  tables.employees.push({ ...employee(), id: id(7), name: 'Fictional Casey', default_weight_override: '100' });
  render(panel()); await loaded(); choose(); choose('Fictional Casey');
  editWeight('25');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$20.00');
  choose();
  expect(weightInput()).toHaveValue('25'); expect(weightInput()).toBeDisabled();
  expect(screen.queryByRole('group', { name: 'Employee Fictional Avery' })).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Employee Fictional Casey' })).toHaveTextContent('$100.00');
  choose();
  expect(weightInput()).toHaveValue('25');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$20.00');
});

it.each(['account', 'project', 'restaurant'])('clears temporary weights and selection when the %s scope changes', async kind => {
  const view = render(panel()); await loaded(); choose(); editWeight('13.25');
  addTemporary();
  let overrides = {};
  if (kind === 'account') {
    session = { ...session!, user: { ...session!.user, id: otherUser } };
    tables.organization_memberships = [membership(org, otherUser)]; overrides = { userId: otherUser };
  }
  if (kind === 'project') overrides = { client: makeClient('https://other-fictional.example.test') };
  if (kind === 'restaurant') {
    tables.organization_memberships.push(membership(otherOrg)); tables.job_roles.push(role(otherOrg)); tables.employees.push(employee(otherOrg));
    overrides = { organizationId: otherOrg, restaurantName: 'Fictional Moonbeam' };
  }
  view.rerender(panel(overrides)); await loaded();
  expect(screen.queryByRole('group', { name: 'Temporary participant Fictional Guest' })).not.toBeInTheDocument();
  expect(weightInput(kind === 'restaurant' ? 'Fictional Blair' : 'Fictional Avery')).toHaveValue('100');
  expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
});

it.each(['sign-out', 'revocation'])('clears temporary weights after %s and requires fresh defaults when access returns', async kind => {
  const ownSession = session;
  const view = render(panel()); await loaded(); choose(); editWeight('13.25');
  addTemporary();
  if (kind === 'sign-out') act(() => emit('SIGNED_OUT', null));
  else { tables.organization_memberships = []; view.rerender(panel({ accessRevision: 1 })); }
  await screen.findByRole('alert');
  expect(screen.queryByRole('textbox', { name: /Temporary share weight/ })).not.toBeInTheDocument();
  if (kind === 'sign-out') act(() => emit('SIGNED_IN', ownSession));
  else { tables.organization_memberships = [membership()]; reload(); }
  await loaded();
  expect(weightInput()).toHaveValue('100');
  expect(screen.queryByRole('group', { name: 'Temporary participant Fictional Guest' })).not.toBeInTheDocument();
  expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
});

it('preserves invalid temporary text and unavailable payouts through successful access rechecks', async () => {
  const view = render(panel()); await loaded(); choose(); editWeight('0.001');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  view.rerender(panel({ accessRevision: 1 })); await loaded();
  expect(weightInput()).toHaveValue('0.001');
  expect(weightInput()).toHaveAttribute('aria-invalid', 'true');
  expect(within(participating()).getByRole('checkbox')).toBeChecked();
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  expect(exactReads()).toHaveLength(1);
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('100');
});

it('adds multiple selected temporary participants without needing any shared employee or job role', async () => {
  tables.job_roles = []; tables.employees = [];
  render(panel()); await screen.findByText('No shared employees to select.');
  const before = requests.length;
  addTemporary(); addTemporary('Fictional Second', '25', 'Free-text visiting role');
  expect(within(temporaryRow()).getByText('Temporary')).toBeVisible();
  expect(within(temporaryRow()).getByRole('checkbox')).toBeChecked();
  expect(within(temporaryRow('Fictional Second')).getByRole('checkbox')).toBeChecked();
  expect(screen.getByRole('group', { name: 'Employee Fictional Guest' })).toHaveTextContent('Temporary');
  expect(screen.getByText('2 participants selected for this preview.')).toBeVisible();
  expect(screen.getByLabelText('Temporary participant name')).toHaveValue('');
  expect(requests).toHaveLength(before);
});

it('calculates mixed shared/temporary shares, edits and excludes/reincludes/removes only the temporary entry', async () => {
  render(panel()); await loaded(); choose(); addTemporary();
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$66.66');
  expect(screen.getByRole('group', { name: 'Employee Fictional Guest' })).toHaveTextContent('$33.33');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$0.01');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Round down to whole dollar' }));
  expect(screen.getByRole('group', { name: 'Employee Fictional Guest' })).toHaveTextContent('$33.00');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$1.00');
  editWeight('100', 'Fictional Guest');
  expect(screen.getByRole('group', { name: 'Employee Fictional Guest' })).toHaveTextContent('$50.00');
  choose('Fictional Guest');
  expect(weightInput('Fictional Guest')).toHaveValue('100');
  expect(screen.queryByRole('group', { name: 'Employee Fictional Guest' })).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.00');
  choose('Fictional Guest');
  expect(screen.getByRole('group', { name: 'Employee Fictional Guest' })).toHaveTextContent('$50.00');
  expect(within(screen.getByRole('group', { name: 'Shared employee Fictional Avery' })).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  removeTemporary();
  expect(screen.queryByRole('group', { name: 'Temporary participant Fictional Guest' })).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.00');
});

it('keeps duplicate shared and temporary display names distinct with local non-UUID identities', async () => {
  render(panel()); await loaded();
  addTemporary('Fictional Avery', '1'); addTemporary('Fictional Avery', '2');
  const rows = screen.getAllByRole('group', { name: 'Temporary participant Fictional Avery' });
  const inputs = rows.map(row => within(row).getByRole('textbox'));
  expect(new Set(inputs.map(input => input.id)).size).toBe(2);
  expect(inputs.every(input => input.id.includes('temporary:') && !input.id.includes(id(6)))).toBe(true);
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '3' } });
  const payouts = screen.getAllByRole('group', { name: 'Employee Fictional Avery' });
  expect(payouts[0]).toHaveTextContent('$1.00'); expect(payouts[1]).toHaveTextContent('$2.00');
  fireEvent.click(within(rows[0]).getByRole('button', { name: /Remove temporary/ }));
  expect(screen.getAllByRole('group', { name: 'Temporary participant Fictional Avery' })).toHaveLength(1);
  expect(screen.getByRole('group', { name: 'Shared employee Fictional Avery' })).toBeVisible();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$3.00');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['', '-1', '1.001', '1e2', '90071992547409.92'])('refuses invalid initial temporary weight %j without creating a selected participant', async value => {
  render(panel()); await loaded(); choose();
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  addTemporary('Fictional Guest', value);
  expect(within(screen.getByRole('form', { name: 'Add temporary participant' })).getByRole('alert')).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Temporary participant Fictional Guest' })).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.00');
});

it.each(['', '-1', '0.001', '90071992547409.92'])('invalid selected temporary edit %j blocks all payouts until excluded or removed', async value => {
  render(panel()); await loaded(); choose(); addTemporary();
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  editWeight(value, 'Fictional Guest');
  expect(weightInput('Fictional Guest')).toHaveValue(value);
  expect(weightInput('Fictional Guest')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Fictional Guest'))).toBe(true);
  choose('Fictional Guest');
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.00');
  choose('Fictional Guest');
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  removeTemporary();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.00');
});

it('supports explicit zero, exact maximum temporary shares, and mixed selected-total overflow', async () => {
  render(panel()); await loaded(); addTemporary('Fictional Zero', '0');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100.01' } });
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('$0.00');
  expect(screen.getByRole('group', { name: 'Unassigned Remainder' })).toHaveTextContent('+$100.01');
  addTemporary('Fictional Maximum', '90071992547409.91');
  expect(screen.getByRole('group', { name: 'Employee Fictional Maximum' })).toHaveTextContent('$100.01');
  choose(); // The shared 100-share employee makes the selected sum unsafe.
  expect(screen.getByRole('alert')).toHaveTextContent('Total weight units exceeds the safe integer range');
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  choose();
  expect(screen.getByRole('group', { name: 'Employee Fictional Maximum' })).toHaveTextContent('$100.01');
});

it('preserves temporary entries, exclusion, edited text and an open form during minute/focus/Auth access checks', async () => {
  vi.useFakeTimers();
  render(<SharedRoster client={client} userId={userId} calculationMode />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  addTemporary(); addTemporary('Fictional Second', '0.29');
  editWeight('0.58', 'Fictional Guest');
  choose('Fictional Second');
  fireEvent.change(screen.getByLabelText('Temporary participant name'), { target: { value: 'Fictional draft' } });
  for (const action of ['focus', 'minute', 'auth']) {
    await act(async () => {
      if (action === 'focus') window.dispatchEvent(new Event('focus'));
      if (action === 'auth') emit('TOKEN_REFRESHED', { ...session!, access_token: 'fictional-new-token' });
      await vi.advanceTimersByTimeAsync(action === 'minute' ? 60_000 : 0);
    });
    expect(weightInput('Fictional Guest')).toHaveValue('0.58');
    expect(within(temporaryRow()).getByRole('checkbox')).toBeChecked();
    expect(within(temporaryRow('Fictional Second')).getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByLabelText('Temporary participant name')).toHaveValue('Fictional draft');
  }
  expect(exactReads()).toHaveLength(1);
});

it.each(['parent', 'revision', 'auth'] as const)('keeps a verified large preview visible and inert during a pending %s check', async trigger => {
  tables.employees = Array.from({ length: 50 }, (_, index) => ({ ...employee(), id: id(100 + index), name: `Fictional Employee ${index}` }));
  const view = render(panel()); await loaded(); choose('Fictional Employee 49');
  editWeight('75.25', 'Fictional Employee 49');
  addTemporary(); editWeight('25.50', 'Fictional Guest');
  const list = participating();
  const row = screen.getByRole('group', { name: 'Shared employee Fictional Employee 49' });
  const checkbox = within(row).getByRole('checkbox');
  const cash = screen.getByLabelText('Cash Tips ($)');
  const credit = screen.getByLabelText('Credit Tips ($)');
  const rounding = screen.getByRole('checkbox', { name: 'Round down to whole dollar' });
  const form = screen.getByRole('form', { name: 'Add temporary participant' });
  const draft = screen.getByLabelText('Temporary participant name');
  const payout = screen.getByRole('group', { name: 'Employee Fictional Guest' });
  fireEvent.change(cash, { target: { value: '100.01' } });
  fireEvent.change(credit, { target: { value: '25.50' } });
  fireEvent.click(rounding);
  fireEvent.change(draft, { target: { value: 'Fictional draft' } });
  const originalPayout = payout.textContent;
  const late = deferred<Response>();
  intercept = request => request.table === 'organization_memberships' ? late.promise : undefined;
  if (trigger === 'auth') act(() => emit('TOKEN_REFRESHED', session));
  else view.rerender(panel(trigger === 'parent' ? { accessPending: true } : { accessRevision: 1 }));
  for (const node of [list, row, cash, form, payout]) {
    expect(node).toBeInTheDocument();
    expect(node).toBeVisible();
    expect(node.closest('[inert]')).not.toBeNull();
    expect(node.closest('[hidden]')).toBeNull();
  }
  expect(list.querySelectorAll('input[type="checkbox"]')).toHaveLength(51);
  fireEvent.click(checkbox); // Even a stale dispatched event cannot change selection.
  fireEvent.change(within(row).getByLabelText('Temporary share weight · Fictional Employee 49'), { target: { value: '1' } });
  fireEvent.submit(form);
  if (trigger === 'parent') view.rerender(panel());
  else await act(async () => late.resolve(response([membership()])));
  await waitFor(() => expect(list).toBeVisible());
  expect(participating()).toBe(list);
  expect(screen.getByLabelText('Cash Tips ($)')).toBe(cash);
  expect(cash).toHaveValue('100.01'); expect(credit).toHaveValue('25.50');
  expect(rounding).toBeChecked(); expect(checkbox).toBeChecked();
  expect(weightInput('Fictional Employee 49')).toHaveValue('75.25');
  expect(weightInput('Fictional Guest')).toHaveValue('25.50');
  expect(draft).toHaveValue('Fictional draft');
  expect(payout).toHaveTextContent(originalPayout!);
  expect(exactReads()).toHaveLength(1);
});

it('clears a visible prior snapshot when a delayed background membership check denies access', async () => {
  const view = render(panel()); await loaded(); choose(); addTemporary();
  const row = screen.getByRole('group', { name: 'Shared employee Fictional Avery' });
  const temporary = temporaryRow();
  const late = deferred<Response>();
  intercept = request => request.table === 'organization_memberships' ? late.promise : undefined;
  view.rerender(panel({ accessRevision: 1 }));
  expect(row).toBeVisible(); expect(temporary).toBeVisible();
  expect(row.closest('[inert]')).not.toBeNull();
  await act(async () => late.resolve(response([])));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');
  expect(row).not.toBeInTheDocument();
  expect(temporary).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Participating employees' })).not.toBeInTheDocument();
});

it('explicit reload clears temporary entries, weights, selections and unsaved form values', async () => {
  render(panel()); await loaded(); choose(); addTemporary();
  editWeight('25', 'Fictional Guest');
  fireEvent.change(screen.getByLabelText('Temporary participant name'), { target: { value: 'Fictional draft' } });
  reload(); await loaded();
  expect(screen.queryByRole('group', { name: 'Temporary participant Fictional Guest' })).not.toBeInTheDocument();
  expect(within(participating()).getAllByRole('checkbox')).toHaveLength(1);
  expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByLabelText('Temporary participant name')).toHaveValue('');
});

it('allows additions only in a verified scope and disables a retained form while access is checking', async () => {
  const late = deferred<Response>();
  intercept = request => request.table === 'employees' ? late.promise : undefined;
  const view = render(panel());
  await waitFor(() => expect(exactReads()).toHaveLength(1));
  expect(screen.queryByRole('button', { name: 'Add temporary participant' })).not.toBeInTheDocument();
  await act(async () => late.resolve(response([employee()])));
  await loaded();
  const form = screen.getByRole('form', { name: 'Add temporary participant' });
  fireEvent.change(screen.getByLabelText('Temporary participant name'), { target: { value: 'Fictional pending' } });
  fireEvent.change(screen.getByLabelText('Job title / role label'), { target: { value: 'Fictional role' } });
  fireEvent.change(screen.getByLabelText('Initial share weight'), { target: { value: '1' } });
  view.rerender(panel({ accessPending: true }));
  fireEvent.submit(form);
  view.rerender(panel({ accessPending: false }));
  expect(screen.queryByRole('group', { name: 'Temporary participant Fictional pending' })).not.toBeInTheDocument();
  tables.organization_memberships = [];
  view.rerender(panel({ accessRevision: 1 }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Add temporary participant' })).not.toBeInTheDocument();
});

it('never mutates storage or requests shared writes when adding, editing, excluding and removing temporary entries', async () => {
  render(panel()); await loaded();
  const write = vi.spyOn(Storage.prototype, 'setItem'), remove = vi.spyOn(Storage.prototype, 'removeItem');
  const clear = vi.spyOn(Storage.prototype, 'clear');
  const before = requests.length;
  addTemporary(); editWeight('12.25', 'Fictional Guest'); choose('Fictional Guest'); removeTemporary();
  expect(requests).toHaveLength(before);
  expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
});

it('provides labelled mobile fields and keyboard submission, with required free-text name/title validation', async () => {
  render(panel()); await loaded();
  addTemporary(' ', '1', 'Fictional role');
  expect(within(screen.getByRole('form', { name: 'Add temporary participant' })).getByRole('alert')).toHaveTextContent('Enter a name');
  addTemporary('Fictional Guest', '1', ' ');
  expect(screen.queryByRole('group', { name: 'Temporary participant Fictional Guest' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Temporary participant name'), { target: { value: '  Fictional Guest  ' } });
  fireEvent.change(screen.getByLabelText('Job title / role label'), { target: { value: '  Fictional visiting role  ' } });
  const input = screen.getByLabelText('Initial share weight');
  expect(input).toHaveAttribute('inputmode', 'decimal');
  expect(input).toHaveAttribute('type', 'text');
  expect(input).toHaveClass('min-h-12', 'text-base');
  input.focus(); await userEvent.keyboard('{Enter}');
  expect(temporaryRow()).toHaveTextContent('Fictional visiting role');
  expect(within(temporaryRow()).getByRole('button', { name: /Remove temporary participant/ })).toHaveClass('min-h-12');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('rejects stale addition and weight events in the same turn as sign-out without restoring temporary data', async () => {
  const ownSession = session;
  render(panel()); await loaded(); choose(); addTemporary();
  const input = weightInput(), form = screen.getByRole('form', { name: 'Add temporary participant' });
  fireEvent.change(screen.getByLabelText('Temporary participant name'), { target: { value: 'Fictional stale' } });
  fireEvent.change(screen.getByLabelText('Job title / role label'), { target: { value: 'Fictional role' } });
  fireEvent.change(screen.getByLabelText('Initial share weight'), { target: { value: '1' } });
  act(() => {
    emit('SIGNED_OUT', null);
    fireEvent.change(input, { target: { value: '17' } });
    fireEvent.submit(form);
  });
  await screen.findByRole('alert');
  act(() => emit('SIGNED_IN', ownSession)); await loaded();
  expect(screen.queryByRole('group', { name: /Temporary participant Fictional (Guest|stale)/ })).not.toBeInTheDocument();
  expect(weightInput()).toHaveValue('100');
  expect(within(participating()).getAllByRole('checkbox')).toHaveLength(1);
  expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
});
