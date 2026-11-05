import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accessChanged, readOrganizations, readSharedRoster, SharedRosterAccessError, SharedRosterError } from './sharedRosterData';
import type { Organization, SharedRosterData } from './sharedRosterData';
import ManageSharedRoster from './ManageSharedRoster';
import SharedCalculation from './SharedCalculation';
import { rosterSaveScope } from './sharedRosterSaveScope';

const buttonClass = 'rounded border border-blue-700 text-blue-800 px-4 py-2 disabled:opacity-50';
type Props = { client: SupabaseClient; userId: string; calculationMode?: boolean; management?: boolean; onManagementChange?: (open: boolean) => void; calculatorControls?: ReactNode };
type State = {
  organizations: Organization[];
  selected: string;
  loading: boolean;
  error?: string;
  roster?: SharedRosterData;
  revision?: number;
};

// Mounted only below the verified Auth gate and keyed there by project/account.
export default function SharedRoster({ client, userId, calculationMode = false, management, onManagementChange, calculatorControls }: Props) {
  const [selection, setSelection] = useState('');
  const [ownManagement, setOwnManagement] = useState(false);
  const manage = management ?? ownManagement;
  const setManage = onManagementChange ?? setOwnManagement;
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    const refreshAccess = () => setRevision(value => value + 1);
    const visible = () => { if (document.visibilityState === 'visible') refreshAccess(); };
    const timer = setInterval(refreshAccess, 60_000);
    window.addEventListener('focus', refreshAccess);
    window.addEventListener('online', refreshAccess);
    window.addEventListener('offline', refreshAccess);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshAccess);
      window.removeEventListener('online', refreshAccess);
      window.removeEventListener('offline', refreshAccess);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return <section aria-labelledby="shared-roster-title" className="max-w-6xl mx-auto my-6 p-4 sm:p-6 bg-white border rounded-xl space-y-4">
    <h2 id="shared-roster-title" className="text-xl font-bold">Restaurant workspace</h2>
    <button className={buttonClass} onClick={refresh}>Refresh access / retry</button>
    <RosterRequest key={rosterSaveScope(client, userId, selection).id} client={client} userId={userId} calculationMode={calculationMode} management={manage} onManagementChange={setManage} calculatorControls={calculatorControls} onAccessUnavailable={refresh} selection={selection} onSelect={setSelection} revision={revision} />
  </section>;
}

function RosterRequest({ client, userId, calculationMode, management: manage = false, onManagementChange: setManage = () => {}, selection, onSelect, revision, calculatorControls, onAccessUnavailable }: Props & { onAccessUnavailable: () => void; selection: string; onSelect: (id: string) => void; revision: number }) {
  const [state, setState] = useState<State>({ organizations: [], selected: '', loading: true });
  const preferred = useRef(selection);
  const viewHeading = useRef<HTMLHeadingElement>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const previousView = useRef(manage);
  useEffect(() => {
    if (manage) viewHeading.current?.focus();
    else if (previousView.current) entry.current?.focus();
    previousView.current = manage;
  }, [manage]);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void (async () => {
      try {
        if (!navigator.onLine) throw new SharedRosterError('You are offline. Reconnect and retry shared roster access.');
        const organizations = await readOrganizations(client, userId, controller.signal);
        if (!current) return;
        const selected = selection || preferred.current || (organizations.length === 1 ? organizations[0].id : '');
        if (selected && !organizations.some(org => org.id === selected)) {
          setState({ organizations, selected: '', loading: false, error: organizations.length ? accessChanged : undefined, revision });
          return;
        }
        if (!selected) {
          setState({ organizations, selected, loading: false, revision });
          return;
        }
        preferred.current = selected;
        // Keep the same authorized management subtree mounted during a check.
        // Keep the previous verified snapshot mounted during a routine check.
        setState(previous => ({ organizations, selected, loading: true, roster: previous.roster, revision }));
        try {
          const roster = await readSharedRoster(client, userId, selected, controller.signal);
          if (current) setState({ organizations, selected, loading: false, roster, revision });
        } catch (error) {
          // Membership verification failures still reach the fail-closed handler.
          // Only roster failures retain this request's freshly verified options,
          // never the failed roster or its management subtree/draft.
          if (error instanceof SharedRosterAccessError) throw error;
          if (current) setState({ organizations, selected, loading: false, revision,
            error: error instanceof SharedRosterError
              ? error.message : 'Unable to load shared data. Check your connection and retry.' });
        }
      } catch (error) {
        if (current) {
          setState({ organizations: [], selected: '', loading: false, revision,
          error: error instanceof SharedRosterError
            ? error.message : 'Unable to load shared data. Check your connection and retry.' });
        }
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [client, userId, selection, revision]);

  const loading = state.loading || state.revision !== revision;
  const roster = navigator.onLine && !state.error ? state.roster : undefined;
  return <div className="space-y-4">
    {state.organizations.length > 1 || (state.error && state.organizations.length > 0) ? <div>
      <label htmlFor="shared-organization" className="block font-semibold">Restaurant</label>
      <select disabled={manage && !!roster} id="shared-organization" className="w-full sm:w-auto max-w-full border rounded p-2" value={state.selected} onChange={event => {
        if (manage && roster) return;
        setManage(false);
        onSelect(event.target.value);
      }}>
        {!state.selected && <option value="" disabled>Select a restaurant</option>}
        {state.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select>
    </div> : state.selected && <p className="font-semibold break-words">Restaurant: {state.organizations.find(org => org.id === state.selected)?.name}</p>}
    {manage && state.organizations.length > 1 && <p>Back to calculator before changing restaurants. Any open draft must be discarded explicitly.</p>}
    <p role="status" style={{ visibility: loading ? undefined : 'hidden' }} aria-hidden={!loading}>Checking restaurant access…</p>
    {state.error && <p role="alert">{state.error}{manage && ' Management is unavailable and any unsaved draft was cleared because access could not be verified.'}</p>}
    {!loading && !state.error && state.organizations.length > 1 && !state.selected && <p>Select a restaurant to continue.</p>}
    {!loading && !state.error && !state.organizations.length && <div>
      <h3 className="font-semibold">No restaurant access assigned</h3>
      <p>Contact the project owner for access. You can continue using the local calculator.</p>
      {manage && <p>Management is unavailable and any unsaved draft was cleared because restaurant access changed.</p>}
    </div>}
    {manage && <h2 ref={viewHeading} tabIndex={-1} className="text-2xl font-bold">Manage roster</h2>}
    {manage && !roster && <button className={buttonClass} onClick={() => setManage(false)}>Back to calculator</button>}
    {!manage && roster && <button ref={entry} className={buttonClass} disabled={!roster || loading} onClick={() => {
      if (roster && !loading) setManage(true);
    }}>Manage roster</button>}
    {!manage && !roster && !loading && <p>Roster management is unavailable until access to a selected restaurant is verified.</p>}
    <div hidden={manage} inert={manage}>{calculatorControls}</div>
    {/* View navigation never changes calculationMode or its scope. The mounted
        calculator continues verification and clears protected data on failure. */}
    {calculationMode && roster && <div hidden={manage} inert={manage}>
      <SharedCalculation client={client} userId={userId} organizationId={state.selected} restaurantName={state.organizations.find(org => org.id === state.selected)!.name} accessRevision={revision} accessPending={loading} visible={!manage} />
    </div>}
    {manage && roster && <ManageSharedRoster client={client} userId={userId} organizationId={state.selected} refreshRevision={revision} closeLabel="Back to calculator" onAccessUnavailable={onAccessUnavailable} onClose={() => setManage(false)} />}

  </div>;
}
