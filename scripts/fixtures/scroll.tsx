// Browser-only fixture. All Auth/REST calls are synthetic, with no network transport.
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import AuthGate from '../../src/AuthGate';
import { accountRosterKey } from '../../src/supabase';
import '../../src/index.css';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = 'https://fictional.example.test';
const user = { id: id(1), email: 'scroll-fixture@example.test' };
const session = { user, access_token: 'fictional-token', expires_at: Date.now() / 1000 + 3600 } as Session;
const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
const tables: Record<string, Record<string, unknown>[]> = {
  organizations: [{ id: id(2), name: 'Fictional Scroll Restaurant' }],
  organization_memberships: [{ organization_id: id(2), user_id: user.id, role: 'closer', is_active: true }],
  job_roles: [{ id: id(3), organization_id: id(2), name: 'Fictional server', is_active: true, default_weight: '100' }],
  employees: Array.from({ length: 50 }, (_, i) => ({ id: id(100 + i), organization_id: id(2), name: `Synthetic Employee ${String(i + 1).padStart(2, '0')}`, is_active: true, default_role_id: id(3), default_weight_override: null })),
};
let pending: Promise<void> | undefined;
let release = () => {};
const events: { type: string; time: number; scrollY: number }[] = [];
const record = (type: string) => events.push({ type, time: performance.now(), scrollY: window.scrollY });
for (const name of ['scroll', 'focus', 'blur', 'online', 'offline']) window.addEventListener(name, () => record(name));
document.addEventListener('visibilitychange', () => record(`visibility:${document.visibilityState}`));
const sdk = createClient(project, 'sb_publishable_fictional_placeholder', {
  accessToken: async () => 'fictional-token', auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    if ((init?.method ?? 'GET') !== 'GET') throw new Error('Fixture forbids writes');
    const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!;
    record(`request:${table}`);
    await pending;
    init?.signal?.throwIfAborted();
    const rows = tables[table].filter(row => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
      if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]));
      return true;
    }));
    const fields = url.searchParams.get('select')!.split(',').map(field => field.replace('::text', ''));
    record(`response:${table}`);
    return new Response(JSON.stringify(rows.map(row => Object.fromEntries(fields.map(field => [field, row[field]])))), {
      headers: { 'Content-Type': 'application/json', 'Content-Range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' },
    });
  } },
});
const client = { from: sdk.from.bind(sdk), auth: {
  getSession: async () => ({ data: { session }, error: null }),
  getUser: async () => ({ data: { user }, error: null }),
  onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
    listeners.add(callback);
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
  },
} } as unknown as SupabaseClient;
const storageKey = accountRosterKey(project, user.id);
localStorage.setItem(storageKey, JSON.stringify(tables.employees.map(row => ({ id: row.id, name: row.name, jobTitle: 'Local synthetic server', weight: 100 }))));
Object.assign(window, { scrollFixture: {
  events,
  hold: () => { pending = new Promise(resolve => { release = resolve; }); record('hold'); },
  release: () => { release(); pending = undefined; record('release'); },
  auth: () => listeners.forEach(callback => callback('TOKEN_REFRESHED', session)),
  revoke: () => { tables.organization_memberships = []; },
} });
createRoot(document.getElementById('root')!).render(<AuthGate runtime={{ mode: 'configured', project, client }} />);
