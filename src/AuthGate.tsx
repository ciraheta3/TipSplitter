import { useState } from 'react';
import Calculator from './Calculator';
import { accountRosterKey } from './supabase';
import type { AuthRuntime } from './supabase';
import { useAuth } from './useAuth';

const buttonClass = 'rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 disabled:opacity-50';

export default function AuthGate({ runtime }: { runtime: Extract<AuthRuntime, { mode: 'configured' }> }) {
  const auth = useAuth(runtime.client);

  if (auth.loading) return <main className="min-h-screen bg-gray-50 grid place-items-center p-8"><p role="status">Checking your session…</p></main>;

  if (auth.user) {
    const storageKey = accountRosterKey(runtime.project, auth.user.id);
    return <>
      <header className="bg-white border-b p-4 flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-semibold">TipSplitter · DEV preview</p><p className="text-sm break-all">Signed in as {auth.user.email ?? 'verified user'}</p></div>
        <button className={buttonClass} onClick={() => void auth.signOut()} disabled={auth.busy}>Sign out</button>
      </header>
      <p className="bg-blue-50 p-4 text-center text-sm">Signing in does not grant restaurant membership. This calculator uses your browser-local preview roster only.</p>
      <Calculator key={storageKey} storageKey={storageKey} />
    </>;
  }

  return <LoginScreen auth={auth} />;
}

function LoginScreen({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
    <section className="w-full max-w-md bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-5" aria-labelledby="login-title">
      <div><p className="text-sm font-semibold text-blue-700">TipSplitter · DEV</p><h1 id="login-title" className="text-2xl font-bold mt-2">Sign in to your preview</h1></div>
      <p className="text-sm text-gray-600">Use an existing development account. Your roster stays in this browser and is not synchronized to Supabase.</p>
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
      <p className="text-xs text-gray-500">Authentication alone does not grant restaurant membership or access to tenant records. Contact the project owner for DEV access.</p>
    </section>
  </main>;
}
