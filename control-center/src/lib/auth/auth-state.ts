/**
 * Client-visible auth state tracking and normalization.
 * This is a lightweight store for keeping UI auth indicators in sync
 * with server-validated auth responses.
 */

export const AUTH_STATE_HEADER = 'x-afu9-auth-state';

export type AuthState =
  | 'authenticated'
  | 'unauthenticated'
  | 'refresh-required'
  | 'invalid'
  | 'forbidden'
  | 'public'
  | 'service'
  | 'smoke'
  | 'unknown';

const AUTH_STATES: ReadonlySet<AuthState> = new Set([
  'authenticated',
  'unauthenticated',
  'refresh-required',
  'invalid',
  'forbidden',
  'public',
  'service',
  'smoke',
  'unknown',
]);

let currentAuthState: AuthState = 'unknown';
const listeners = new Set<(state: AuthState) => void>();

export function getAuthState(): AuthState {
  return currentAuthState;
}

export function normalizeAuthState(value: string | null): AuthState | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return AUTH_STATES.has(normalized as AuthState) ? (normalized as AuthState) : null;
}

export function setAuthState(next: AuthState): void {
  if (next === currentAuthState) return;
  currentAuthState = next;
  for (const listener of listeners) {
    listener(currentAuthState);
  }
}

export function subscribeAuthState(listener: (state: AuthState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateAuthStateFromResponse(response: Response): void {
  const headerValue = response.headers?.get?.(AUTH_STATE_HEADER) ?? null;
  const headerState = normalizeAuthState(headerValue);
  if (headerState) {
    setAuthState(headerState);
    return;
  }

  if (response.status === 401) {
    setAuthState('unauthenticated');
  } else if (response.status === 403) {
    setAuthState('forbidden');
  }
}
