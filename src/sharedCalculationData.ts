import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWeightInput } from './calculation';
import type { Participant } from './calculation';
import { verifyRosterAccess } from './sharedRosterEditingData';
import { sharedOverrideText, sharedWeightText } from './sharedRosterWeights';
import { SharedRosterError } from './sharedRosterData';

export type CalculationParticipant = Participant & { name: string; jobTitle: string; weightText: string };
export type SharedCalculationEmployee = CalculationParticipant & { eligible: boolean; exclusion?: string };
export const calculationRoleProjection = 'id,organization_id,name,is_active,default_weight::text';
export const calculationEmployeeProjection = 'id,organization_id,name,is_active,default_role_id,default_weight_override::text';
const invalid = 'The complete shared calculation roster could not be verified. Reload the roster to retry.';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SharedRosterError(invalid);
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new SharedRosterError(invalid);
  return value;
}
function rows(result: { data: unknown; count: number | null; error: unknown }, org: string) {
  if (result.error || !Array.isArray(result.data) || result.count !== result.data.length || result.data.length > 1000) throw new SharedRosterError(invalid);
  const values = result.data.map((value): Record<string, unknown> & { id: string; name: string; is_active: boolean } => {
    const row = record(value);
    if (row.organization_id !== org || typeof row.is_active !== 'boolean') throw new SharedRosterError(invalid);
    return { ...row, id: text(row.id), name: text(row.name), is_active: row.is_active };
  });
  if (new Set(values.map(row => row.id)).size !== values.length) throw new SharedRosterError(invalid);
  return values;
}

// GET-only snapshot. Verify actual Auth identity/current membership on both sides
// of the bounded reads. RLS remains the server authorization boundary.
export async function loadCalculationRoster(client: SupabaseClient, userId: string, org: string, signal: AbortSignal): Promise<SharedCalculationEmployee[]> {
  await verifyRosterAccess(client, userId, org, signal);
  const [roleResult, employeeResult] = await Promise.all([
    client.from('job_roles').select(calculationRoleProjection, { count: 'exact' }).eq('organization_id', org).order('name').order('id').range(0, 999).abortSignal(signal).retry(false).returns<unknown[]>(),
    client.from('employees').select(calculationEmployeeProjection, { count: 'exact' }).eq('organization_id', org).order('name').order('id').range(0, 999).abortSignal(signal).retry(false).returns<unknown[]>(),
  ]);
  signal.throwIfAborted();
  try {
    const roles = new Map(rows(roleResult, org).map(row => [row.id, { ...row, weight: sharedWeightText(row.default_weight) }]));
    const employees = rows(employeeResult, org).map(row => {
      const role = roles.get(text(row.default_role_id));
      if (!role) throw new SharedRosterError(invalid);
      const weightText = sharedOverrideText(row.default_weight_override) ?? role.weight;
      return { id: row.id, name: row.name, jobTitle: role.name, weightText, weightUnits: parseWeightInput(weightText),
        eligible: row.is_active && role.is_active,
        exclusion: !row.is_active ? 'Inactive employee' : !role.is_active ? 'Inactive role' : undefined };
    });
    await verifyRosterAccess(client, userId, org, signal);
    signal.throwIfAborted();
    return employees;
  } catch {
    signal.throwIfAborted();
    throw new SharedRosterError(invalid);
  }
}
