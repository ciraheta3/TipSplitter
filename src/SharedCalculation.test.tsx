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
const reload = () => fireEvent.click(screen.getByRole('button', { name: 'Reload shared roster / clear selection' }));
const exactReads = () => requests.filter(request => request.url.searchParams.get('select') === calculationEmployeeProjection);
function emit(event: AuthChangeEvent, candidate: Session | null) { session = candidate; listeners.forEach(callback => callback(event, candidate)); }

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
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('Weight: 0');
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
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100' } });
  tables.employees[0].default_weight_override = '50';
  view.rerender(panel({ accessRevision: 1, accessPending: true }));
  expect(screen.queryByRole('group', { name: 'Participating employees' })).not.toBeInTheDocument();
  await act(async () => {});
  view.rerender(panel({ accessRevision: 1, accessPending: false }));
  await loaded();
  expect(within(participating()).getByRole('checkbox')).toBeChecked();
  expect(screen.getByText('Effective default share weight: 100')).toBeVisible();
  expect(exactReads()).toHaveLength(1);
  for (let i = 0; i < 2; i++) {
    reload(); await loaded();
    expect(within(participating()).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Effective default share weight: 50')).toBeVisible();
    expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('100');
  }
  expect(exactReads()).toHaveLength(3);
});

it.each(['failed', 'partial', 'revoked'])('clears the previous preview and fails visibly on %s reload/check', async kind => {
  const view = render(panel());
  await loaded(); choose();
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
  act(() => emit('TOKEN_REFRESHED', { ...session!, access_token: 'fictional-new-session' }));
  await loaded();
  expect(within(participating()).getByRole('checkbox')).toBeChecked();
  expect(exactReads()).toHaveLength(1);
});

it('reuses the authorized restaurant selector and clears selected A before loading B', async () => {
  tables.organizations.push({ id: otherOrg, name: 'Fictional Moonbeam' });
  tables.organization_memberships.push(membership(otherOrg)); tables.job_roles.push(role(otherOrg)); tables.employees.push(employee(otherOrg));
  render(<SharedRoster client={client} userId={userId} calculationMode />);
  const selector = await screen.findByLabelText('Restaurant');
  expect(exactReads()).toHaveLength(0);
  fireEvent.change(selector, { target: { value: org } });
  await loaded(); choose();
  fireEvent.change(screen.getByLabelText('Restaurant'), { target: { value: otherOrg } });
  expect(screen.queryByText(/Fictional Avery/)).not.toBeInTheDocument();
  await loaded();
  expect(screen.getByRole('heading', { name: 'Restaurant shared roster · Fictional Moonbeam' })).toBeVisible();
  expect(within(participating()).getByRole('checkbox', { name: /Fictional Blair/ })).not.toBeChecked();
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
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Employee Fictional Local' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Browser-local roster' }));
  expect(screen.getByRole('group', { name: 'Employee Fictional Local' })).toHaveTextContent('$42.50');
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('42.50');
  fireEvent.click(screen.getByRole('radio', { name: 'Restaurant shared roster' }));
  await loaded();
  expect(within(participating()).getByRole('checkbox')).not.toBeChecked();
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
  tables.job_roles[0].default_weight = '50';
  for (const event of ['focus', 'online']) {
    const before = requests.filter(request => request.table === 'organization_memberships').length;
    await act(async () => { window.dispatchEvent(new Event(event)); await vi.advanceTimersByTimeAsync(0); });
    expect(requests.filter(request => request.table === 'organization_memberships').length).toBeGreaterThan(before);
    expect(within(participating()).getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('Effective default share weight: 100')).toBeVisible();
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(within(participating()).getByRole('checkbox')).toBeChecked();
  expect(exactReads()).toHaveLength(1);
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
  expect(screen.getByText('Effective default share weight: 90071992547409.91')).toBeVisible();
  choose();
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '100.01' } });
  expect(screen.getByRole('group', { name: 'Employee Fictional Avery' })).toHaveTextContent('$100.01');
  choose('Fictional extra');
  expect(screen.getByRole('alert')).toHaveTextContent('Total weight units exceeds the safe integer range');
  expect(screen.getByRole('group', { name: 'Allocated Tips' })).toHaveTextContent('—');
  choose('Fictional extra');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
