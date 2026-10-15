import AuthGate from './AuthGate';
import Calculator from './Calculator';
import { getAuthRuntime } from './supabase';

export default function App() {
  const runtime = getAuthRuntime();
  if (runtime.mode === 'error') return <main className="max-w-xl mx-auto p-8"><h1 className="text-2xl font-bold">TipSplitter setup required</h1><p role="alert" className="mt-4">{runtime.message}</p></main>;
  if (runtime.mode === 'configured') return <AuthGate runtime={runtime} />;
  return <><p className="bg-amber-100 text-amber-950 p-4 text-center">Local-only prototype — not signed in. Supabase is not configured.</p><Calculator storageKey="employees" /></>;
}
