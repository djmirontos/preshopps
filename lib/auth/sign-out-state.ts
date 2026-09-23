/** Shared shape for signOutAction's own useActionState result -- kept in
 * its own plain module because a "use server" file (lib/auth/actions.ts)
 * may only export async functions; a type or constant exported from there
 * directly breaks the Next.js Server Actions build ("Only async functions
 * are allowed to be exported in a 'use server' file"). */
export type SignOutActionState = {
  error: string | null;
};

export const SIGN_OUT_ERROR_MESSAGE = "We couldn't sign you out. Please try again.";
