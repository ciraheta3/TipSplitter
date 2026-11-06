// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { emptyDraft, localDraftKey, saveDraft } from './calculationDraft';
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
const dashboard = () => screen.queryByRole('heading', { name: 'Calculation preview' });
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
  expect(await screen.findByRole('heading', { name: 'Calculation preview' })).toBeVisible();
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'preview-a@example.test', password: 'fictional-password-only' });
  expect(auth.getUser).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Preview amounts are not recorded payments.')).toBeVisible();
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
  const key = localDraftKey(accountRosterKey(project, userA.id));
  const saved = localStorage.getItem(key);
  expect(saved).not.toBeNull();
  expect(auth.getUser).toHaveBeenCalledTimes(1);
  await emit('TOKEN_REFRESHED', session(userA, 'refreshed-fictional-token'));
  await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('50');
  expect(localStorage.getItem(key)).toBe(saved);
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
  const key = localDraftKey(accountRosterKey(project, userA.id));
  saveDraft(key, { ...emptyDraft(), cashTip: '42.50' });
  const identity = deferred<{ data: { user: User }; error: null }>();
  auth.getUser.mockReturnValueOnce(identity.promise);
  act(() => { listeners.forEach(cb => cb('SIGNED_IN', session())); });
  await waitFor(() => expect(auth.getUser).toHaveBeenCalled());
  await emit('SIGNED_OUT', null);
  expect(localStorage.getItem(key)).toBeNull();
  await act(async () => identity.resolve({ data: { user: userA }, error: null }));
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBeNull();
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
  expect(screen.getByText(/Local preview · Not signed in/)).toBeVisible();
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

it('expires a pending refresh without deleting drafts or accepting its superseded response', async () => {
  vi.useFakeTimers();
  const candidate = session(); candidate.expires_at = Math.floor(Date.now() / 1000) + 10;
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  render(<App />);
  await act(async () => {});
  expect(dashboard()).toBeVisible();
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '12.34' } });
  const key = localDraftKey(accountRosterKey(project, userA.id)), saved = localStorage.getItem(key);
  expect(saved).not.toBeNull();
  const pending = deferred<{ data: { user: User }; error: null }>();
  auth.getUser.mockReturnValueOnce(pending.promise);
  act(() => { listeners.forEach(callback => callback('TOKEN_REFRESHED', session(userA, 'pending-fictional-token'))); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(dashboard()).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(saved);
  await act(async () => pending.resolve({ data: { user: userA }, error: null }));
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(saved);
  await authEvent('SIGNED_IN', session());
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('12.34');
  expect(localStorage.getItem(key)).toBe(saved);
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

it('shows one application heading and DEV indicator with clear local source and preview status', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  render(<App />);
  await screen.findByRole('button', { name: 'Sign out' });
  expect(screen.getByRole('heading', { level: 1, name: 'TipSplitter' })).toBeVisible();
  expect(screen.getAllByText('DEV', { exact: true })).toHaveLength(1);
  expect(screen.getByLabelText('Development environment')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'Local roster' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Restaurant roster' })).not.toBeChecked();
  expect(screen.getByRole('heading', { name: 'Calculation preview' })).toBeVisible();
  expect(screen.getByText('Preview amounts are not recorded payments.')).toBeVisible();
  expect(screen.getByText('Local roster · Saved in this browser only.')).toBeVisible();
  expect(screen.getByText(/Leaving Restaurant roster clears its selections, temporary weights and temporary participants/)).toBeVisible();
  expect(screen.queryByText(/Supabase|tenant records|authentication alone|Signing in does not grant/i)).not.toBeInTheDocument();
  expect(await screen.findByText('No restaurant access assigned')).toBeVisible();
  expect(screen.getByText(/Contact the project owner for access/)).toBeVisible();
});

it('restores account-local tips only after verified Auth and clears persistence on explicit sign-out', async () => {
  const { emptyDraft, localDraftKey, readDraft, saveDraft } = await import('./calculationDraft');
  const key = localDraftKey(accountRosterKey(project, userA.id));
  saveDraft(key, { ...emptyDraft(), cashTip: '42.50', roundToDollar: true });
  const pending = deferred<{ data: { user: User }; error: null }>();
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  auth.getUser.mockReturnValueOnce(pending.promise);
  render(<App />);
  expect(screen.queryByLabelText('Cash Tips ($)')).not.toBeInTheDocument();
  await act(async () => pending.resolve({ data: { user: userA }, error: null }));
  expect(await screen.findByLabelText('Cash Tips ($)')).toHaveValue('42.50');
  expect(screen.getByLabelText('Round down to whole dollar')).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(readDraft(key).value).toBeUndefined();
  await login();
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('');
});

it('clears the previous account draft on account switch without overwriting the next account draft', async () => {
  const { emptyDraft, localDraftKey, readDraft, saveDraft } = await import('./calculationDraft');
  const keyA = localDraftKey(accountRosterKey(project, userA.id));
  const keyB = localDraftKey(accountRosterKey(project, userB.id));
  saveDraft(keyA, { ...emptyDraft(), cashTip: '42.50' });
  saveDraft(keyB, { ...emptyDraft(), cashTip: '8.25' });
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  render(<App />);
  expect(await screen.findByLabelText('Cash Tips ($)')).toHaveValue('42.50');
  await emit('SIGNED_IN', session(userB));
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('8.25');
  expect(readDraft(keyA).value).toBeUndefined();
  expect(readDraft(keyB).value!.cashTip).toBe('8.25');
});

it('clears a candidate account draft on failed initial Auth verification', async () => {
  const { emptyDraft, localDraftKey, readDraft, saveDraft } = await import('./calculationDraft');
  const key = localDraftKey(accountRosterKey(project, userA.id));
  saveDraft(key, { ...emptyDraft(), cashTip: '42.50' });
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'unverified' } });
  render(<App />);
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('Cash Tips ($)')).not.toBeInTheDocument();
  expect(readDraft(key).value).toBeUndefined();
});

