import { afterEach, expect, it, vi } from 'vitest';
import { accountRosterKey, authFetch, readAuthConfig } from './supabase';

const fictionalUrl = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
const fictionalKey = 'sb_publishable_fictional_placeholder';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

it('allows local preview only when both config variables are absent or blank', () => {
  expect(readAuthConfig({})).toBeNull();
  expect(readAuthConfig({ VITE_SUPABASE_URL: ' ', VITE_SUPABASE_PUBLISHABLE_KEY: '' })).toBeNull();
});

it('normalizes a hosted project origin and accepts only a publishable frontend key', () => {
  expect(readAuthConfig({ VITE_SUPABASE_URL: ` ${fictionalUrl}/ `, VITE_SUPABASE_PUBLISHABLE_KEY: ` ${fictionalKey} ` }))
    .toEqual({ url: fictionalUrl, key: fictionalKey });
});

it.each([
  [fictionalUrl, ''], ['', fictionalKey], ['not-a-url', fictionalKey],
  ['http://aaaaaaaaaaaaaaaaaaaa.supabase.co', fictionalKey],
  [`${fictionalUrl}/auth/v1`, fictionalKey], [`${fictionalUrl}?x=1`, fictionalKey],
  ['https://user:password@aaaaaaaaaaaaaaaaaaaa.supabase.co', fictionalKey],
  ['http://localhost:54321', fictionalKey], ['https://other.example.test', fictionalKey],
  [fictionalUrl, 'sb_secret_fictional_placeholder'], [fictionalUrl, 'service_role'],
  [fictionalUrl, 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.'],
  [fictionalUrl, 'YOUR_DEV_SB_PUBLISHABLE_KEY'],
])('rejects partial, invalid or private configuration (%s, %s)', (url, key) => {
  expect(() => readAuthConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toThrow(/Set both/);
});

it('creates one client with SDK persistence/refresh, disabling URL auth flows', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', fictionalUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', fictionalKey);
  const createClient = vi.fn(() => ({ auth: {} }));
  vi.doMock('@supabase/supabase-js', () => ({ createClient }));
  const { getAuthRuntime } = await import('./supabase');
  const first = getAuthRuntime();
  expect(getAuthRuntime()).toBe(first);
  expect(createClient).toHaveBeenCalledExactlyOnceWith(fictionalUrl, fictionalKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: expect.any(Function) },
  });
  expect(first.mode).toBe('configured');
  vi.doUnmock('@supabase/supabase-js');
});

it('fails closed before client creation for incomplete environment', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', fictionalUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  const createClient = vi.fn();
  vi.doMock('@supabase/supabase-js', () => ({ createClient }));
  const { getAuthRuntime } = await import('./supabase');
  expect(getAuthRuntime().mode).toBe('error');
  expect(createClient).not.toHaveBeenCalled();
  vi.doUnmock('@supabase/supabase-js');
});

it('separates user and project components without delimiter collisions', () => {
  expect(accountRosterKey('project:a', 'b')).not.toBe(accountRosterKey('project', 'a:b'));
  expect(accountRosterKey('project', 'a')).not.toBe(accountRosterKey('project', 'b'));
  expect(accountRosterKey('project-a', 'a')).not.toBe(accountRosterKey('project-b', 'a'));
});

it('bounds stalled Auth requests and preserves caller cancellation without leaking details', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_input, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })));
  const request = authFetch('https://fictional.example.test/auth');
  const failure = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(15_000);
  await failure;
  expect(vi.getTimerCount()).toBe(0);
  const caller = new AbortController();
  const cancelled = authFetch('https://fictional.example.test/auth', { signal: caller.signal });
  const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  caller.abort();
  await cancellation;
  expect(vi.getTimerCount()).toBe(0);
});
