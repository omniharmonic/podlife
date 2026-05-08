/**
 * Thin shell around @simplewebauthn/browser. Exposes capability detection
 * and the two flows we care about: enroll a passkey for the current
 * session, and sign in with one. Both paths surface a single typed result
 * to the call site so the UI can branch on success/cancel/unsupported
 * without parsing exception types.
 */
import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';
import type { Person } from '@pod-life/shared';
import { passkeys } from '@/lib/api';

export function isPasskeySupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

export type EnrollResult =
  | { status: 'enrolled'; credentialId: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export async function enrollPasskey(nickname?: string): Promise<EnrollResult> {
  try {
    const { options } = await passkeys.registerOptions();
    const response = await startRegistration({
      optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
    });
    const result = await passkeys.registerVerify(response, nickname);
    return { status: 'enrolled', credentialId: result.credentialId };
  } catch (err) {
    if (isUserCancellation(err)) return { status: 'cancelled' };
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Could not save the passkey',
    };
  }
}

export type SignInResult =
  | { status: 'signed-in'; sessionToken: string; person: Person }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export async function signInWithPasskey(email?: string): Promise<SignInResult> {
  try {
    const { options } = await passkeys.authenticateOptions(email);
    const response = await startAuthentication({
      optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
    });
    const result = await passkeys.authenticateVerify(response, email);
    return { status: 'signed-in', sessionToken: result.sessionToken, person: result.person };
  } catch (err) {
    if (isUserCancellation(err)) return { status: 'cancelled' };
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Could not sign in with a passkey',
    };
  }
}

/**
 * Treat the standard "user cancelled the prompt" cases as a non-error so
 * the UI can fall back silently. WebAuthn surfaces these as DOMException
 * with `name` of NotAllowedError or AbortError, depending on platform.
 */
function isUserCancellation(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return err.name === 'NotAllowedError' || err.name === 'AbortError';
}
