import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { editingSnapshotRemaining, loadEditingRoster, RosterEditError, RosterSnapshotExpiredError, saveRosterDraft } from './sharedRosterEditingData';
import type { EditEmployee, EditRole, EditSnapshot, RosterDraft } from './sharedRosterEditingData';
import { sharedWeightInput } from './sharedRosterWeights';
import { rosterSaveScope } from './sharedRosterSaveScope';

const button = 'rounded border border-blue-700 text-blue-800 px-3 py-2 disabled:opacity-50';
type Editor = ({ kind: 'role'; row?: EditRole } | { kind: 'employee'; row?: EditEmployee }) & { snapshot: EditSnapshot; conflict?: boolean };
type State = { loading: boolean; snapshot?: EditSnapshot; error?: string; saving?: boolean; message?: string; requestKey?: string; unverified?: boolean };
type Props = { client: SupabaseClient; userId: string; organizationId: string; onClose: () => void; refreshRevision?: number; closeLabel?: string; onAccessUnavailable?: () => void };

export default function ManageSharedRoster(props: Props) {
  const scope = rosterSaveScope(props.client, props.userId, props.organizationId);
  // Also isolate direct prop switches, independent of the Auth/parent keys.
  return <RosterManager key={scope.id} {...props} scope={scope} />;
}

