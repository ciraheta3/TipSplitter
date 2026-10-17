// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import App from './App';
import { accountRosterKey, getAuthRuntime } from './supabase';

vi.mock('./supabase', async importOriginal => ({
  ...await importOriginal<typeof import('./supabase')>(), getAuthRuntime: vi.fn(),
}));

// This suite retains the Auth/calculator assertions; transport coverage lives in
// SharedRoster.test.tsx. Give the new reader an explicit no-membership response.
vi.mock('./sharedRosterData', async importOriginal => ({
  ...await importOriginal<typeof import('./sharedRosterData')>(),
  readOrganizations: vi.fn(async () => []),
}));

const project = 'https://fictional-project.example.test';
const userA = { id: 'fictional-a', email: 'preview-a@example.test', user_metadata: { role: 'admin' } } as unknown as User;
const userB = { id: 'fictional-b', email: 'preview-b@example.test' } as User;
function session(user = userA, token = `fictional-token-${user.id}`): Session {
  return { access_token: token, refresh_token: 'fictional-refresh', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type SessionResult = { data: { session: Session | null }; error: null | { message: string } };
const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
const unsubscribes: ReturnType<typeof vi.fn>[] = [];
const auth = {
  getSession: vi.fn(), getUser: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(),
  onAuthStateChange: vi.fn((callback: (event: AuthChangeEvent, session: Session | null) => void) => {
    listeners.add(callback);
    const unsubscribe = vi.fn(() => listeners.delete(callback));
    unsubscribes.push(unsubscribe);
    return { data: { subscription: { unsubscribe } } };
  }),
};
const dashboard = () => screen.queryByRole('heading', { name: 'Tip Calculator Dashboard' });
async function emit(event: AuthChangeEvent, value: Session | null) {
  await act(async () => { listeners.forEach(callback => callback(event, value)); });
  // Wait for the callback's deferred verification, without timing sleeps.
  await waitFor(() => expect(screen.queryByText('Checking your session…')).not.toBeInTheDocument());
}
async function login() {
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Sign in' });
  await user.type(screen.getByLabelText('Email'), 'preview-a@example.test');
  await user.type(screen.getByLabelText('Password'), 'fictional-password-only');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}
function savedRoster(name: string) {
  return JSON.stringify([{ id: `fictional-${name}`, name, jobTitle: 'Test Server', weight: 100 }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear(); unsubscribes.length = 0;
  localStorage.clear();
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.getUser.mockImplementation(async (token: string) => ({ data: { user: token.includes(userB.id) ? userB : userA }, error: null }));
  auth.signInWithPassword.mockResolvedValue({ data: { session: session() }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  vi.mocked(getAuthRuntime).mockReturnValue({ mode: 'configured', project, client: { auth } as unknown as SupabaseClient });
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); vi.restoreAllMocks(); });

it('gates signed-out users and never reads the legacy roster', async () => {
  localStorage.setItem('employees', savedRoster('Legacy Fiction'));
  const read = vi.spyOn(Storage.prototype, 'getItem');
  render(<App />);
  expect(dashboard()).not.toBeInTheDocument();
  await screen.findByRole('button', { name: 'Sign in' });
  expect(read).not.toHaveBeenCalled();
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(screen.queryByText('Legacy Fiction')).not.toBeInTheDocument();
  expect(screen.queryByText(/sign up|reset password|invite/i)).not.toBeInTheDocument();
});

it('keeps initial restoration and user verification behind a loading gate', async () => {
  const initial = deferred<SessionResult>();
  const identity = deferred<{ data: { user: User }; error: null }>();
  auth.getSession.mockReturnValue(initial.promise);
  auth.getUser.mockReturnValue(identity.promise);
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  expect(dashboard()).not.toBeInTheDocument();
  await act(async () => initial.resolve({ data: { session: session() }, error: null }));
  expect(dashboard()).not.toBeInTheDocument();
  await act(async () => identity.resolve({ data: { user: userA }, error: null }));
  expect(dashboard()).toBeVisible();
  expect(auth.getUser).toHaveBeenCalledWith(session().access_token);
  expect(screen.getByText(/Signed in as preview-a/)).toBeVisible();
});

it('signs in using password Auth, verifies identity and clears the password', async () => {
  render(<App />);
  await login();
  expect(await screen.findByRole('heading', { name: 'Tip Calculator Dashboard' })).toBeVisible();
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'preview-a@example.test', password: 'fictional-password-only' });
  expect(auth.getUser).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Signing in does not grant restaurant membership/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByLabelText('Password')).toHaveValue('');
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(dashboard()).not.toBeInTheDocument();
});

it.each([
  ['credentials', { code: 'invalid_credentials', message: 'private server detail' }, /Check your email and password/],
  ['network response', { message: 'private server detail' }, /Check your connection/],
  ['unconfirmed', { code: 'email_not_confirmed', message: 'private server detail' }, /Check your email and password/],
])('shows safe feedback for %s errors and permits retry', async (_name, error, expected) => {
  auth.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error });
  render(<App />); await login();
  expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  expect(dashboard()).not.toBeInTheDocument();
});

