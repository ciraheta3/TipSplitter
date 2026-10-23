import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Calculator from './Calculator';
import { loadCalculationRoster } from './sharedCalculationData';
import type { SharedCalculationEmployee } from './sharedCalculationData';
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
        setState({ checking: false, requestKey, error: 'Shared calculation access or complete roster could not be verified. Reload the roster to retry. The previous preview was cleared.' });
      }
    })();
    return () => active.abort();
  }, [client, userId, organizationId, requestKey]);

  const blocked = accessPending || state.checking || state.requestKey !== requestKey || !navigator.onLine;
  const employees = !blocked && !state.error ? state.employees : undefined;
  const participants = employees?.filter(employee => employee.eligible && selected.has(employee.id)) ?? [];
  return <section aria-label="Shared calculation preview" className="space-y-4 border-t pt-4">
    <h3 className="text-lg font-bold break-words">Restaurant shared roster · {restaurantName}</h3>
    <p>Choose participants for this temporary preview. Only active employees with active roles are eligible. Selection does not edit permanent defaults or save a shift or payment.</p>
    <p className="text-sm">Defaults stay fixed until you reload. Reloading replaces the snapshot and clears all participant selections.</p>
    <button className="rounded border border-blue-700 px-4 py-3 disabled:opacity-50" disabled={accessPending || state.accountChanged} onClick={() => {
      controller.current?.abort();
      snapshot.current = undefined;
      setSelected(new Set());
      setState({ checking: true });
      setReload(value => value + 1);
    }}>Reload shared roster / clear selection</button>
    {blocked && !state.error && <p role="status">Verifying shared calculation access and loading exact defaults…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {employees && <>
      <p role="status">{participants.length} participants selected for this preview.</p>
      {!employees.length ? <p>No shared employees to select.</p> : <fieldset className="space-y-2">
        <legend className="font-semibold">Participating employees</legend>
        {employees.map(employee => <label key={employee.id} className="flex items-start gap-3 border rounded p-3 min-h-12 break-words">
          <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={selected.has(employee.id)} disabled={!employee.eligible}
            onChange={event => {
              const included = event.target.checked;
              setSelected(previous => {
                const next = new Set(previous);
                if (included) next.add(employee.id); else next.delete(employee.id);
                return next;
              });
            }} />
          <span className="min-w-0">{employee.name} · {employee.jobTitle}<span className="block text-sm">Effective default share weight: {employee.weightText}{employee.exclusion && ` · ${employee.exclusion} — excluded`}</span></span>
        </label>)}
      </fieldset>}
    </>}
    {!state.error && <Calculator storageKey="" shared={{ participants, restaurantName, unavailable: !employees }} />}
  </section>;
}