function RosterManager({ client, userId, organizationId, onClose, refreshRevision, closeLabel = 'Close management', onAccessUnavailable, scope }: Props & { scope: ReturnType<typeof rosterSaveScope> }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ loading: true });
  const [editor, setEditor] = useState<Editor>();
  const [leaving, setLeaving] = useState(false);
  const reportedFailure = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const saveState = useSyncExternalStore(scope.subscribe, scope.getSnapshot);
  const inspection = useRef<ReturnType<typeof scope.getSnapshot>>(null);
  const validation = useRef(false);
  const accountInvalidated = useRef(false);
  const requestKey = `${revision}:${refreshRevision}`;
  const checking = state.loading || (!state.unverified && state.requestKey !== requestKey);
  const refresh = useCallback((discard = false) => {
    if (accountInvalidated.current) return;
    scope.interrupt();
    controller.current?.abort();
    inspection.current = null;
    validation.current = false;
    // A pending mutation is never a draft we can safely preserve/resubmit.
    if (discard || scope.getSnapshot()) setEditor(undefined);
    setState(previous => discard ? { loading: true } : { ...previous, loading: true, saving: false, error: undefined, message: undefined });
    setRevision(value => value + 1);
  }, [scope]);
  const reset = () => { setLeaving(false); refresh(true); };
  const revalidate = () => { refresh(); validation.current = true; };
  const inspect = () => {
    reset();
    // Only this explicit action can qualify a read for acknowledgment. An
    // automatic/reset read may race ahead of a mutation and proves no rollback.
    inspection.current = scope.getSnapshot();
  };
  useEffect(() => {
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== userId) {
        accountInvalidated.current = true;
        // Do not let a stale getSession/read resurrect a signed-out/other user.
        scope.interrupt();
        controller.current?.abort();
        inspection.current = null;
        validation.current = false;
        setEditor(undefined);
        setState({ loading: false, unverified: true, error: 'Your account changed. Refresh access before editing.' });
      } else { accountInvalidated.current = false; refresh(); }
    });
    return () => subscription.unsubscribe();
  }, [client, userId, refresh, scope]);
  useEffect(() => {
    // SharedRoster supplies these events in normal use. Keep standalone manager
    // access checks active as well, without a second parent/child interval.
    if (refreshRevision !== undefined) return;
    const check = () => refresh();
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    const timer = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refreshRevision, refresh]);
  useEffect(() => {
    if (accountInvalidated.current) return;
    const active = new AbortController();
    controller.current = active;
    const inspecting = inspection.current;
    inspection.current = null;
    const validating = validation.current;
    validation.current = false;
    const interruptedSave = !!scope.getSnapshot();
    void loadEditingRoster(client, userId, organizationId, active.signal).then(snapshot => {
      if (!active.signal.aborted && !accountInvalidated.current) {
        setEditor(previous => {
          if (interruptedSave) return undefined;
          if (!previous) return previous;
          const row = previous.kind === 'role' ? snapshot.roles.find(row => row.id === previous.row?.id)
            : snapshot.employees.find(row => row.id === previous.row?.id);
          const conflict = previous.conflict || !!(previous.row && (!row || Object.entries(previous.row).some(([field, value]) => row[field as keyof typeof row] !== value)));
          // Background reads do not extend the draft's write deadline. Only an
          // explicit successful revalidation of an unchanged target can do so.
          return conflict ? { ...previous, conflict: true } : validating ? { ...previous, snapshot } : previous;
        });
        setState({ loading: false, snapshot, requestKey });
        if (inspecting) scope.inspected(inspecting);
      }
    }).catch(error => {
      if (!active.signal.aborted && !accountInvalidated.current) {
        setEditor(undefined);
        setState({ loading: false, requestKey, error: error instanceof RosterEditError ? error.message : 'Unable to verify shared roster access. Refresh access to retry.' });
      }
    });
    return () => { scope.interrupt(); active.abort(); };
  }, [client, userId, organizationId, requestKey, scope]);
  useEffect(() => {
    if (!editor) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editor]);
  useEffect(() => {
    // Independently failed manager verification also invalidates the parent's
    // hidden preview. Report once per mount to avoid a failed-read retry loop.
    if (state.error && !state.snapshot && !reportedFailure.current) {
      reportedFailure.current = true;
      onAccessUnavailable?.();
    }
  }, [state.error, state.snapshot, onAccessUnavailable]);
  const basis = editor?.snapshot ?? state.snapshot;
  useEffect(() => {
    if (!basis) return;
    const remaining = editingSnapshotRemaining(basis);
    if (!remaining) return;
    const expiry = setTimeout(() => refresh(), remaining);
    return () => clearTimeout(expiry);
  }, [basis, refresh]);

  const save = async (draft: RosterDraft, id?: string) => {
    const active = controller.current;
    const snapshot = editor?.snapshot;
    if (!active || active.signal.aborted || !snapshot || checking || editor?.conflict) return;
    if (!editingSnapshotRemaining(snapshot)) { refresh(); return; }
    const attempt = scope.begin();
    if (!attempt) return;
    let confirmed = false;
    setState(previous => ({ ...previous, saving: true, error: undefined, message: undefined }));
    try {
      await saveRosterDraft(client, userId, organizationId, active.signal, snapshot, draft, id, () => scope.dispatch(attempt));
      confirmed = true;
      scope.confirm(attempt);
      const fresh = await loadEditingRoster(client, userId, organizationId, active.signal);
      if (!active.signal.aborted && !scope.getSnapshot()?.recovery) {
        scope.clear(attempt);
        setEditor(undefined);
        setState({ loading: false, snapshot: fresh, requestKey, message: 'Save confirmed. Shared roster refreshed.' });
      } else if (!active.signal.aborted) {
        setEditor(undefined);
        setState({ loading: false, snapshot: fresh, requestKey });
      }
    } catch (error) {
      const uncertain = confirmed || (scope.wasDispatched(attempt)
        && (active.signal.aborted || !(error instanceof RosterEditError) || error.uncertain));
      if (uncertain) scope.requireInspection(attempt);
      else scope.clear(attempt);
      if (!active.signal.aborted) {
        const retry = !uncertain && error instanceof RosterEditError && (!error.reload || error instanceof RosterSnapshotExpiredError);
        if (!retry) setEditor(undefined);
        setState({ loading: false, requestKey, snapshot: retry ? snapshot : undefined,
          error: uncertain || error instanceof RosterSnapshotExpiredError ? undefined : error instanceof RosterEditError ? error.message : 'Unable to save. Refresh access before editing.' });
      }
    } finally { scope.settle(attempt); }
  };
  const snapshot = state.snapshot;
  const busy = !!saveState || !!state.saving;
  const blocked = busy || checking || !snapshot || !editingSnapshotRemaining(snapshot);
  const expired = !!editor && !editingSnapshotRemaining(editor.snapshot);
  const navigationBlocked = !!state.saving || !!saveState?.pending;
  const recovery = !state.unverified && saveState?.recovery;
  return <section aria-label="Manage shared roster · DEV" className="space-y-4">
    <h3 className="text-lg font-bold">Manage shared roster · DEV</h3>
    <p>Permanent default share weights, not fixed percentages or today’s shift participation. Shared records never enter the browser-local calculator.</p>
    <p className="text-sm">Draft input stays open during routine access checks. Editing snapshots expire after one minute: revalidate before saving an expired draft. Cancel, reload/discard or close intentionally discards the draft; failed access verification also clears it. An interrupted request may still commit; inspect the roster before repeating an addition, even after restarting the page.</p>
    <div className="flex flex-wrap gap-2">
      <button className={button} onClick={reset}>Reload management / discard draft</button>
      <button className={button} disabled={navigationBlocked} onClick={() => {
        if (!navigationBlocked) { if (editor) setLeaving(true); else onClose(); }
      }}>{closeLabel}</button>
    </div>
    {leaving && editor && <div role="alert" className="border rounded p-4 space-y-3">
      <p>Discard the unsaved management draft and return to the calculator?</p>
      <button className={button} onClick={() => setLeaving(false)}>Keep editing</button>
      <button className={button} disabled={navigationBlocked} onClick={() => { if (!navigationBlocked) onClose(); }}>Discard draft and return</button>
    </div>}
    {checking && <p role="status">Verifying access and exact shared defaults…</p>}
    {state.saving && <p role="status">Saving shared roster…</p>}
    {state.message && <p role="status">{state.message}</p>}
    {recovery && saveState && <div role="alert" className="border rounded p-3 space-y-2">
      <p>{saveState.confirmed
        ? 'Save was confirmed, but the roster refresh did not complete. Do not repeat the write.'
        : 'Save could not be confirmed. It may have committed even though the request was cancelled or failed.'}</p>
      <p>Reloading does not prove the write failed. A slow write may appear later. Inspect the current roster and acknowledge what you found before making another change; do not repeat an addition just because it is absent.</p>
      {saveState.pending && <p>The earlier save is still settling. New writes remain blocked.</p>}
      <button className={button} disabled={saveState.pending || checking} onClick={inspect}>Inspect current roster</button>
      {saveState.inspected && snapshot && <button className={button} onClick={() => {
        if (!checking && !controller.current?.signal.aborted && snapshot && editingSnapshotRemaining(snapshot) && scope.acknowledge()) {
          setState(previous => ({ ...previous, message: 'Inspection acknowledged. No write was retried.' }));
        }
      }}>I inspected the roster; allow new edits</button>}
      {state.error && <p>{state.error}</p>}
    </div>}
    {state.error && !recovery && <p role="alert">{state.error}</p>}
    {state.error && !snapshot && !recovery && <p>Any unsaved draft was cleared because access or shared data could not be verified.</p>}
    {snapshot && <>
      <div className="grid sm:grid-cols-2 gap-6">
        <div className="space-y-3"><h4 className="font-semibold">Manage job roles</h4>
          <button className={button} disabled={blocked || !!editor} onClick={() => setEditor({ kind: 'role', snapshot })}>Add shared job role</button>
          {!snapshot.roles.length && <p>No shared job roles.</p>}
          <ul className="space-y-3">{snapshot.roles.map(row => <li key={row.id} className="break-words border rounded p-3">
            <p>{row.name} · {row.is_active ? 'Active' : 'Inactive'}</p><p>Default share weight: {row.default_weight}</p>
            <button className={button} disabled={blocked || !!editor} aria-label={`Edit shared role ${row.name}`} onClick={() => setEditor({ kind: 'role', row, snapshot })}>Edit / activate / deactivate</button>
          </li>)}</ul>
        </div>
        <div className="space-y-3"><h4 className="font-semibold">Manage employees</h4>
          <button className={button} disabled={blocked || !!editor || !snapshot.roles.some(row => row.is_active)} onClick={() => setEditor({ kind: 'employee', snapshot })}>Add shared employee</button>
          {!snapshot.roles.some(row => row.is_active) && <p>Add or activate a role before adding an employee.</p>}
          {!snapshot.employees.length && <p>No shared employees.</p>}
          <ul className="space-y-3">{snapshot.employees.map(row => {
            const role = snapshot.roles.find(role => role.id === row.default_role_id)!;
            const source = row.default_weight_override === null ? 'Inherited from role'
              : sharedWeightInput(row.default_weight_override) === '0.00' ? 'Explicit zero override' : 'Employee override';
            return <li key={row.id} className="break-words border rounded p-3">
              <p>{row.name} · {row.is_active ? 'Active' : 'Inactive'}</p>
              <p>Default role: {role.name} · {role.is_active ? 'Active' : 'Inactive'}</p>
              <p>Effective default share weight: {row.default_weight_override ?? role.default_weight} · {source}</p>
              <button className={button} disabled={blocked || !!editor} aria-label={`Edit shared employee ${row.name}`} onClick={() => setEditor({ kind: 'employee', row, snapshot })}>Edit / activate / deactivate</button>
            </li>;
          })}</ul>
        </div>
      </div>
      {editor && !saveState?.recovery && <>
        {editor.conflict ? <p role="alert">This record changed or is no longer available. Your input is preserved. Cancel this draft and reopen the current record before saving.</p>
          : expired && <p role="alert">This editing snapshot expired. Your input is preserved; revalidate the draft before saving.</p>}
        <button className={button} disabled={busy || checking || !!editor.conflict} onClick={revalidate}>Revalidate draft</button>
        <RosterForm key={`${editor.kind}:${editor.row?.id ?? 'new'}`} editor={editor} snapshot={snapshot} busy={busy} saveBlocked={blocked || expired || !!editor.conflict}
          onSave={(draft, id) => void save(draft, id)} onCancel={() => { setLeaving(false); setEditor(undefined); }} />
      </>}
    </>}
  </section>;
}

