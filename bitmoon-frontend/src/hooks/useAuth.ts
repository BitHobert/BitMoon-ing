import { useState, useCallback } from 'react';
import { getNonce, startSession } from '../api/http';
import type { TournamentType } from '../types';

export interface AuthState {
  token: string | null;
  sessionId: string | null;
  expiresAt: number | null;
  loggingIn: boolean;
  error: string | null;
}

export interface AuthActions {
  login: (
    address: string,
    signFn: (msg: string) => Promise<string>,
    getPublicKeyFn: () => Promise<string>,
    tournamentType?: TournamentType,
  ) => Promise<void>;
  logout: () => void;
}

const initialState: AuthState = {
  token: null,
  sessionId: null,
  expiresAt: null,
  loggingIn: false,
  error: null,
};

export function useAuth(): AuthState & AuthActions {
  const [state, setState] = useState<AuthState>(initialState);

  const login = useCallback(async (
    address: string,
    signFn: (msg: string) => Promise<string>,
    getPublicKeyFn: () => Promise<string>,
    tournamentType?: TournamentType,
  ) => {
    setState((s) => ({ ...s, loggingIn: true, error: null }));
    try {
      const { message } = await getNonce(address);
      const [signature, publicKey] = await Promise.all([
        signFn(message),
        getPublicKeyFn(),
      ]);
      const { sessionId, token, expiresAt } = await startSession({
        playerAddress: address,
        signature,
        message,
        publicKey,
        tournamentType,
      });
      // Token stored in React state only — never written to localStorage
      setState({ token, sessionId, expiresAt, loggingIn: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auth failed';
      setState((s) => ({ ...s, loggingIn: false, error: message }));
      throw err; // re-throw so callers can react
    }
  }, []);

  const logout = useCallback(() => {
    setState(initialState);
  }, []);

  return { ...state, login, logout };
}
