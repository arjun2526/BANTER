import { createAuthClient } from "better-auth/react";

/**
 * BANTER's browser auth client.
 *
 * Authentication is owned by this application through its own Better Auth
 * endpoint at /api/auth/*. Sessions use same-origin, HttpOnly cookies.
 */
export const authClient = createAuthClient();


export async function signOut(redirectTo = "/"): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
  if (typeof window !== "undefined") window.location.href = redirectTo;
}
