import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuthRuntime =
  | { mode: 'local' }
  | { mode: 'error'; message: string }
  | { mode: 'configured'; client: SupabaseClient; project: string };

export function readAuthConfig(env: Record<string, unknown>) {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
  const key = typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string' ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim() : '';
  if (!url && !key) return null;
  // This milestone targets hosted DEV only. Reject private keys, legacy JWT keys,
  // alternate endpoints, paths and partial configuration before creating a client.
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url)
      || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('Set both VITE_SUPABASE_URL (hosted HTTPS project URL) and VITE_SUPABASE_PUBLISHABLE_KEY (sb_publishable_ key) in .env.local, then restart Vite.');
  }
  return { url: new URL(url).origin, key };
}

// Bound every Auth HTTP attempt, including restoration and logout. Preserve the
// caller's cancellation signal; never log requests or responses containing tokens.
export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const suppliedSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
  try {
    return await fetch(input, {
      ...init,
      signal: suppliedSignal ? AbortSignal.any([suppliedSignal, controller.signal]) : controller.signal,
    });
  } finally { clearTimeout(timer); }
}

let runtime: AuthRuntime | undefined;
export function getAuthRuntime(): AuthRuntime {
  if (runtime) return runtime;
  try {
    const config = readAuthConfig(import.meta.env);
    runtime = config ? {
      mode: 'configured',
      project: config.url,
      client: createClient(config.url, config.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        global: { fetch: authFetch },
      }),
    } : { mode: 'local' };
  } catch {
    runtime = { mode: 'error', message: 'Authentication configuration is invalid. Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local using a hosted HTTPS project URL and an sb_publishable_ key, then restart Vite.' };
  }
  return runtime;
}

export function accountRosterKey(project: string, userId: string) {
  return `tipsplitter:employees:${encodeURIComponent(project)}:${encodeURIComponent(userId)}`;
}