it('remounts the Auth gate on project/client change before reading another project draft', async () => {
  const { emptyDraft, localDraftKey, saveDraft } = await import('./calculationDraft');
  const { default: AuthGate } = await import('./AuthGate');
  const firstClient = { auth } as unknown as SupabaseClient;
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  const view = render(<AuthGate runtime={{ mode: 'configured', project, client: firstClient }} />);
  await screen.findByLabelText('Cash Tips ($)');
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '42.50' } });
  const nextProject = 'https://another-fictional.example.test';
  saveDraft(localDraftKey(accountRosterKey(nextProject, userA.id)), { ...emptyDraft(), cashTip: '8.25' });
  const pending = deferred<{ data: { user: User }; error: null }>();
  auth.getUser.mockReturnValueOnce(pending.promise);
  view.rerender(<AuthGate runtime={{ mode: 'configured', project: nextProject, client: { auth } as unknown as SupabaseClient }} />);
  expect(screen.queryByLabelText('Cash Tips ($)')).not.toBeInTheDocument();
  await act(async () => pending.resolve({ data: { user: userA }, error: null }));
  expect(await screen.findByLabelText('Cash Tips ($)')).toHaveValue('8.25');
});


// Auth callbacks defer SDK reads; flush them explicitly under fake timers.
async function authEvent(event: AuthChangeEvent, candidate: Session | null) {
  await act(async () => {
    listeners.forEach(callback => callback(event, candidate));
    await vi.advanceTimersByTimeAsync(0);
  });
}

it.each(['SIGNED_IN', 'TOKEN_REFRESHED'] as const)('recovers an autosaved local draft after expiry and same-user %s verification', async event => {
  vi.useFakeTimers();
  const candidate = session(); candidate.expires_at = Math.floor(Date.now() / 1000) + 10;
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  render(<App />); await act(async () => {});
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '0012.34' } });
  fireEvent.change(screen.getByLabelText('Credit Tips ($)'), { target: { value: '87.66' } });
  fireEvent.click(screen.getByLabelText('Round down to whole dollar'));
  const key = localDraftKey(accountRosterKey(project, userA.id)), saved = localStorage.getItem(key);
  expect(saved).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(saved);
  const verified = deferred<{ data: { user: User }; error: null }>();
  auth.getUser.mockReturnValueOnce(verified.promise);
  await authEvent(event, session(userA, 'reauthenticated-fictional-token'));
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(saved);
  await act(async () => verified.resolve({ data: { user: userA }, error: null }));
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('0012.34');
  expect(screen.getByLabelText('Credit Tips ($)')).toHaveValue('87.66');
  expect(screen.getByLabelText('Round down to whole dollar')).toBeChecked();
  expect(localStorage.getItem(key)).toBe(saved);
});

it.each(['past', 'missing', 'NaN', 'infinite'])('preserves an unread draft behind the Auth gate for %s initial expires_at', async kind => {
  vi.useFakeTimers();
  const candidate = session();
  if (kind === 'past') candidate.expires_at = Math.floor(Date.now() / 1000) - 1;
  if (kind === 'missing') delete candidate.expires_at;
  if (kind === 'NaN') candidate.expires_at = NaN;
  if (kind === 'infinite') candidate.expires_at = Infinity;
  const key = localDraftKey(accountRosterKey(project, userA.id));
  saveDraft(key, { ...emptyDraft(), cashTip: '42.50' });
  const saved = localStorage.getItem(key);
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  const read = vi.spyOn(Storage.prototype, 'getItem');
  render(<App />); await act(async () => {});
  expect(dashboard()).not.toBeInTheDocument();
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBe(saved);
  await authEvent('SIGNED_IN', session());
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('42.50');
  expect(localStorage.getItem(key)).toBe(saved);
});

