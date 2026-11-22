import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type AuthUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
};

function mapUser(user: User): AuthUser {
  const metadata = user.user_metadata ?? {};
  return {
    id: user.id,
    name: typeof metadata.display_name === "string"
      ? metadata.display_name
      : typeof metadata.name === "string" ? metadata.name : null,
    email: user.email ?? "",
    image: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
  };
}

function mapSession(session: Session | null) {
  return session ? { user: mapUser(session.user) } : null;
}

/**
 * Small compatibility surface while the UI moves from Better Auth to Supabase.
 * All credentials and sessions are handled by Supabase Auth.
 */
export const authClient = {
  useSession() {
    const [data, setData] = useState<ReturnType<typeof mapSession>>(null);
    const [isPending, setIsPending] = useState(true);

    useEffect(() => {
      if (!supabase) {
        setIsPending(false);
        return;
      }
      let alive = true;
      void supabase.auth.getSession().then(({ data: result, error }) => {
        if (!alive) return;
        setData(error ? null : mapSession(result.session));
        setIsPending(false);
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!alive) return;
        setData(mapSession(session));
        setIsPending(false);
      });
      return () => {
        alive = false;
        listener.subscription.unsubscribe();
      };
    }, []);

    return { data, isPending };
  },

  signUp: {
    email: async ({ email, password, name }: { email: string; password: string; name: string; callbackURL?: string }) => {
      if (!supabase) return { error: { message: "BANTER is not configured yet." } };
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name, name } },
      });
      return { error: error ? { message: error.message } : null, needsEmailConfirmation: !error && !data.session };
    },
  },

  signIn: {
    email: async ({ email, password }: { email: string; password: string; callbackURL?: string }) => {
      if (!supabase) return { error: { message: "BANTER is not configured yet." } };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? { message: error.message } : null };
    },
  },


  changePassword: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) => {
    if (!supabase) return { error: { message: "BANTER is not configured yet." } };
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (userError || !email) return { error: { message: userError?.message ?? "Sign in again before changing your password." } };
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) return { error: { message: "Your current password is incorrect." } };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error ? { message: error.message } : null };
  },

  signOut: async () => {
    if (!supabase) return { error: null };
    const { error } = await supabase.auth.signOut({ scope: "local" });
    return { error: error ? { message: error.message } : null };
  },
};

export async function signOut(redirectTo = "/"): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
  if (typeof window !== "undefined") window.location.href = redirectTo;
}
