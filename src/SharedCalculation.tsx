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

type Props = { client: SupabaseClient; userId: string; organizationId: string; restaurantName: string; accessRevision: number; accessPending: boolean; visible?: boolean };
type State = { employees?: SharedCalculationEmployee[]; checking: boolean; requestKey?: string; error?: string; accountChanged?: boolean };

export default function SharedCalculation(props: Props) {
  // Include client identity, even if two projects have identical restaurant IDs.
  return <SnapshotCalculator key={rosterSaveScope(props.client, props.userId, props.organizationId).id} {...props} />;
}

function SnapshotCalculator({ client, userId, organizationId, restaurantName, accessRevision, accessPending, visible = true }: Props) {
  const [reload, setReload] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const [state, setState] = useState<State>({ checking: true });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [weightInputs, setWeightInputs] = useState<Map<string, string>>(() => new Map());
  const [temporary, setTemporary] = useState<SharedCalculationEmployee[]>([]);
  const nextTemporaryId = useRef(0);
  const inputPrefix = useId();
  const controller = useRef<AbortController | undefined>(undefined);
  const snapshot = useRef<SharedCalculationEmployee[] | undefined>(undefined);
  const invalidated = useRef(false);
  const requestKey = `${reload}:${authRevision}:${accessRevision}`;

  useEffect(() => {
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      controller.current?.abort();
      if (!session || session.user.id !== userId) {
        invalidated.current = true;
        snapshot.current = undefined;
        setExpanded(new Set());
        setSelected(new Set());
        setWeightInputs(new Map());
        setTemporary([]);
        setState({ checking: false, accountChanged: true, error: 'Your account changed. Sign in again to continue.' });
      } else {
        invalidated.current = false;
        setState(previous => ({ ...previous, checking: true }));
        // SDK reads happen in the effect, outside the synchronous Auth callback.
        setAuthRevision(value => value + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, [client, userId]);

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
        snapshot.current = employees;
        setState({ employees, checking: false, requestKey });
      } catch {
        if (active.signal.aborted || invalidated.current) return;
        snapshot.current = undefined;
        setExpanded(new Set());
        setSelected(new Set());
        setWeightInputs(new Map());
        setTemporary([]);
        setState({ checking: false, requestKey, error: 'Shared calculation access or complete roster could not be verified. Reload the roster to retry. The previous preview was cleared.' });
      }
    })();
    return () => active.abort();
  }, [client, userId, organizationId, requestKey]);

  const blocked = accessPending || state.checking || state.requestKey !== requestKey || !navigator.onLine;
  // Keep the verified snapshot's DOM and dimensions during routine checks.
  // A prior verified snapshot stays visible but inert during routine checks.
  // Initial loads, explicit reloads and failures have no snapshot to show.
  const employees = !state.error ? state.employees : undefined;
  const canEdit = () => visible && !blocked && !!employees && !invalidated.current && !controller.current?.signal.aborted;
  const calculationEmployees = employees ? [...employees, ...temporary] : [];
  const groups = groupCalculationParticipants(calculationEmployees);
  const selectedEmployees = calculationEmployees.filter(employee => employee.eligible && selected.has(employee.id));
  // Display rows retain exact text even when no valid financial participant exists.
  const selectedRows = selectedEmployees.map(({ id, name, jobTitle, roleId, isTemporary, weightText }) => ({
    id, name, jobTitle, roleId, isTemporary, weightText: weightInputs.get(id) ?? weightText,
  }));
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
  const invalidParticipant = selectedEmployees.find(employee => weightErrors.has(employee.id));
  const validationError = invalidParticipant ? `Correct the temporary share weight for ${invalidParticipant.name}.` : undefined;
  return <section aria-label="Shared calculation preview" className="space-y-4 border-t pt-4">
    <h3 className="text-lg font-bold break-words">Restaurant shared roster · {restaurantName}</h3>
    <p>Choose participants for this temporary preview. Shared employees need active records and roles. One-time temporary participants need no shared employee or job role. Selection does not edit permanent defaults or save a shift or payment.</p>
    <p className="text-sm">Temporary share weights are relative shares, not tip percentages. Changes stay in this preview and do not modify the shared roster in Supabase.</p>
    <p className="text-sm">Defaults stay fixed until you reload. Reloading resets temporary weights to the latest defaults and clears all participant selections and temporary participants. Deselecting excludes an employee from payouts; reselecting keeps their temporary weight in this preview.</p>
    <button className="rounded border border-blue-700 px-4 py-3 disabled:opacity-50" disabled={!visible || accessPending || state.accountChanged} onClick={() => {
      controller.current?.abort();
      snapshot.current = undefined;
      setExpanded(new Set());
      setSelected(new Set());
      setWeightInputs(new Map());
      setTemporary([]);
      setState({ checking: true });
      setReload(value => value + 1);
    }}>Reload shared roster / clear selection</button>
    <p role="status" style={{ visibility: blocked && !state.error ? undefined : 'hidden' }} aria-hidden={!blocked || !!state.error}>Verifying shared calculation access and loading exact defaults…</p>
    {state.error && <p role="alert">{state.error}</p>}
    <div className="space-y-4" style={{ visibility: !employees || !navigator.onLine || state.accountChanged ? 'hidden' : undefined }} inert={blocked}>
    {employees && <TemporaryParticipantForm disabled={blocked || !visible} onAdd={(name, jobTitle, weightText, weightUnits) => {
        if (!canEdit()) return false;
        const id = `temporary:${inputPrefix}:${nextTemporaryId.current++}`;
        setTemporary(previous => [...previous, { id, name, jobTitle, weightText, weightUnits, eligible: true, isTemporary: true }]);
        setSelected(previous => new Set(previous).add(id));
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
              <span className="min-w-0">{employee.name} · {employee.jobTitle}{employee.isTemporary && <span className="ml-2 rounded bg-amber-100 px-2 py-1 text-xs">Temporary</span>}<span id={`${inputId}-default`} className="block text-sm">{employee.isTemporary ? 'One-time participant · not in shared roster' : `Permanent default share weight: ${employee.weightText}`}{employee.exclusion && ` · ${employee.exclusion} — excluded`}</span></span>
            </label>
            {employee.eligible && <div className="space-y-2">
              <label htmlFor={inputId} className="block font-semibold text-sm">Temporary share weight · {employee.name}</label>
              <div className="flex flex-wrap gap-2">
                <input id={inputId} type="text" inputMode="decimal" className="w-full sm:w-48 min-h-12 border rounded p-3 text-base"
                  value={weightInputs.get(employee.id) ?? employee.weightText} disabled={!selected.has(employee.id)}
                  aria-invalid={!!error} aria-describedby={`${inputId}-default${error ? ` ${inputId}-error` : ''}`}
                  onChange={event => {
                    if (!canEdit()) return;
                    const value = event.target.value;
                    setWeightInputs(previous => new Map(previous).set(employee.id, value));
                  }} />
                {employee.isTemporary ? <button type="button" className="min-h-12 rounded border border-red-700 text-red-800 px-4 py-3"
                  aria-label={`Remove temporary participant ${employee.name}`} onClick={() => {
                    if (!canEdit()) return;
                    setTemporary(previous => previous.filter(row => row.id !== employee.id));
                    setSelected(previous => {
                      const next = new Set(previous); next.delete(employee.id); return next;
                    });
                    setWeightInputs(previous => {
                      const next = new Map(previous); next.delete(employee.id); return next;
                    });
                  }}>Remove temporary participant</button> : <button type="button" className="min-h-12 rounded border border-blue-700 px-4 py-3 disabled:opacity-50"
                  aria-label={`Reset ${employee.name} to default`} disabled={!selected.has(employee.id)}
                  onClick={() => {
                    if (!canEdit()) return;
                    setWeightInputs(previous => {
                      const next = new Map(previous);
                      next.delete(employee.id);
                      return next;
                    });
                  }}>Reset to default</button>}
              </div>
              {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-red-700">{error}</p>}
            </div>}
          </div>;
        })}
          </div>
        </RoleSection>)}
      </fieldset>
    </>}
    {!state.error && <Calculator storageKey="" shared={{ participants, selectedRows, restaurantName, unavailable: !employees, validationError,
      exclusionDisabled: blocked || !visible,
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


function TemporaryParticipantForm({ disabled, onAdd }: {
  disabled: boolean; onAdd: (name: string, jobTitle: string, weightText: string, weightUnits: number) => boolean;
}) {
  const prefix = useId();
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [weight, setWeight] = useState('');
  const [error, setError] = useState<string>();
  return <form aria-label="Add temporary participant" aria-describedby={error ? `${prefix}-error` : undefined} noValidate className="border rounded p-3 space-y-3" onSubmit={event => {
    event.preventDefault();
    if (disabled) return;
    try {
      const trimmedName = name.trim(), trimmedTitle = jobTitle.trim();
      if (!trimmedName || !trimmedTitle || trimmedName.length > 160 || trimmedTitle.length > 100) throw new Error('Enter a name (up to 160 characters) and job title (up to 100 characters).');
      const weightUnits = parseWeightInput(weight);
      if (!onAdd(trimmedName, trimmedTitle, weight, weightUnits)) return;
      setName(''); setJobTitle(''); setWeight(''); setError(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to add a temporary participant.'); }
  }}>
    <h4 className="font-semibold">Add temporary participant</h4>
    <p className="text-sm">One-time entries stay in this restaurant preview only. They are never saved to the shared roster or this browser’s local roster. New entries start included.</p>
    <div className="grid sm:grid-cols-3 gap-3">
      <div><label className="block text-sm" htmlFor={`${prefix}-name`}>Temporary participant name</label>
        <input id={`${prefix}-name`} type="text" maxLength={160} autoComplete="off" required disabled={disabled} value={name} onChange={event => setName(event.target.value)} className="w-full min-h-12 border rounded p-3 text-base" /></div>
      <div><label className="block text-sm" htmlFor={`${prefix}-title`}>Job title / role label</label>
        <input id={`${prefix}-title`} type="text" maxLength={100} autoComplete="off" required disabled={disabled} value={jobTitle} onChange={event => setJobTitle(event.target.value)} className="w-full min-h-12 border rounded p-3 text-base" /></div>
      <div><label className="block text-sm" htmlFor={`${prefix}-weight`}>Initial share weight</label>
        <input id={`${prefix}-weight`} type="text" inputMode="decimal" required disabled={disabled} value={weight} onChange={event => setWeight(event.target.value)} className="w-full min-h-12 border rounded p-3 text-base" /></div>
    </div>
    {error && <p role="alert" id={`${prefix}-error`} className="text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={disabled} className="min-h-12 rounded border border-blue-700 px-4 py-3 disabled:opacity-50">Add temporary participant</button>
  </form>;
}