it('handles thrown network failures without unhandled rejection', async () => {
  auth.signInWithPassword.mockRejectedValueOnce(new TypeError('private network detail'));
  render(<App />); await login();
  expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection');
});

it('disables duplicate sign-in submissions while a request is pending', async () => {
  const pending = deferred<{ data: { session: Session }; error: null }>();
  auth.signInWithPassword.mockReturnValue(pending.promise);
  render(<App />); await login();
  expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  expect(screen.getByLabelText('Password')).toBeDisabled();
  await act(async () => pending.resolve({ data: { session: session() }, error: null }));
  expect(dashboard()).toBeVisible();
});

it.each(['expired', 'invalid', 'mismatched', 'missing-user', 'restoration-error', 'restoration-throw'])(
  'rejects %s restored sessions', async kind => {
    const candidate = session();
    if (kind === 'expired') candidate.expires_at = Math.floor(Date.now() / 1000) - 1;
    auth.getSession.mockResolvedValue({ data: { session: candidate }, error: kind === 'restoration-error' ? { message: 'private detail' } : null });
    if (kind === 'restoration-throw') auth.getSession.mockRejectedValue(new Error('private detail'));
    if (kind === 'invalid') auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'private detail' } });
    if (kind === 'missing-user') auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (kind === 'mismatched') auth.getUser.mockResolvedValue({ data: { user: userB }, error: null });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('session could not be verified');
    expect(dashboard()).not.toBeInTheDocument();
  },
);

it('hides content immediately on sign-out and retains a retry gate if remote logout fails', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  const pending = deferred<{ error: { message: string } | null }>();
  auth.signOut.mockReturnValueOnce(pending.promise);
  render(<App />);
  await screen.findByRole('button', { name: 'Sign out' });
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(dashboard()).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
  await act(async () => pending.resolve({ error: { message: 'private detail' } }));
  expect(screen.getByRole('alert')).toHaveTextContent('saved session may remain');
  await emit('SIGNED_IN', session());
  expect(dashboard()).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry sign-out' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled();
});

it('handles thrown logout errors', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  auth.signOut.mockRejectedValueOnce(new TypeError('private detail'));
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-out did not finish');
});

