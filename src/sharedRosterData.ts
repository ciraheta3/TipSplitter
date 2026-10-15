import type { SupabaseClient } from '@supabase/supabase-js';

export type Organization = { id: string; name: string };
export type SharedRole = Organization & { organization_id: string; is_active: boolean };
export type SharedEmployee = SharedRole & { default_role_id: string };
export type SharedRosterData = { roles: SharedRole[]; employees: SharedEmployee[] };

// Fail explicitly instead of presenting a gateway-truncated roster as complete.
// Pagination and large-roster UX belong to a separately scoped follow-up.
export class SharedRosterError extends Error {}

const rowLimit = 1000;
const invalid = 'Shared data could not be verified. Refresh access or contact the project owner.';
export const accessChanged = 'Restaurant access changed. Refresh access or select another restaurant.';

type ReadResult = {
  data: unknown[] | null;
  error: { code: string } | null;
  count: number | null;
  status: number;
};

async function rows(request: PromiseLike<ReadResult>) {
  const result = await request;
  if (result.error) {
    if (result.status === 401 || result.status === 403 || result.error.code === '42501') {
      throw new SharedRosterError('Shared roster access denied. Refresh access or contact the project owner.');
    }
    throw new SharedRosterError('Unable to load shared data. Check your connection and retry.');
  }
  if (!Array.isArray(result.data) || result.count === null || result.count > rowLimit || result.count !== result.data.length) {
    throw new SharedRosterError('The complete shared roster could not be loaded. Contact the project owner.');
  }
  return result.data;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SharedRosterError(invalid);
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new SharedRosterError(invalid);
  return value;
}

function unique<T extends { id: string }>(values: T[]): T[] {
  if (new Set(values.map(value => value.id)).size !== values.length) throw new SharedRosterError(invalid);
  return values;
}

function named(value: unknown): Organization {
  const row = record(value);
  return { id: text(row.id), name: text(row.name) };
}

function tenantRow(value: unknown, organizationId: string): SharedRole {
  const row = record(value);
  if (row.organization_id !== organizationId || typeof row.is_active !== 'boolean') throw new SharedRosterError(invalid);
  return { ...named(row), organization_id: organizationId, is_active: row.is_active };
}

export async function readOrganizations(client: SupabaseClient, userId: string, signal: AbortSignal): Promise<Organization[]> {
  // The verified UUID narrows this read even for admins who can read other members.
  // Filters/validation are defensive; database RLS remains the authorization boundary.
  const memberships = await rows(client.from('organization_memberships')
    .select('organization_id,user_id,is_active', { count: 'exact' })
    .eq('user_id', userId).eq('is_active', true).order('organization_id')
    .range(0, rowLimit - 1).abortSignal(signal).retry(false).returns<unknown[]>());
  signal.throwIfAborted();
  const ids = memberships.map(value => {
    const row = record(value);
    if (row.user_id !== userId || row.is_active !== true) throw new SharedRosterError(invalid);
    return text(row.organization_id);
  });
  if (new Set(ids).size !== ids.length) throw new SharedRosterError(invalid);
  if (!ids.length) return [];
  const organizations = unique((await rows(client.from('organizations')
    .select('id,name', { count: 'exact' }).in('id', ids).order('name').order('id')
    .range(0, rowLimit - 1).abortSignal(signal).retry(false).returns<unknown[]>())).map(named));
  if (organizations.length !== ids.length || organizations.some(org => !ids.includes(org.id))) throw new SharedRosterError(accessChanged);
  return organizations;
}

export async function readSharedRoster(client: SupabaseClient, userId: string, organizationId: string, signal: AbortSignal): Promise<SharedRosterData> {
  // Never select numeric defaults: JSON numbers would lose decimal precision.
  const [roleRows, employeeRows] = await Promise.all([
    rows(client.from('job_roles').select('id,organization_id,name,is_active', { count: 'exact' })
      .eq('organization_id', organizationId).order('name').order('id')
      .range(0, rowLimit - 1).abortSignal(signal).retry(false).returns<unknown[]>()),
    rows(client.from('employees').select('id,organization_id,name,default_role_id,is_active', { count: 'exact' })
      .eq('organization_id', organizationId).order('name').order('id')
      .range(0, rowLimit - 1).abortSignal(signal).retry(false).returns<unknown[]>()),
  ]);
  signal.throwIfAborted();
  const roles = unique(roleRows.map(value => tenantRow(value, organizationId)));
  const employees = unique(employeeRows.map(value => ({
    ...tenantRow(value, organizationId), default_role_id: text(record(value).default_role_id),
  })));
  const roleIds = new Set(roles.map(role => role.id));
  if (employees.some(employee => !roleIds.has(employee.default_role_id))) throw new SharedRosterError(invalid);
  // RLS-hidden rows are indistinguishable from empty tables. Recheck current
  // membership after both reads before accepting an empty/successful snapshot.
  const current = await readOrganizations(client, userId, signal);
  if (!current.some(org => org.id === organizationId)) throw new SharedRosterError(accessChanged);
  return { roles, employees };
}