it.each([
  ['network', () => new TypeError('synthetic network failure'), true],
  ['SDK retryable', () => new AuthRetryableFetchError('synthetic retry', 503), true],
  ['abort', () => new DOMException('synthetic abort', 'AbortError'), true],
  ['timeout', () => new DOMException('synthetic timeout', 'TimeoutError'), true],
  ['rate limit', () => new AuthApiError('synthetic limit', 429, 'over_request_rate_limit'), true],
  ['server', () => new AuthApiError('synthetic server', 503, 'unexpected_failure'), true],
  ['invalid JWT before expiry', () => new AuthApiError('synthetic invalid JWT', 401, 'bad_jwt'), false],
  ['revoked session', () => new AuthApiError('synthetic revoked session', 401, 'session_not_found'), false],
  ['banned account', () => new AuthApiError('synthetic banned', 403, 'user_banned'), false],
  ['unknown', () => new Error('synthetic unknown'), false],
] as const)('closes the gate for %s verification errors and retains drafts only for recognized temporary failures', async (_kind, error, retain) => {
  const key = localDraftKey(accountRosterKey(project, userA.id));
  saveDraft(key, { ...emptyDraft(), cashTip: '42.50' });
  const saved = localStorage.getItem(key);
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: error() });
  render(<App />);
  await screen.findByRole('alert');
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(retain ? saved : null);
});

it.each(['success', 'expired JWT', 'revoked session', 'mismatched identity'])('handles %s arriving after a candidate expires during initial verification', async kind => {
  vi.useFakeTimers();
  const candidate = session(); candidate.expires_at = Math.floor(Date.now() / 1000) + 10;
  const key = localDraftKey(accountRosterKey(project, userA.id));
  saveDraft(key, { ...emptyDraft(), cashTip: '42.50' });
  const saved = localStorage.getItem(key);
  const verification = deferred<unknown>();
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  auth.getUser.mockReturnValueOnce(verification.promise);
  render(<App />); await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  await act(async () => verification.resolve({
    data: { user: kind === 'success' ? userA : kind === 'mismatched identity' ? userB : null },
    error: kind === 'expired JWT' ? new AuthApiError('synthetic expired JWT', 401, 'bad_jwt')
      : kind === 'revoked session' ? new AuthApiError('synthetic revoked', 401, 'session_not_found') : null,
  }));
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(kind === 'success' || kind === 'expired JWT' ? saved : null);
});

it.each(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'] as const)('retains drafts on ambiguous %s with no session, but SIGNED_OUT still clears after expiry', async event => {
  vi.useFakeTimers();
  const candidate = session(); candidate.expires_at = Math.floor(Date.now() / 1000) + 10;
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  render(<App />); await act(async () => {});
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '42.50' } });
  const key = localDraftKey(accountRosterKey(project, userA.id)), saved = localStorage.getItem(key);
  await authEvent(event, null);
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(saved);
  await authEvent('SIGNED_IN', candidate);
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('42.50');
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(localStorage.getItem(key)).toBe(saved);
  await authEvent('SIGNED_OUT', null);
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBeNull();
});

it('clears the previous account draft when switching accounts after expiry, and ignores late verification', async () => {
  vi.useFakeTimers();
  const candidate = session(); candidate.expires_at = Math.floor(Date.now() / 1000) + 10;
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  render(<App />); await act(async () => {});
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '42.50' } });
  const keyA = localDraftKey(accountRosterKey(project, userA.id));
  const keyB = localDraftKey(accountRosterKey(project, userB.id));
  saveDraft(keyB, { ...emptyDraft(), cashTip: '8.25' });
  const savedB = localStorage.getItem(keyB);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  const late = deferred<{ data: { user: User }; error: null }>();
  auth.getUser.mockReturnValueOnce(late.promise);
  await authEvent('SIGNED_IN', session());
  expect(dashboard()).not.toBeInTheDocument();
  await authEvent('SIGNED_IN', session(userB));
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('8.25');
  expect(localStorage.getItem(keyA)).toBeNull();
  expect(localStorage.getItem(keyB)).toBe(savedB);
  await act(async () => late.resolve({ data: { user: userA }, error: null }));
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('8.25');
  expect(localStorage.getItem(keyA)).toBeNull();
  expect(localStorage.getItem(keyB)).toBe(savedB);
});


it('recovers an expired draft through password sign-in without relying on an SDK event', async () => {
  vi.useFakeTimers();
  const candidate = session(); candidate.expires_at = Math.floor(Date.now() / 1000) + 10;
  auth.getSession.mockResolvedValue({ data: { session: candidate }, error: null });
  render(<App />); await act(async () => {});
  fireEvent.change(screen.getByLabelText('Cash Tips ($)'), { target: { value: '42.50' } });
  const key = localDraftKey(accountRosterKey(project, userA.id)), saved = localStorage.getItem(key);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(dashboard()).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(saved);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: userA.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-password-only' } });
  await act(async () => fireEvent.submit(screen.getByLabelText('Email').closest('form')!));
  expect(screen.getByLabelText('Cash Tips ($)')).toHaveValue('42.50');
  expect(localStorage.getItem(key)).toBe(saved);
  expect(auth.getUser).toHaveBeenCalledTimes(2);
});