it('isolates legacy, account and project rosters and restores only the returning account', async () => {
  const keyA = accountRosterKey(project, userA.id), keyB = accountRosterKey(project, userB.id);
  localStorage.setItem('employees', savedRoster('Legacy Fiction'));
  localStorage.setItem(accountRosterKey('other-project', userA.id), savedRoster('Other Project Fiction'));
  localStorage.setItem(keyA, savedRoster('A Fiction'));
  localStorage.setItem(keyB, savedRoster('B Fiction'));
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  const view = render(<App />);
  await screen.findByRole('group', { name: 'Employee A Fiction' });
  expect(screen.queryByText('Legacy Fiction')).not.toBeInTheDocument();
  expect(screen.queryByText('Other Project Fiction')).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Cash Tips ($)'), '100');
  await user.click(screen.getByRole('checkbox'));
  await user.type(screen.getByLabelText('Employee name'), 'Unsaved Fiction');
  await emit('SIGNED_IN', session(userB));
  expect(await screen.findByRole('group', { name: 'Employee B Fiction' })).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Employee A Fiction' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('');
  expect(screen.getByLabelText('Employee name')).toHaveValue('');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Remove B Fiction' }));
  expect(localStorage.getItem(keyB)).toBe('[]');
  expect(localStorage.getItem(keyA)).toBe(savedRoster('A Fiction'));
  view.unmount();
  render(<App />);
  expect(await screen.findByRole('group', { name: 'Employee A Fiction' })).toBeVisible();
  expect(localStorage.getItem('employees')).toBe(savedRoster('Legacy Fiction'));
});

it('refreshes tokens and handles repeated focus events without resetting drafts', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  render(<App />);
  await screen.findByRole('button', { name: 'Sign out' });
  await userEvent.type(screen.getByLabelText('Cash Tips ($)'), '50');
  await emit('SIGNED_IN', session());
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('50');
  expect(auth.getUser).toHaveBeenCalledTimes(1);
  await emit('TOKEN_REFRESHED', session(userA, 'refreshed-fictional-token'));
  await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('50');
  auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid refresh' } });
  await emit('TOKEN_REFRESHED', session(userA, 'invalid-fictional-token'));
  expect(await screen.findByRole('alert')).toHaveTextContent('session could not be verified');
  expect(dashboard()).not.toBeInTheDocument();
});

it('hides content when expiry arrives without a successful SDK refresh', async () => {
  vi.useFakeTimers();
  const candidate = session(); candidate.expires_at = Math.floor(Date.now() / 1000) + 10;
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  render(<App />);
  await act(async () => {});
  expect(dashboard()).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(dashboard()).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('session expired');
});

it('ignores stale restoration and verification responses after sign-out', async () => {
  const initial = deferred<SessionResult>();
  auth.getSession.mockReturnValue(initial.promise);
  render(<App />);
  await emit('SIGNED_OUT', null);
  await act(async () => initial.resolve({ data: { session: session() }, error: null }));
  expect(dashboard()).not.toBeInTheDocument();
  const identity = deferred<{ data: { user: User }; error: null }>();
  auth.getUser.mockReturnValueOnce(identity.promise);
  act(() => { listeners.forEach(cb => cb('SIGNED_IN', session())); });
  await waitFor(() => expect(auth.getUser).toHaveBeenCalled());
  await emit('SIGNED_OUT', null);
  await act(async () => identity.resolve({ data: { user: userA }, error: null }));
  expect(dashboard()).not.toBeInTheDocument();
});

it('unsubscribes on unmount and tolerates StrictMode effect replay', async () => {
  const view = render(<StrictMode><App /></StrictMode>);
  await screen.findByRole('button', { name: 'Sign in' });
  expect(listeners.size).toBe(1);
  view.unmount();
  expect(listeners.size).toBe(0);
  expect(unsubscribes.length).toBe(2);
  unsubscribes.forEach(unsubscribe => expect(unsubscribe).toHaveBeenCalledTimes(1));
});

it('marks credential-free preview as unauthenticated and fails closed on invalid configuration', () => {
  vi.mocked(getAuthRuntime).mockReturnValue({ mode: 'local' });
  const view = render(<App />);
  expect(screen.getByText(/Local-only prototype — not signed in/)).toBeVisible();
  expect(dashboard()).toBeVisible();
  view.unmount();
  vi.mocked(getAuthRuntime).mockReturnValue({ mode: 'error', message: 'Fictional setup error' });
  render(<App />);
  expect(screen.getByRole('alert')).toHaveTextContent('Fictional setup error');
  expect(dashboard()).not.toBeInTheDocument();
  expect(auth.getSession).not.toHaveBeenCalled();
});

