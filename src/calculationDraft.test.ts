// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { clearAccountDrafts, contextKey, emptyDraft, localDraftKey, readContext, readDraft, reconcileDraft, removeStored, saveDraft, sharedDraftKey, writeStored } from './calculationDraft';
import type { SharedCalculationEmployee } from './sharedCalculationData';
import { accountRosterKey } from './supabase';

const scope = accountRosterKey('https://fictional.example.test', 'account-a');
const key = sharedDraftKey(scope, 'restaurant-a');
const row: SharedCalculationEmployee = { id: 'employee-a', roleId: 'role-a', name: 'Fictional Avery', jobTitle: 'Server', weightText: '100', weightUnits: 10000, eligible: true };
const draft = () => ({ ...emptyDraft(), cashTip: '001.20', creditTip: '1..', roundToDollar: true, selected: [row.id, 'temporary:a', 'temporary:b'],
  weights: [[row.id, '0'], ['temporary:a', '1..']] as [string, string][], references: [{ id: row.id, roleId: row.roleId!, weightText: row.weightText }],
  temporary: ['a', 'b'].map(id => ({ id: `temporary:${id}`, name: 'Fictional Guest', jobTitle: 'Server', weightText: '01.50' })) });
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it('round trips raw input text, zero/invalid weights and distinct temporary identities', () => {
  expect(saveDraft(key, draft())).toBe(true);
  expect(readDraft(key).value).toEqual(draft());
  expect(localStorage.getItem('employees')).toBeNull();
});
it('separates source, project, account and restaurant namespaces', () => {
  saveDraft(key, draft());
  for (const other of [localDraftKey(scope), sharedDraftKey(scope, 'restaurant-b'), sharedDraftKey(accountRosterKey('https://other.example.test', 'account-a'), 'restaurant-a'), sharedDraftKey(accountRosterKey('https://fictional.example.test', 'account-b'), 'restaurant-a')]) expect(readDraft(other).value).toBeUndefined();
  localStorage.setItem(sharedDraftKey(scope, 'restaurant-b'), localStorage.getItem(key)!);
  expect(readDraft(sharedDraftKey(scope, 'restaurant-b')).error).toMatch(/could not be read/);
});
it.each(['json', 'version', 'oversized', 'duplicate-selection', 'duplicate-temporary', 'id-collision', 'orphan-weight', 'unsafe-weight', 'missing-form'])('rejects %s storage without overwriting it', kind => {
  const value = draft();
  const envelope = { version: 1, scope: key, value };
  if (kind === 'version') envelope.version = 99;
  if (kind === 'duplicate-selection') value.selected.push(row.id);
  if (kind === 'duplicate-temporary') value.temporary.push(value.temporary[0]);
  if (kind === 'id-collision') value.temporary[0].id = row.id;
  if (kind === 'orphan-weight') value.weights.push(['missing', '0']);
  if (kind === 'unsafe-weight') value.temporary[0].weightText = '9007199254740992';
  if (kind === 'missing-form') Reflect.deleteProperty(value, 'form');
  const raw = kind === 'json' ? '{broken' : kind === 'oversized' ? 'x'.repeat(256001) : JSON.stringify(envelope);
  localStorage.setItem(key, raw);
  expect(readDraft(key).value).toBeUndefined();
  expect(readDraft(key).error).toBeTruthy();
  expect(localStorage.getItem(key)).toBe(raw);
});
it.each(['missing', 'inactive', 'role', 'default'])('excludes a %s reference, removes its override and requires review', kind => {
  const current = { ...row };
  if (kind === 'inactive') current.eligible = false;
  if (kind === 'role') current.roleId = 'role-b';
  if (kind === 'default') current.weightText = '50';
  const restored = reconcileDraft(draft(), kind === 'missing' ? [] : [current]);
  expect(restored.selected).toEqual(['temporary:a', 'temporary:b']);
  expect(restored.weights).toEqual([['temporary:a', '1..']]);
  expect(restored.references).toEqual([]);
  expect(restored.reviewRequired).toBe(true);
  expect(restored.cashTip).toBe('001.20');
});
it('retains exact overrides for unchanged stable IDs and uses current labels', () => {
  expect(reconcileDraft(draft(), [{ ...row, name: 'New authorized name' }])).toEqual(draft());
});
it('clears only the intended account drafts and preserves permanent rosters', () => {
  const other = accountRosterKey('https://fictional.example.test', 'account-b');
  saveDraft(key, draft()); saveDraft(localDraftKey(scope), emptyDraft());
  writeStored(contextKey(scope), { source: 'shared', organizationId: 'restaurant-a' });
  saveDraft(sharedDraftKey(other, 'restaurant-a'), draft());
  localStorage.setItem(scope, 'permanent roster');
  expect(clearAccountDrafts(scope)).toBe(true);
  expect(readDraft(key).value).toBeUndefined();
  expect(readDraft(localDraftKey(scope)).value).toBeUndefined();
  expect(readContext(scope).value).toBeUndefined();
  expect(readDraft(sharedDraftKey(other, 'restaurant-a')).value).toBeDefined();
  expect(localStorage.getItem(scope)).toBe('permanent roster');
});
it('reports unavailable reads, writes and clears without throwing', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  expect(readDraft(key).error).toBeTruthy();
  expect(saveDraft(key, draft())).toBe(false);
  expect(removeStored(key)).toBe(false);
  expect(clearAccountDrafts(scope)).toBe(false);
});

it('replaces a deliberately cleared entry with a tombstone if only removal is denied', () => {
  saveDraft(key, draft());
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  expect(removeStored(key)).toBe(true);
  expect(readDraft(key).value).toBeUndefined();
});
