import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://lldfnrowwomejmxwfdqf.supabase.co";
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "sb_publishable_ad-25Rlx1wiNqGXoZeTRIg_8xO9xFwj";

export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error("BANTER is not configured yet. Please try again later.");
  }
  return supabase;
}
