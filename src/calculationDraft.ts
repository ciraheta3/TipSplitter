import type { SharedCalculationEmployee } from './sharedCalculationData';
import { parseWeightInput } from './calculation';

export type TipDraft = { cashTip: string; creditTip: string; roundToDollar: boolean };
export type TemporaryDraft = { id: string; name: string; jobTitle: string; weightText: string };
export type CalculationDraft = TipDraft & {
  selected: string[];
  weights: [string, string][];
  temporary: TemporaryDraft[];
  references: { id: string; roleId: string; weightText: string }[];
  form: { name: string; jobTitle: string; weight: string };
  reviewRequired: boolean;
};
export const emptyDraft = (): CalculationDraft => ({ cashTip: '', creditTip: '', roundToDollar: false, selected: [], weights: [], temporary: [], references: [], form: { name: '', jobTitle: '', weight: '' }, reviewRequired: false });
const prefix = 'tipsplitter:draft:v1:';
export const localDraftKey = (scope: string) => `${prefix}local:${scope}`;
export const sharedDraftKey = (scope: string, org: string) => `${prefix}shared:${scope}:${encodeURIComponent(org)}`;
export const contextKey = (scope: string) => `${prefix}context:${scope}`;
const maxSize = 256_000;
const str = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => str(v, 300) && !!v;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const unique = (ids: string[]) => new Set(ids).size === ids.length;
function valid(v: unknown): v is CalculationDraft {
  if (!object(v) || !str(v.cashTip) || !str(v.creditTip) || typeof v.roundToDollar !== 'boolean' || typeof v.reviewRequired !== 'boolean'
    || !Array.isArray(v.selected) || v.selected.length > 1200 || !v.selected.every(id) || !unique(v.selected)
    || !Array.isArray(v.weights) || v.weights.length > 1200 || !v.weights.every(p => Array.isArray(p) && p.length === 2 && id(p[0]) && str(p[1]))
    || !unique(v.weights.map(p => p[0])) || !Array.isArray(v.temporary) || v.temporary.length > 200
    || !Array.isArray(v.references) || v.references.length > 1000 || !object(v.form)
    || !str(v.form.name, 160) || !str(v.form.jobTitle, 100) || !str(v.form.weight)) return false;
  try {
    for (const row of v.temporary) {
      if (!object(row) || !id(row.id) || !row.id.startsWith('temporary:') || !str(row.name, 160) || !row.name.trim()
        || !str(row.jobTitle, 100) || !row.jobTitle.trim() || !str(row.weightText)) return false;
      parseWeightInput(row.weightText);
    }
    for (const row of v.references) {
      if (!object(row) || !id(row.id) || row.id.startsWith('temporary:') || !id(row.roleId) || !str(row.weightText)) return false;
      parseWeightInput(row.weightText);
    }
    const all = [...v.temporary, ...v.references].map(row => row.id as string);
    return unique(all) && v.selected.every(key => all.includes(key)) && v.weights.every(p => all.includes(p[0]));
  } catch { return false; }
}
export function readStored<T>(key: string | undefined, validate: (v: unknown) => v is T): { value?: T; error?: string } {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return {};
    if (raw.length > maxSize) throw new Error();
    const parsed: unknown = JSON.parse(raw);
    if (!object(parsed) || parsed.version !== 1 || parsed.scope !== key || !validate(parsed.value)) throw new Error();
    return { value: parsed.value };
  } catch { return { error: 'Draft could not be read. Recovery is unavailable until a new draft is saved.' }; }
}
export const readDraft = (key?: string) => readStored(key, valid);
export function writeStored(key: string | undefined, value: unknown): boolean {
  if (!key) return true;
  try {
    const raw = JSON.stringify({ version: 1, scope: key, value });
    if (raw.length > maxSize) return false;
    localStorage.setItem(key, raw);
    return true;
  } catch { return false; }
}
export function saveDraft(key: string | undefined, value: CalculationDraft) {
  return valid(value) && writeStored(key, value);
}
export function removeStored(key?: string) {
  if (!key) return true;
  try { localStorage.removeItem(key); return true; } catch {
    // Some storage adapters deny removal but still permit replacing an entry.
    return writeStored(key, null);
  }
}
export type DraftContext = { source: 'local' | 'shared'; organizationId: string };
export const readContext = (scope: string) => readStored(contextKey(scope), (v): v is DraftContext => object(v) && (v.source === 'local' || v.source === 'shared') && str(v.organizationId, 300));
export function clearSharedDrafts(scope?: string) {
  if (!scope) return true;
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    let cleared = true;
    for (const key of keys) {
      if (key?.startsWith(`${prefix}shared:${scope}:`) && !removeStored(key)) cleared = false;
    }
    return removeStored(contextKey(scope)) && cleared;
  } catch { return false; }
}
export function clearAccountDrafts(scope: string) {
  const shared = clearSharedDrafts(scope);
  return removeStored(localDraftKey(scope)) && shared;
}
export function reconcileDraft(draft: CalculationDraft, employees: SharedCalculationEmployee[]) {
  const current = new Map(employees.map(row => [row.id, row]));
  const rejected = new Set(draft.references.filter(ref => {
    const row = current.get(ref.id);
    return !row?.eligible || row.roleId !== ref.roleId || row.weightText !== ref.weightText;
  }).map(ref => ref.id));
  // Never let an untrusted temporary ID collide with an authorized shared ID.
  draft.temporary.filter(row => current.has(row.id)).forEach(row => rejected.add(row.id));
  return { ...draft, selected: draft.selected.filter(key => !rejected.has(key)), weights: draft.weights.filter(([key]) => !rejected.has(key)),
    references: draft.references.filter(ref => !rejected.has(ref.id)), temporary: draft.temporary.filter(row => !rejected.has(row.id)),
    reviewRequired: draft.reviewRequired || rejected.size > 0 };
}