function RosterForm({ editor, snapshot, busy, saveBlocked, onSave, onCancel }: {
  editor: Editor; snapshot: EditSnapshot; busy: boolean; saveBlocked: boolean; onSave: (draft: RosterDraft, id?: string) => void; onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(editor.row?.name ?? '');
  const [active, setActive] = useState(editor.row?.is_active ?? true);
  const [weight, setWeight] = useState(editor.kind === 'role' ? editor.row?.default_weight ?? '' : editor.row?.default_weight_override ?? '');
  const [roleId, setRoleId] = useState(editor.kind === 'employee' ? editor.row?.default_role_id ?? '' : '');
  const existingRole = editor.kind === 'employee' ? editor.row?.default_role_id : undefined;
  return <form aria-label={`${editor.row ? 'Edit' : 'Add'} shared ${editor.kind === 'role' ? 'job role' : 'employee'}`} className="border rounded p-4 space-y-4" onSubmit={event => {
    event.preventDefault();
    if (busy || saveBlocked) return;
    onSave(editor.kind === 'role' ? { kind: 'role', name, weight, active } : { kind: 'employee', name, weight, active, roleId }, editor.row?.id);
  }}>
    <h4 className="font-semibold">{editor.row ? 'Edit' : 'Add'} shared {editor.kind === 'role' ? 'job role' : 'employee'}</h4>
    <fieldset disabled={busy} className="space-y-3">
      <div><label htmlFor={`${id}-name`} className="block">Shared {editor.kind} name</label>
        <input id={`${id}-name`} className="border rounded p-2 w-full" required value={name} onChange={event => setName(event.target.value)} />
        <p className="text-sm">Up to {editor.kind === 'role' ? 100 : 160} characters.</p>
      </div>
      {editor.kind === 'employee' && <div><label htmlFor={`${id}-role`} className="block">Default shared job role</label>
        <select id={`${id}-role`} className="border rounded p-2 w-full" required value={roleId} onChange={event => setRoleId(event.target.value)}>
          <option value="" disabled>Choose an active role</option>
          {snapshot.roles.map(row => <option key={row.id} value={row.id} disabled={!row.is_active && row.id !== existingRole}>{row.name}{row.is_active ? '' : ' (Inactive; existing link only)'}</option>)}
        </select>
        <p className="text-sm">Inactive roles keep existing links. New assignments require an active role. Changing a role retains the override you submit.</p>
      </div>}
      <div><label htmlFor={`${id}-weight`} className="block">{editor.kind === 'role' ? 'Default share weight' : 'Default share weight override (blank inherits role)'}</label>
        <input id={`${id}-weight`} className="border rounded p-2 w-full" type="text" inputMode="decimal" required={editor.kind === 'role'} value={weight} onChange={event => setWeight(event.target.value)} />
        <p className="text-sm">Nonnegative shares, at most two decimal places. Zero is explicit zero; an empty employee override inherits the role default.</p>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Active shared {editor.kind}</label>
      <div className="flex gap-2"><button className={button} type="submit" disabled={saveBlocked}>{busy ? 'Saving…' : 'Save shared roster'}</button><button className={button} type="button" onClick={onCancel}>Cancel draft</button></div>
    </fieldset>
  </form>;
}
