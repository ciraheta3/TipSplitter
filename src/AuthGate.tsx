import { useState } from 'react';
import { clearSharedDrafts, contextKey, readContext, writeStored } from './calculationDraft';
import type { SupabaseClient } from '@supabase/supabase-js';
import Calculator from './Calculator';
import SharedRoster from './SharedRoster';
import { rosterSaveScope } from './sharedRosterSaveScope';
import { accountRosterKey } from './supabase';
import type { AuthRuntime } from './supabase';
import { useAuth } from './useAuth';

const buttonClass = 'rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 disabled:opacity-50';

type Props = { runtime: Extract<AuthRuntime, { mode: 'configured' }> };

export default function AuthGate({ runtime }: Props) {
  return <AccountGate key={`${runtime.project}:${rosterSaveScope(runtime.client, '', '').id}`} runtime={runtime} />;
}

function AccountGate({ runtime }: Props) {
  const auth = useAuth(runtime.client, runtime.project);

  if (auth.loading) return <main className="min-h-screen bg-gray-50 grid place-items-center p-8"><p role="status">Checking your session…</p></main>;

  if (auth.user) {
    const storageKey = accountRosterKey(runtime.project, auth.user.id);
    return <>
      <header className="bg-white border-b p-4 flex flex-wrap items-center justify-between gap-3">
        <div><div className="flex items-center gap-3"><h1 className="text-2xl font-bold">TipSplitter</h1><span className="text-xs text-gray-500" role="note" aria-label="Development environment">DEV</span></div><p className="text-sm text-gray-600 break-all">Signed in as {auth.user.email ?? 'verified user'}</p></div>
        <button className={buttonClass} onClick={() => void auth.signOut()} disabled={auth.busy}>Sign out</button>
      </header>
      {auth.draftWarning && <p role="alert">{auth.draftWarning}</p>}
      <SignedInPreview key={storageKey} client={runtime.client} userId={auth.user.id} storageKey={storageKey} />
    </>;
  }

  return <LoginScreen auth={auth} />;
}

function SignedInPreview({ client, userId, storageKey }: { client: SupabaseClient; userId: string; storageKey: string }) {
  const [context] = useState(() => readContext(storageKey));
  const [source, setSource] = useState(context.value?.source ?? 'local');
  const [storageError, setStorageError] = useState(context.error);
  const switchSource = (source: 'local' | 'shared') => {
    const cleared = source === 'local' ? clearSharedDrafts(storageKey) : true;
    const saved = writeStored(contextKey(storageKey), { source, organizationId: '' });
    setStorageError(!cleared || !saved ? 'Draft context could not be saved or cleared. Browser recovery may be unavailable.' : undefined);
    setSource(source);
  };
  const [management, setManagement] = useState(false);
  return <>
    <SharedRoster draftScope={storageKey} initialSelection={context.value?.source === 'shared' ? context.value.organizationId : ''} client={client} userId={userId} calculationMode={source === 'shared'} management={management} onManagementChange={setManagement} calculatorControls={
      <fieldset className="space-y-2">
        <legend className="font-bold">Calculation source</legend>
        {storageError && <p role="alert">{storageError}</p>}
        <label className="flex items-center gap-3 min-h-12"><input type="radio" name="calculation-source" checked={source === 'local'} onChange={() => switchSource('local')} />Local roster</label>
        <label className="flex items-center gap-3 min-h-12"><input type="radio" name="calculation-source" checked={source === 'shared'} onChange={() => switchSource('shared')} />Restaurant roster</label>
        <p className="text-sm">Leaving Restaurant roster clears its selections, temporary weights and temporary participants. Your local roster and local tip inputs are kept.</p>
      </fieldset>
    } />
    <div hidden={management || source !== 'local'} inert={management || source !== 'local'}><Calculator storageKey={storageKey} /></div>
  </>;
}

function LoginScreen({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
    <section className="w-full max-w-md bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-5" aria-labelledby="login-title">
      <div><p className="text-sm font-semibold text-blue-700">TipSplitter <span className="ml-2 text-xs text-gray-500" role="note" aria-label="Development environment">DEV</span></p><h1 id="login-title" className="text-2xl font-bold mt-2">Sign in</h1></div>
      <p className="text-sm text-gray-600">Use your existing account.</p>
      {auth.draftWarning && <p role="alert">{auth.draftWarning}</p>}
      {auth.error && <p role="alert" className="text-sm text-red-700">{auth.error}</p>}
      {auth.signOutFailed ? <button className={buttonClass} disabled={auth.busy} onClick={() => void auth.signOut()}>{auth.busy ? 'Signing out…' : 'Retry sign-out'}</button> :
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          const submittedPassword = password;
          setPassword('');
          void auth.signIn(email.trim(), submittedPassword);
        }}>
          <div><label htmlFor="email" className="block text-sm font-semibold mb-1">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={auth.busy} className="w-full border border-gray-300 rounded p-2" /></div>
          <div><label htmlFor="password" className="block text-sm font-semibold mb-1">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={auth.busy} className="w-full border border-gray-300 rounded p-2" /></div>
          <button className={`${buttonClass} w-full`} type="submit" disabled={auth.busy}>{auth.busy ? 'Signing in…' : 'Sign in'}</button>
        </form>}
      <p className="text-xs text-gray-500">Need an account or restaurant access? Contact the project owner.</p>
    </section>
  </main>;
}