it('accepts SDK sign-in events emitted before signInWithPassword resolves', async () => {
  auth.signInWithPassword.mockImplementationOnce(async () => {
    listeners.forEach(callback => callback('SIGNED_IN', session()));
    return { data: { session: session() }, error: null };
  });
  render(<App />); await login();
  expect(await screen.findByRole('button', { name: 'Sign out' })).toBeVisible();
  expect(auth.getUser).toHaveBeenCalledTimes(1);
});

it('does not resurrect an account from a late sign-in response after SIGNED_OUT', async () => {
  const pending = deferred<{ data: { session: Session }; error: null }>();
  auth.signInWithPassword.mockReturnValueOnce(pending.promise);
  render(<App />); await login();
  await emit('SIGNED_OUT', null);
  await act(async () => pending.resolve({ data: { session: session() }, error: null }));
  expect(dashboard()).not.toBeInTheDocument();
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

it('discards an older account verification after a newer account has been verified', async () => {
  const pending = deferred<{ data: { user: User }; error: null }>();
  auth.getUser.mockReturnValueOnce(pending.promise);
  render(<App />);
  await screen.findByRole('button', { name: 'Sign in' });
  act(() => { listeners.forEach(callback => callback('SIGNED_IN', session())); });
  await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(1));
  await emit('SIGNED_IN', session(userB));
  expect(await screen.findByText(/Signed in as preview-b/)).toBeVisible();
  await act(async () => pending.resolve({ data: { user: userA }, error: null }));
  expect(screen.queryByText(/Signed in as preview-a/)).not.toBeInTheDocument();
});

it('keeps the verified expiry deadline while a refreshed token is still being checked', async () => {
  vi.useFakeTimers();
  const candidate = session(); candidate.expires_at = Math.floor(Date.now() / 1000) + 10;
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  render(<App />);
  await act(async () => {});
  expect(dashboard()).toBeVisible();
  const pending = deferred<{ data: { user: User }; error: null }>();
  auth.getUser.mockReturnValueOnce(pending.promise);
  act(() => { listeners.forEach(callback => callback('TOKEN_REFRESHED', session(userA, 'pending-fictional-token'))); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(dashboard()).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(dashboard()).not.toBeInTheDocument();
  await act(async () => pending.resolve({ data: { user: userA }, error: null }));
  expect(dashboard()).not.toBeInTheDocument();
});

it('writes new employees only to the verified account and reports account-scoped storage failures', async () => {
  const keyA = accountRosterKey(project, userA.id);
  const keyB = accountRosterKey(project, userB.id);
  localStorage.setItem(keyB, savedRoster('B Fiction'));
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Sign out' });
  await user.type(screen.getByLabelText('Employee name'), 'A New Fiction');
  await user.type(screen.getByLabelText('Job title'), 'Test Server');
  await user.type(screen.getByLabelText('Share weight'), '100');
  await user.click(screen.getByRole('button', { name: '+ Add to Roster' }));
  expect(JSON.parse(localStorage.getItem(keyA)!)).toEqual([expect.objectContaining({ name: 'A New Fiction' })]);
  expect(localStorage.getItem(keyB)).toBe(savedRoster('B Fiction'));
  expect(localStorage.getItem('employees')).toBeNull();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Quota'); });
  await user.click(screen.getByRole('button', { name: 'Remove A New Fiction' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Roster could not be saved');
  expect(screen.queryByRole('group', { name: 'Employee A New Fiction' })).not.toBeInTheDocument();
  await emit('SIGNED_IN', session(userB));
  expect(await screen.findByRole('group', { name: 'Employee B Fiction' })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('clears login drafts when another tab signs in and then signs out', async () => {
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Sign in' });
  await user.type(screen.getByLabelText('Email'), 'preview-a@example.test');
  await user.type(screen.getByLabelText('Password'), 'unsent-fictional-password');
  await emit('SIGNED_IN', session(userB));
  await screen.findByRole('button', { name: 'Sign out' });
  await emit('SIGNED_OUT', null);
  expect(screen.getByLabelText('Email')).toHaveValue('');
  expect(screen.getByLabelText('Password')).toHaveValue('');
});
