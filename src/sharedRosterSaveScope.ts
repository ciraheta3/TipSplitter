import type { SupabaseClient } from '@supabase/supabase-js';

type SaveState = { pending: boolean; dispatched: boolean; confirmed: boolean; recovery: boolean; inspected: boolean };
type Attempt = object;

// Tab-memory only. Keep outcome/lock flags across React remounts, never drafts,
// rows, names or tokens. Each client (project), verified user and restaurant has
// an independent record; a different scope cannot observe a previous save.
const clients = new WeakMap<SupabaseClient, Map<string, ReturnType<typeof createScope>>>();
let nextId = 0;
function createScope() {
  let state: SaveState | null = null;
  let attempt: Attempt | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SaveState | null) => { state = next; listeners.forEach(listener => listener()); };
  const update = (owner: Attempt, changes: Partial<SaveState>) => {
    if (owner === attempt && state) publish({ ...state, ...changes });
  };
  return {
    id: ++nextId,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin: () => {
      if (state) return;
      attempt = {};
      publish({ pending: true, dispatched: false, confirmed: false, recovery: false, inspected: false });
      return attempt;
    },
    dispatch: (owner: Attempt) => update(owner, { dispatched: true }),
    confirm: (owner: Attempt) => update(owner, { confirmed: true }),
    wasDispatched: (owner: Attempt) => owner === attempt && !!state?.dispatched,
    interrupt: () => {
      if (state && ((state.dispatched && !state.recovery) || state.inspected)) {
        publish({ ...state, recovery: state.recovery || state.dispatched, inspected: false });
      }
    },
    requireInspection: (owner: Attempt) => update(owner, { recovery: true, inspected: false }),
    settle: (owner: Attempt) => update(owner, { pending: false, inspected: false }),
    clear: (owner: Attempt) => { if (owner === attempt) { attempt = undefined; publish(null); } },
    inspected: (expected: SaveState) => {
      if (state === expected && state.recovery && !state.pending) publish({ ...state, inspected: true });
    },
    acknowledge: () => {
      if (!state?.recovery || state.pending || !state.inspected) return false;
      attempt = undefined; publish(null); return true;
    },
  };
}

export function rosterSaveScope(client: SupabaseClient, userId: string, organizationId: string) {
  let scopes = clients.get(client);
  if (!scopes) { scopes = new Map(); clients.set(client, scopes); }
  const key = JSON.stringify([userId, organizationId]);
  let scope = scopes.get(key);
  if (!scope) { scope = createScope(); scopes.set(key, scope); }
  return scope;
}
