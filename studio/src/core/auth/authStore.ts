import { create } from 'zustand';

export interface ZoryUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}
export type AuthStatus = 'unconfigured' | 'loading' | 'signed-out' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  user: ZoryUser | null;
  error: string | null;
  busy: boolean;
  init: () => void;
  signOut: () => Promise<void>;
  clearError: () => void;
}

/** Studio has no sign-in. The store exists so editor code reads "nobody signed in". */
export const useAuthStore = create<AuthState>(() => ({
  status: 'unconfigured',
  user: null,
  error: null,
  busy: false,
  init: () => {},
  signOut: async () => {},
  clearError: () => {},
}));
export const authAvailable = (): boolean => false;
export const selectUser = (s: AuthState): ZoryUser | null => s.user;
export const selectSignedIn = (s: AuthState): boolean => s.status === 'signed-in';
