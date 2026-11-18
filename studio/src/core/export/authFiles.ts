/**
 * Real authentication in an exported project.
 *
 * The unlock here is that the credentials are the user's own. Zory does not
 * run an auth service, does not hold anyone's users and does not sit in the
 * request path — it generates the same Supabase or Firebase code a competent
 * developer would write against the keys already entered in the Connect panel.
 * Delete Zory and the login still works, because there was never anything of
 * Zory's in it.
 *
 * What that means for what can honestly be promised: the generated project is
 * type-checked and built by the export verifier, so the code is correct and
 * compiles. Whether a session is actually issued depends on the user's own
 * Supabase or Firebase project being set up, which is theirs and not
 * observable from here. The README says exactly that rather than implying
 * more.
 *
 * Only the public keys are used. Supabase's anon key and Firebase's web config
 * are public by design — access is controlled by row level security and
 * security rules respectively, not by hiding them — and no service role key or
 * server secret is ever referenced by client code.
 */

import type { IntegrationValues } from '../integrations/store';

export interface ExportFile {
  path: string;
  content: string;
}

export type AuthProvider = 'supabase' | 'firebase' | null;

/**
 * Which provider the export should wire up.
 *
 * Supabase wins when both are present: it needs one URL and one key, where
 * Firebase needs four values to be correct before anything works at all.
 */
export function detectAuthProvider(values: IntegrationValues): AuthProvider {
  const supabase = values['supabase'] ?? {};
  if ((supabase['VITE_SUPABASE_URL'] ?? '').trim() && (supabase['VITE_SUPABASE_ANON_KEY'] ?? '').trim()) {
    return 'supabase';
  }

  const firebase = values['firebase'] ?? {};
  if (
    (firebase['VITE_FIREBASE_API_KEY'] ?? '').trim() &&
    (firebase['VITE_FIREBASE_PROJECT_ID'] ?? '').trim()
  ) {
    return 'firebase';
  }

  return null;
}

/** npm dependencies the generated auth needs. */
export function authDependencies(provider: AuthProvider): Record<string, string> {
  if (provider === 'supabase') return { '@supabase/supabase-js': '^2.58.0' };
  if (provider === 'firebase') return { firebase: '^12.4.0' };
  return {};
}

const SUPABASE_CLIENT = `import { createClient } from '@supabase/supabase-js';

/*
 * The anon key is public by design. It identifies the project, it does not
 * grant access — row level security policies on your tables decide what any
 * given user can read or write. Never put the service role key in here; it
 * bypasses every policy you have written.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

export const supabase = createClient(url, anonKey);
`;

const SUPABASE_AUTH_CONTEXT = `import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './client';

interface AuthState {
  user: User | null;
  session: Session | null;
  /** True until the first session check finishes. */
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /*
     * Read the stored session first, then subscribe. Without the initial read
     * a returning user is shown the signed-out UI for a frame before the
     * listener catches up, which reads as being logged out.
     */
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      },
      async signUp(email, password) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw new Error(error.message);
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
`;

const FIREBASE_CLIENT = `import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

/*
 * A Firebase web config is public by design — it identifies the project and
 * ships in every client bundle. Access is controlled by your security rules,
 * not by keeping these values secret.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!config.apiKey || !config.projectId) {
  throw new Error(
    'Firebase is not configured. Copy .env.example to .env and fill in the VITE_FIREBASE_* values.',
  );
}

export const app = initializeApp(config);
export const auth = getAuth(app);
`;

const FIREBASE_AUTH_CONTEXT = `import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './client';

interface AuthState {
  user: User | null;
  /** True until the first auth state callback fires. */
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        setUser(next);
        setLoading(false);
      }),
    [],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email, password);
      },
      async signUp(email, password) {
        await createUserWithEmailAndPassword(auth, email, password);
      },
      async signOut() {
        await firebaseSignOut(auth);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
`;

/** Shared by both providers: the form, and the gate. */
const SIGN_IN_FORM = `import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';

/**
 * Email and password sign in, with registration on the same form.
 *
 * Plain markup and your own classes — restyle it freely, it is yours.
 */
export function SignInForm() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(email, password);
      else await signUp(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <h1>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>

      <label htmlFor="auth-email">Email</label>
      <input
        id="auth-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <label htmlFor="auth-password">Password</label>
      <input
        id="auth-password"
        type="password"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        required
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={busy}>
        {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>

      <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
      </button>
    </form>
  );
}
`;

const PROTECTED = `import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { SignInForm } from './SignInForm';

/**
 * Wrap anything that requires an account.
 *
 * Note what this is and is not. It hides UI from signed-out visitors, which is
 * the right behaviour for a page. It is not a security boundary: anything the
 * browser can fetch, a signed-out person can fetch directly. Protect the data
 * itself with Supabase row level security or Firebase security rules — this
 * component protects the view, those protect the records.
 */
export function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <p>Loading…</p>;
  if (!user) return <SignInForm />;
  return <>{children}</>;
}
`;

export function buildAuthFiles(provider: AuthProvider): ExportFile[] {
  if (!provider) return [];

  const client = provider === 'supabase' ? SUPABASE_CLIENT : FIREBASE_CLIENT;
  const context = provider === 'supabase' ? SUPABASE_AUTH_CONTEXT : FIREBASE_AUTH_CONTEXT;

  return [
    { path: 'src/auth/client.ts', content: client },
    { path: 'src/auth/AuthProvider.tsx', content: context },
    { path: 'src/auth/SignInForm.tsx', content: SIGN_IN_FORM },
    { path: 'src/auth/Protected.tsx', content: PROTECTED },
  ];
}

export function authReadmeSection(provider: AuthProvider): string {
  if (!provider) return '';

  const name = provider === 'supabase' ? 'Supabase' : 'Firebase';

  return [
    '',
    '## Authentication',
    '',
    `Email and password sign in, wired to your own ${name} project. Zory does not`,
    'run an auth service and holds none of your users — this is ordinary',
    `${name} code against the keys in \`.env\`.`,
    '',
    '```tsx',
    "import { AuthProvider } from './auth/AuthProvider';",
    "import { Protected } from './auth/Protected';",
    '',
    '<AuthProvider>',
    '  <Protected>',
    '    <YourPage />',
    '  </Protected>',
    '</AuthProvider>',
    '```',
    '',
    '`useAuth()` gives you `user`, `loading`, `signIn`, `signUp` and `signOut`.',
    '',
    '### Before it will work',
    '',
    provider === 'supabase'
      ? '- Enable the Email provider in Supabase → Authentication → Providers.\n- Add row level security policies. The anon key is public; policies are what actually protect your data.'
      : '- Enable Email/Password in Firebase → Authentication → Sign-in method.\n- Add your domain under Authentication → Settings → Authorized domains.\n- Write security rules. The web config is public; rules are what actually protect your data.',
    '',
    '`<Protected>` hides UI from signed-out visitors. It is not a security',
    'boundary — anything the browser can fetch, a signed-out person can fetch.',
    'Protect the records with policies or rules, not with the component.',
    '',
  ].join('\n');
}
