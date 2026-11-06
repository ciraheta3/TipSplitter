import { useEffect, useId, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Calculator from './Calculator';
import { groupCalculationParticipants } from './sharedCalculationGroups';
import RoleSection from './RoleSection';
import { loadCalculationRoster } from './sharedCalculationData';
import { parseWeightInput } from './calculation';
import type { CalculationParticipant, SharedCalculationEmployee } from './sharedCalculationData';
import { verifyRosterAccess } from './sharedRosterEditingData';
import { rosterSaveScope } from './sharedRosterSaveScope';
import { emptyDraft, reconcileDraft, sharedDraftKey, contextKey, writeStored } from './calculationDraft';
import type { CalculationDraft } from './calculationDraft';
import { useCalculationDraft } from './useCalculationDraft';

type Props = { draftScope?: string; client: SupabaseClient; userId: string; organizationId: string; restaurantName: string; accessRevision: number; accessPending: boolean; visible?: boolean };
type State = { employees?: SharedCalculationEmployee[]; checking: boolean; requestKey?: string; error?: string; accountChanged?: boolean };

export default function SharedCalculation(props: Props) {
  // Include client identity, even if two projects have identical restaurant IDs.
  return <SnapshotCalculator key={`${rosterSaveScope(props.client, props.userId, props.organizationId).id}:${props.draftScope ?? ''}`} {...props} />;
}

function SnapshotCalculator({ draftScope, client, userId, organizationId, restaurantName, accessRevision, accessPending, visible = true }: Props) {
  const [reload, setReload] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const [state, setState] = useState<State>({ checking: true });
  const [contextWarning, setContextWarning] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const draft = useCalculationDraft(draftScope ? sharedDraftKey(draftScope, organizationId) : undefined);
  const { value: saved, update: updateDraft, restore: restoreDraft, clear: clearDraft, current: draftRef } = draft;
  const selected = new Set(saved.selected);
  const weightInputs = new Map(saved.weights);
  const temporary: SharedCalculationEmployee[] = saved.temporary.map(row => ({ ...row, weightUnits: parseWeightInput(row.weightText), eligible: true, isTemporary: true }));
  const hydrated = useRef(false);
  const setSelected = (change: (previous: Set<string>) => Set<string>) => updatePreview(previous => ({ ...previous, selected: [...change(new Set(previous.selected))] }));
  const setWeightInputs = (change: (previous: Map<string, string>) => Map<string, string>) => updatePreview(previous => ({ ...previous, weights: [...change(new Map(previous.weights))] }));
  const inputPrefix = useId();
  const controller = useRef<AbortController | undefined>(undefined);
  const snapshot = useRef<SharedCalculationEmployee[] | undefined>(undefined);
  const invalidated = useRef(false);
  const requestKey = `${reload}:${authRevision}:${accessRevision}`;

  useEffect(() => {
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      controller.current?.abort();
      if (event === 'SIGNED_OUT' || !session || session.user.id !== userId
          || !Number.isFinite(session.expires_at) || (session.expires_at ?? 0) * 1000 <= Date.now()) {
        invalidated.current = true;
        snapshot.current = undefined;
        setExpanded(new Set());
        hydrated.current = false;
        // Expiry/ambiguous session loss hides the snapshot without deleting its
        // draft. Only sign-out/account changes delete here; actual failed shared
        // access checks retain their existing clearing policy below.
        if (event === 'SIGNED_OUT' || (session && session.user.id !== userId)) clearDraft();
        setState({ checking: false, accountChanged: true, error: 'Your account changed. Sign in again to continue.' });
      } else {
        invalidated.current = false;
        setState(previous => ({ ...previous, checking: true }));
        // SDK reads happen in the effect, outside the synchronous Auth callback.
        setAuthRevision(value => value + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, [client, userId, clearDraft]);

  useEffect(() => {
    if (invalidated.current) return;
    const active = new AbortController();
    controller.current = active;
    void (async () => {
      try {
        // Routine checks preserve the frozen defaults and temporary selection.
        const employees = snapshot.current ?? await loadCalculationRoster(client, userId, organizationId, active.signal);
        if (snapshot.current) await verifyRosterAccess(client, userId, organizationId, active.signal);
        active.signal.throwIfAborted();
        if (invalidated.current) return;
        if (!hydrated.current) {
          const recovered = reconcileDraft(draftRef.current, employees);
          restoreDraft(recovered);
          hydrated.current = true;
          if (draftScope && !writeStored(contextKey(draftScope), { source: 'shared', organizationId })) setContextWarning(true);
        }
        snapshot.current = employees;
        setState({ employees, checking: false, requestKey });
      } catch {
        if (active.signal.aborted || invalidated.current) return;
        snapshot.current = undefined;
        setExpanded(new Set());
        hydrated.current = false;
        clearDraft();
        setState({ checking: false, requestKey, error: 'Shared calculation access or complete roster could not be verified. Reload the roster to retry. The previous preview was cleared.' });
      }
    })();
    return () => active.abort();
  }, [client, userId, organizationId, requestKey, draftScope, draftRef, restoreDraft, clearDraft]);

  function updatePreview(change: (previous: CalculationDraft) => CalculationDraft) {
    if (!hydrated.current || invalidated.current) return;
    updateDraft(previous => {
      const next = change(previous);
      const referenced = new Set([...next.selected, ...next.weights.map(([id]) => id)]);
      return { ...next, references: (snapshot.current ?? []).filter(row => referenced.has(row.id)).map(row => ({ id: row.id, roleId: row.roleId!, weightText: row.weightText })) };
    });
  }
  const blocked = accessPending || state.checking || state.requestKey !== requestKey || !navigator.onLine;
  // Keep the verified snapshot's DOM and dimensions during routine checks.
  // A prior verified snapshot stays visible but inert during routine checks.
  // Initial loads, explicit reloads and failures have no snapshot to show.
  const employees = !state.error ? state.employees : undefined;
  const canEdit = () => visible && navigator.onLine && !blocked && !!employees && !invalidated.current && !controller.current?.signal.aborted;
  const calculationEmployees = employees ? [...employees, ...temporary] : [];
  const groups = groupCalculationParticipants(calculationEmployees);
  const selectedEmployees = calculationEmployees.filter(employee => employee.eligible && selected.has(employee.id));
  const participants: CalculationParticipant[] = [];
  const weightErrors = new Map<string, string>();
  for (const employee of calculationEmployees) {
    if (!employee.eligible) continue;
    const weightText = weightInputs.get(employee.id) ?? employee.weightText;
    try {
      const weightUnits = parseWeightInput(weightText);
      if (selected.has(employee.id)) participants.push({ ...employee, weightText, weightUnits });
    } catch (error) {
      weightErrors.set(employee.id, error instanceof Error ? error.message : 'Invalid share weight.');
    }
  }
  // Display rows retain exact text and errors without supplying fallback financial units.
  const selectedRows = selectedEmployees.map(({ id, name, jobTitle, roleId, isTemporary, weightText }) => ({
    id, name, jobTitle, roleId, isTemporary, weightText: weightInputs.get(id) ?? weightText,
    defaultWeightText: weightText, weightError: weightErrors.get(id),
  }));
  const onWeightChange = (id: string, value: string) => {
    if (!canEdit() || !selectedEmployees.some(employee => employee.id === id)) return;
    setWeightInputs(previous => new Map(previous).set(id, value));
  };
  const onResetWeight = (id: string) => {
    if (!canEdit() || !selectedEmployees.some(employee => employee.id === id)) return;
    setWeightInputs(previous => {
      const next = new Map(previous); next.delete(id); return next;
    });
  };
  const invalidParticipant = selectedEmployees.find(employee => weightErrors.has(employee.id));
  const validationError = saved.reviewRequired ? 'The recovered roster changed. Review participants before calculating.' : invalidParticipant ? `Correct the temporary share weight for ${invalidParticipant.name}.` : undefined;
  return <section aria-label="Shared calculation preview" className="space-y-4 border-t pt-4">
    <h3 className="text-lg font-bold break-words">Restaurant roster · {restaurantName}</h3>
    <p>Choose participants for this calculation. Only active employees with active roles can be selected.</p>
    <p className="text-sm">Temporary share weights are relative shares, not tip percentages. Changes apply to this calculation only.</p>
    <p className="text-sm">Reloading uses the latest defaults, resets temporary weights and clears selections and temporary participants.</p>
    <button className="rounded border border-blue-700 px-4 py-3 disabled:opacity-50" disabled={!visible || accessPending || state.accountChanged} onClick={() => {
      controller.current?.abort();
      snapshot.current = undefined;
      setExpanded(new Set());
      hydrated.current = false;
      // Reload clears participation but retains the existing tip inputs/rounding.
      const fresh = { ...emptyDraft(), cashTip: saved.cashTip, creditTip: saved.creditTip, roundToDollar: saved.roundToDollar };
      clearDraft(fresh);
      updateDraft(fresh);
      setState({ checking: true });
      setReload(value => value + 1);
    }}>Reload roster / clear selection</button>
    {contextWarning && <p role="alert">Calculation source could not be saved. Choose Restaurant roster again after reloading.</p>}
    {draft.message && <p className="text-sm">{draft.message}</p>}
    <button type="button" className="rounded border px-4 py-3" disabled={blocked || !visible} onClick={() => { if (canEdit()) { clearDraft(); setExpanded(new Set()); setFormRevision(value => value + 1); } }}>Discard draft / Start fresh</button>
    {saved.reviewRequired && employees && <div role="alert" className="border border-amber-600 p-3">
      <p>The recovered roster changed. Missing, inactive or changed employees were excluded and their temporary weights removed. Review all participants and current defaults before continuing.</p>
      <button type="button" disabled={blocked || !visible} className="rounded border px-4 py-3" onClick={() => { if (canEdit()) updatePreview(previous => ({ ...previous, reviewRequired: false })); }}>I reviewed the participants</button>
    </div>}
    <p role="status" style={{ visibility: blocked && !state.error ? undefined : 'hidden' }} aria-hidden={!blocked || !!state.error}>Checking calculation access…</p>
    {state.error && <p role="alert">{state.error}</p>}
    <div className="space-y-4" style={{ visibility: !employees || !navigator.onLine || state.accountChanged ? 'hidden' : undefined }} inert={blocked}>
    {employees && <TemporaryParticipantForm key={formRevision} value={saved.form} onChange={form => { if (canEdit()) updatePreview(previous => ({ ...previous, form })); }} disabled={blocked || !visible} onAdd={(name, jobTitle, weightText) => {
        if (!canEdit()) return false;
        const ordinal = 1 + Math.max(0, ...draftRef.current.temporary.map(row => Number(row.id.split(':')[1]) || 0));
        const id = `temporary:${String(ordinal).padStart(6, '0')}:${crypto.randomUUID()}`;
        updatePreview(previous => ({ ...previous, temporary: [...previous.temporary, { id, name, jobTitle, weightText }], selected: [...previous.selected, id] }));
        return true;
      }} />}
    {employees && <>
      <p role="status">{selectedEmployees.length} participants selected for this preview.</p>
      {!employees.length && <p>No shared employees to select.</p>}
      <fieldset className="space-y-2">
        <legend className="font-semibold">Participating employees</legend>
        {groups.map(group => <RoleSection key={group.id} name={group.name}
          selected={group.participants.filter(employee => employee.eligible && selected.has(employee.id)).length}
          eligible={group.participants.filter(employee => employee.eligible).length}
          expanded={expanded.has(group.id)} onToggle={() => {
            if (!canEdit()) return;
            setExpanded(previous => {
              const next = new Set(previous);
              if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
              return next;
            });
          }}>
          {!group.isTemporary && <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-12 rounded border px-4 py-2" onClick={() => {
              if (!canEdit()) return;
              setSelected(previous => new Set([...previous, ...group.participants.filter(employee => employee.eligible).map(employee => employee.id)]));
            }}>Select all eligible</button>
            <button type="button" className="min-h-12 rounded border px-4 py-2" onClick={() => {
              if (!canEdit()) return;
              setSelected(previous => {
                const next = new Set(previous);
                group.participants.forEach(employee => next.delete(employee.id));
                return next;
              });
            }}>Clear selection</button>
          </div>}
          <div className="grid lg:grid-cols-2 gap-2">
          {group.participants.map(employee => {
          const inputId = `${inputPrefix}-${employee.id}`;
          const error = weightErrors.get(employee.id);
          return <div key={employee.id} role="group" aria-label={`${employee.isTemporary ? 'Temporary participant' : 'Shared employee'} ${employee.name}`} className="border rounded p-3 space-y-2 min-w-0 break-words">
            <label className="flex items-start gap-3 min-h-12">
              <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={selected.has(employee.id)} disabled={!employee.eligible}
                onChange={event => {
                  if (!canEdit()) return;
                  const included = event.target.checked;
                  setSelected(previous => {
                    const next = new Set(previous);
                    if (included) next.add(employee.id); else next.delete(employee.id);
                    return next;
                  });
                }} />
              <span className="min-w-0">{employee.name} · {employee.jobTitle}{employee.isTemporary && <span className="ml-2 rounded bg-amber-100 px-2 py-1 text-xs">Temporary</span>}<span id={`${inputId}-default`} className="block text-sm">{employee.isTemporary ? 'Temporary participant · Not saved' : `Permanent default share weight: ${employee.weightText}`}{employee.exclusion && ` · ${employee.exclusion} — excluded`}</span></span>
            </label>
            {employee.eligible && <div className="space-y-2">
              <label htmlFor={inputId} className="block font-semibold text-sm">Temporary share weight · {employee.name}</label>
              <div className="flex flex-wrap gap-2">
                <input id={inputId} type="text" inputMode="decimal" className="w-full sm:w-48 min-h-12 border rounded p-3 text-base"
                  value={weightInputs.get(employee.id) ?? employee.weightText} disabled={blocked || !visible || !selected.has(employee.id)}
                  aria-invalid={!!error} aria-describedby={`${inputId}-default${error ? ` ${inputId}-error` : ''}`}
                  onChange={event => onWeightChange(employee.id, event.target.value)} />
                {employee.isTemporary ? <button type="button" className="min-h-12 rounded border border-red-700 text-red-800 px-4 py-3"
                  aria-label={`Remove temporary participant ${employee.name}`} onClick={() => {
                    if (!canEdit()) return;
                    updatePreview(previous => ({ ...previous, temporary: previous.temporary.filter(row => row.id !== employee.id), selected: previous.selected.filter(id => id !== employee.id), weights: previous.weights.filter(([id]) => id !== employee.id) }));
                  }}>Remove temporary participant</button> : null}
                <button type="button" className="min-h-12 rounded border border-blue-700 px-4 py-3 disabled:opacity-50"
                  aria-label={`Reset ${employee.name} to default`} disabled={blocked || !visible || !selected.has(employee.id)}
                  onClick={() => onResetWeight(employee.id)}>Reset to default</button>
              </div>
              {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-red-700">{error}</p>}
            </div>}
          </div>;
        })}
          </div>
        </RoleSection>)}
      </fieldset>
    </>}
    {employees && !state.error && <Calculator storageKey="" draft={{ value: saved, onChange: change => { if (canEdit()) updatePreview(previous => ({ ...previous, ...change })); } }} shared={{ participants, selectedRows, restaurantName, unavailable: !employees, validationError,
      exclusionDisabled: blocked || !visible, onWeightChange, onResetWeight,
      onExclude: id => {
        if (!canEdit() || !selectedEmployees.some(employee => employee.id === id)) return;
        setSelected(previous => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      },
    }} />}
    </div>
  </section>;
}


function TemporaryParticipantForm({ disabled, onAdd, value, onChange }: {
  value: CalculationDraft['form']; onChange: (form: CalculationDraft['form']) => void;
  disabled: boolean; onAdd: (name: string, jobTitle: string, weightText: string) => boolean;
}) {
  const prefix = useId();
  const { name, jobTitle, weight } = value;
  const [error, setError] = useState<string>();
  return <form aria-label="Add temporary participant" aria-describedby={error ? `${prefix}-error` : undefined} noValidate className="border rounded p-3 space-y-3" onSubmit={event => {
    event.preventDefault();
    if (disabled) return;
    try {
      const trimmedName = name.trim(), trimmedTitle = jobTitle.trim();
      if (!trimmedName || !trimmedTitle || trimmedName.length > 160 || trimmedTitle.length > 100) throw new Error('Enter a name (up to 160 characters) and job title (up to 100 characters).');
      parseWeightInput(weight);
      if (!onAdd(trimmedName, trimmedTitle, weight)) return;
      onChange({ name: '', jobTitle: '', weight: '' }); setError(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to add a temporary participant.'); }
  }}>
    <h4 className="font-semibold">Add temporary participant</h4>
    <p className="text-sm">Included in this calculation only; not added to either roster.</p>
    <div className="grid sm:grid-cols-3 gap-3">
      <div><label className="block text-sm" htmlFor={`${prefix}-name`}>Temporary participant name</label>
        <input id={`${prefix}-name`} type="text" maxLength={160} autoComplete="off" required disabled={disabled} value={name} onChange={event => onChange({ ...value, name: event.target.value })} className="w-full min-h-12 border rounded p-3 text-base" /></div>
      <div><label className="block text-sm" htmlFor={`${prefix}-title`}>Job title / role label</label>
        <input id={`${prefix}-title`} type="text" maxLength={100} autoComplete="off" required disabled={disabled} value={jobTitle} onChange={event => onChange({ ...value, jobTitle: event.target.value })} className="w-full min-h-12 border rounded p-3 text-base" /></div>
      <div><label className="block text-sm" htmlFor={`${prefix}-weight`}>Initial share weight</label>
        <input id={`${prefix}-weight`} type="text" inputMode="decimal" required disabled={disabled} value={weight} onChange={event => onChange({ ...value, weight: event.target.value })} className="w-full min-h-12 border rounded p-3 text-base" /></div>
    </div>
    {error && <p role="alert" id={`${prefix}-error`} className="text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={disabled} className="min-h-12 rounded border border-blue-700 px-4 py-3 disabled:opacity-50">Add temporary participant</button>
  </form>;
}
