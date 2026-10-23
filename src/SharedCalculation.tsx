import { useEffect, useId, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Calculator from './Calculator';
import { loadCalculationRoster } from './sharedCalculationData';
import { parseWeightInput } from './calculation';
import type { CalculationParticipant, SharedCalculationEmployee } from './sharedCalculationData';
import { verifyRosterAccess } from './sharedRosterEditingData';
import { rosterSaveScope } from './sharedRosterSaveScope';

type Props = { client: SupabaseClient; userId: string; organizationId: string; restaurantName: string; accessRevision: number; accessPending: boolean };
type State = { employees?: SharedCalculationEmployee[]; checking: boolean; requestKey?: string; error?: string; accountChanged?: boolean };

export default function SharedCalculation(props: Props) {
  // Include client identity, even if two projects have identical restaurant IDs.
  return <SnapshotCalculator key={rosterSaveScope(props.client, props.userId, props.organizationId).id} {...props} />;
}

function SnapshotCalculator({ client, userId, organizationId, restaurantName, accessRevision, accessPending }: Props) {
  const [reload, setReload] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const [state, setState] = useState<State>({ checking: true });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [weightInputs, setWeightInputs] = useState<Map<string, string>>(() => new Map());
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
        setSelected(new Set());
        setWeightInputs(new Map());
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
        setSelected(new Set());
        setWeightInputs(new Map());
        setState({ checking: false, requestKey, error: 'Shared calculation access or complete roster could not be verified. Reload the roster to retry. The previous preview was cleared.' });
      }
    })();
    return () => active.abort();
  }, [client, userId, organizationId, requestKey]);

  const blocked = accessPending || state.checking || state.requestKey !== requestKey || !navigator.onLine;
  const employees = !blocked && !state.error ? state.employees : undefined;
  const selectedEmployees = employees?.filter(employee => employee.eligible && selected.has(employee.id)) ?? [];
  const participants: CalculationParticipant[] = [];
  const weightErrors = new Map<string, string>();
  for (const employee of employees ?? []) {
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
    <p>Choose participants for this temporary preview. Only active employees with active roles are eligible. Selection does not edit permanent defaults or save a shift or payment.</p>
    <p className="text-sm">Temporary share weights are relative shares, not tip percentages. Changes stay in this preview and do not modify the shared roster in Supabase.</p>
    <p className="text-sm">Defaults stay fixed until you reload. Reloading resets temporary weights to the latest defaults and clears all participant selections. Deselecting excludes an employee from payouts; reselecting keeps their temporary weight in this preview.</p>
    <button className="rounded border border-blue-700 px-4 py-3 disabled:opacity-50" disabled={accessPending || state.accountChanged} onClick={() => {
      controller.current?.abort();
      snapshot.current = undefined;
      setSelected(new Set());
      setWeightInputs(new Map());
      setState({ checking: true });
      setReload(value => value + 1);
    }}>Reload shared roster / clear selection</button>
    {blocked && !state.error && <p role="status">Verifying shared calculation access and loading exact defaults…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {employees && <>
      <p role="status">{selectedEmployees.length} participants selected for this preview.</p>
      {!employees.length ? <p>No shared employees to select.</p> : <fieldset className="space-y-2">
        <legend className="font-semibold">Participating employees</legend>
        {employees.map(employee => {
          const inputId = `${inputPrefix}-${employee.id}`;
          const error = weightErrors.get(employee.id);
          return <div key={employee.id} className="border rounded p-3 space-y-3 break-words">
            <label className="flex items-start gap-3 min-h-12">
              <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={selected.has(employee.id)} disabled={!employee.eligible}
                onChange={event => {
                  const included = event.target.checked;
                  setSelected(previous => {
                    const next = new Set(previous);
                    if (included) next.add(employee.id); else next.delete(employee.id);
                    return next;
                  });
                }} />
              <span className="min-w-0">{employee.name} · {employee.jobTitle}<span id={`${inputId}-default`} className="block text-sm">Permanent default share weight: {employee.weightText}{employee.exclusion && ` · ${employee.exclusion} — excluded`}</span></span>
            </label>
            {employee.eligible && <div className="space-y-2">
              <label htmlFor={inputId} className="block font-semibold text-sm">Temporary share weight · {employee.name}</label>
              <div className="flex flex-wrap gap-2">
                <input id={inputId} type="text" inputMode="decimal" className="w-full sm:w-48 min-h-12 border rounded p-3 text-base"
                  value={weightInputs.get(employee.id) ?? employee.weightText} disabled={!selected.has(employee.id)}
                  aria-invalid={!!error} aria-describedby={`${inputId}-default${error ? ` ${inputId}-error` : ''}`}
                  onChange={event => {
                    const value = event.target.value;
                    setWeightInputs(previous => new Map(previous).set(employee.id, value));
                  }} />
                <button type="button" className="min-h-12 rounded border border-blue-700 px-4 py-3 disabled:opacity-50"
                  aria-label={`Reset ${employee.name} to default`} disabled={!selected.has(employee.id)}
                  onClick={() => setWeightInputs(previous => {
                    const next = new Map(previous);
                    next.delete(employee.id);
                    return next;
                  })}>Reset to default</button>
              </div>
              {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-red-700">{error}</p>}
            </div>}
          </div>;
        })}
      </fieldset>}
    </>}
    {!state.error && <Calculator storageKey="" shared={{ participants, restaurantName, unavailable: !employees, validationError }} />}
  </section>;
}
