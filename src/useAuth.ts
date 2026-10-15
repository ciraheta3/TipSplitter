import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

type AuthState = { user: User | null; loading: boolean; error: string | null };
const sessionError = 'Your session could not be verified. Check your connection and sign in again.';

function signInError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return code === 'invalid_credentials' || code === 'email_not_confirmed'
    ? 'Unable to sign in. Check your email and password.'
    : 'Unable to sign in right now. Check your connection and try again.';
}

export function useAuth(client: SupabaseClient) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });
  const [busy, setBusy] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const revision = useRef(0);
  const active = useRef(false);
  const signingOut = useRef(false);
  const verified = useRef<{ token: string; user: User } | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const receive = useCallback(async (session: Session | null) => {
    const ticket = ++revision.current;
    if (!active.current || signingOut.current) return;
    if (!session) {
      clearTimeout(expiryTimer.current);
      verified.current = null;
      setState({ user: null, loading: false, error: null });
      return;
    }
    const expiresAt = session.expires_at ?? 0;
    const validTime = Number.isFinite(expiresAt) && expiresAt * 1000 > Date.now();
    // Repeated SIGNED_IN events (e.g. tab focus) must not reset calculator drafts.
    const previous = verified.current;
    if (!previous || previous.user.id !== session.user.id || !validTime) {
      clearTimeout(expiryTimer.current);
      verified.current = null;
      setState({ user: null, loading: true, error: null });
    }
    try {
      if (!validTime) throw new Error('Expired session');
      const user = previous?.token === session.access_token && previous.user.id === session.user.id ? previous.user : await (async () => {
        const { data, error } = await client.auth.getUser(session.access_token);
        if (error || !data.user || data.user.id !== session.user.id) throw new Error('Invalid session');
        return data.user;
      })();
      if (!active.current || ticket !== revision.current || signingOut.current) return;
      if (expiresAt * 1000 <= Date.now()) throw new Error('Expired session');
      clearTimeout(expiryTimer.current);
      verified.current = { token: session.access_token, user };
      setState({ user, loading: false, error: null });
      // The SDK refreshes automatically. If it cannot refresh, hide the preview at
      // expiry instead of leaving authenticated content mounted indefinitely.
      expiryTimer.current = setTimeout(() => {
        ++revision.current;
        verified.current = null;
        setState({ user: null, loading: false, error: 'Your session expired. Sign in again.' });
      }, Math.min(expiresAt * 1000 - Date.now(), 2_147_483_647));
    } catch {
      if (!active.current || ticket !== revision.current || signingOut.current) return;
      clearTimeout(expiryTimer.current);
      verified.current = null;
      setState({ user: null, loading: false, error: sessionError });
    }
  }, [client]);

  useEffect(() => {
    active.current = true;
    const generation = revision;
    let eventSeen = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true;
      if (signingOut.current) return;
      // Invalidate in-flight verification immediately, but make SDK calls outside
      // the synchronous auth callback to avoid re-entering its session lock.
      const eventTicket = ++revision.current;
      if (!session || verified.current?.user.id !== session.user.id) {
        verified.current = null;
        setState({ user: null, loading: !!session, error: null });
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (eventTicket === revision.current) void receive(session);
      }, 0);
      timers.add(timer);
    });
    const initialTicket = revision.current;
    void client.auth.getSession().then(({ data, error }) => {
      if (!active.current || eventSeen || revision.current !== initialTicket) return;
      if (error) {
        setState({ user: null, loading: false, error: sessionError });
      } else void receive(data.session);
    }).catch(() => {
      if (active.current && !eventSeen && revision.current === initialTicket) {
        setState({ user: null, loading: false, error: sessionError });
      }
    });
    return () => {
      active.current = false;
      ++generation.current;
      subscription.unsubscribe();
      timers.forEach(clearTimeout);
      clearTimeout(expiryTimer.current);
    };
  }, [client, receive]);

  const signIn = async (email: string, password: string) => {
    setBusy(true);
    setState({ user: null, loading: false, error: null });
    const ticket = ++revision.current;
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (!active.current) return;
      if (error) throw error;
      if (!data.session) throw new Error('Missing session');
      // Auth events own newer state. A response must never resurrect an account
      // after a later SIGNED_OUT or account switch.
      if (ticket === revision.current) await receive(data.session);
    } catch (error) {
      if (active.current && ticket === revision.current) {
        setState({ user: null, loading: false, error: signInError(error) });
      }
    } finally { if (active.current) setBusy(false); }
  };

  const signOut = async () => {
    signingOut.current = true;
    setSignOutFailed(true);
    ++revision.current;
    verified.current = null;
    clearTimeout(expiryTimer.current);
    setBusy(true);
    setState({ user: null, loading: false, error: null });
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      if (active.current) {
        signingOut.current = false;
        setSignOutFailed(false);
        setState({ user: null, loading: false, error: null });
      }
    } catch {
      if (active.current) setState({ user: null, loading: false,
        error: 'Sign-out did not finish. Your saved session may remain in this browser. Check your connection and retry sign-out before leaving this device.' });
    } finally { if (active.current) setBusy(false); }
  };

  return { ...state, busy, signIn, signOut, signOutFailed };
}
