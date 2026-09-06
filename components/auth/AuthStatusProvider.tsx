"use client";

import { createContext, useContext, type ReactNode } from "react";

const AuthStatusContext = createContext<boolean>(false);

type Props = {
  isAuthenticated: boolean;
  children: ReactNode;
};

/**
 * Minimal shared auth-status source. The root layout already resolves the
 * signed-in user server-side once per request; this makes that single
 * boolean available to client components (FavoriteButton, rendered many
 * times per page via ListingCard) without each one independently creating
 * a Supabase client, calling getUser/getSession, or installing its own
 * onAuthStateChange subscription. Intentionally not a general auth/user
 * context -- no token, session, or profile data is ever stored here.
 */
export function AuthStatusProvider({ isAuthenticated, children }: Props) {
  return <AuthStatusContext.Provider value={isAuthenticated}>{children}</AuthStatusContext.Provider>;
}

export function useAuthStatus(): boolean {
  return useContext(AuthStatusContext);
}
