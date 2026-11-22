import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

type AdminUser = {
  user_id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  status: string;
  role: string;
  created_at: string;
  onboarding_complete: boolean;
};
type AuditItem = {
  id: number;
  actor_user_id: string;
  target_user_id: string | null;
  action: string;
  reason: string;
  created_at: string;
};
type AdminData = { users: AdminUser[]; total: number; suspended: number; audit: AuditItem[] };
type ApiResult = { ok?: boolean; error?: string; message?: string } & Partial<AdminData>;

export const Route = createFileRoute("/admin")({ component: AdminPage });

function AdminPage() {
  const [data, setData] = useState<AdminData>({ users: [], total: 0, suspended: 0, audit: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [denied, setDenied] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const callAdmin = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!supabase) throw new Error("BANTER is not configured.");
    const { data: result, error } = await supabase.functions.invoke("banter-api", { body: { action, data: payload } });
    if (error) { const status = (error as { context?: { status?: number } }).context?.status; throw new Error(status === 403 ? "ADMIN_ACCESS_DENIED" : error.message || "Admin request failed."); }
    const response = result as ApiResult;
    if (!response?.ok) throw new Error(response?.error || "Admin request failed.");
    return response;
  }, []);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setNotice("");
    try {
      const { data: session } = await supabase!.auth.getSession();
      if (!session.session) { setSignedOut(true); return; }
      const result = await callAdmin("admin_list_users", { q });
      setData({
        users: result.users ?? [],
        total: result.total ?? 0,
        suspended: result.suspended ?? 0,
        audit: result.audit ?? [],
      });
      setDenied(false);
      setSignedOut(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load admin dashboard.";
      if (/admin access|required|403|ADMIN_ACCESS_DENIED/i.test(message)) setDenied(true);
      else setNotice(message);
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { void load(""); }, [load]);

  const moderate = async (target: AdminUser, action: "admin_ban_user" | "admin_restore_user" | "admin_delete_user") => {
    const label = action === "admin_ban_user" ? "permanently ban" : action === "admin_restore_user" ? "restore" : "permanently delete";
    if (!window.confirm(`Are you sure you want to ${label} @${target.username ?? target.display_name}?`)) return;
    let confirmation: string | undefined;
    if (action === "admin_delete_user") {
      confirmation = window.prompt("This permanently removes the account and its authored messages. Type DELETE to continue.") ?? "";
      if (confirmation !== "DELETE") return;
    }
    setBusy(target.user_id);
    setNotice("");
    try {
      const result = await callAdmin(action, { userId: target.user_id, reason, ...(confirmation ? { confirmation } : {}) });
      setNotice(result.message ?? "Action completed.");
      await load(query);
      setReason("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => { await supabase?.auth.signOut(); setSignedOut(true); };

  if (signedOut) return <Shell><Panel><Mark /><h1 className="mt-5 font-display text-3xl">Sign in to BANTER</h1><p className="mt-2 text-sm text-[#a79b92]">Sign in with your admin account, then reopen this dashboard.</p><a className="mt-6 inline-flex rounded-full bg-[#e47d4f] px-5 py-3 font-semibold text-[#1b120e]" href="/">Open BANTER sign in</a></Panel></Shell>;
  if (denied) return <Shell><Panel><Mark /><div className="mt-5 inline-flex rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1 text-xs text-red-300">ACCESS DENIED</div><h1 className="mt-4 font-display text-3xl">Admin access only</h1><p className="mt-2 text-sm text-[#a79b92]">This account is not authorised to manage BANTER. The dashboard and moderation actions are restricted on the server.</p><a className="mt-6 inline-flex rounded-full border border-white/15 px-5 py-3 text-sm" href="/">Back to BANTER</a></Panel></Shell>;

  return <Shell>
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><Mark /><div><p className="text-[10px] font-bold tracking-[.28em] text-[#e47d4f]">CONTROL ROOM</p><h1 className="font-display text-3xl sm:text-4xl">BANTER Admin</h1></div></div>
      <div className="flex gap-2"><a href="/" className="rounded-full border border-white/15 px-4 py-2 text-sm text-[#e9ded5]">Open app</a><button onClick={() => void signOut()} className="rounded-full border border-white/15 px-4 py-2 text-sm text-[#e9ded5]">Sign out</button></div>
    </header>
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Stat label="Registered profiles" value={data.total} />
      <Stat label="Currently banned" value={data.suspended} />
      <Stat label="Visible in this list" value={data.users.length} />
    </div>
    <section className="rounded-[1.75rem] border border-white/10 bg-[#1b1715] p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold tracking-[.2em] text-[#e47d4f]">USER MANAGEMENT</p><h2 className="mt-1 font-display text-2xl">People</h2><p className="mt-1 text-xs text-[#a79b92]">Search accounts, apply bans, restore access or permanently remove an account.</p></div><button onClick={() => void load(query)} className="rounded-full border border-white/15 px-4 py-2 text-xs">Refresh</button></div>
      <form className="mt-5 flex gap-2" onSubmit={(event) => { event.preventDefault(); void load(query); }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search username or display name" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#100e0d] px-4 py-3 text-sm outline-none focus:border-[#e47d4f]" />
        <button className="rounded-2xl bg-[#e47d4f] px-5 py-3 text-sm font-semibold text-[#1b120e]">Search</button>
      </form>
      <label className="mt-4 block text-xs text-[#a79b92]">Moderation note (optional)<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Reason recorded in the admin audit log" className="mt-2 w-full rounded-2xl border border-white/10 bg-[#100e0d] px-4 py-3 text-sm text-white outline-none focus:border-[#e47d4f]" /></label>
      {notice ? <p role="status" className="mt-4 rounded-2xl border border-[#e47d4f]/30 bg-[#e47d4f]/10 px-4 py-3 text-sm text-[#f0b18e]">{notice}</p> : null}
      {loading ? <p className="py-10 text-center text-sm text-[#a79b92]">Loading accounts…</p> : data.users.length === 0 ? <p className="py-10 text-center text-sm text-[#a79b92]">No matching accounts.</p> : <div className="mt-4 space-y-2">
        {data.users.map((person) => <article key={person.user_id} className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-[#14110f] p-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {person.avatar_url ? <img src={person.avatar_url} alt="" className="size-11 rounded-full object-cover" /> : <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#34251f] font-semibold text-[#e9a07b]">{person.display_name.slice(0,1).toUpperCase()}</div>}
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{person.display_name}</p><p className="truncate text-xs text-[#a79b92]">@{person.username ?? "no-username"} · {person.user_id.slice(0,8)}…</p><p className="mt-1 text-[10px] text-[#8d8179]">{new Date(person.created_at).toLocaleDateString()} · {person.onboarding_complete ? "Profile ready" : "Setup incomplete"}</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${person.status === "active" ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>{person.status}</span>
            {person.role === "admin" ? <span className="rounded-full bg-[#e47d4f]/10 px-3 py-1 text-[10px] font-semibold text-[#e9a07b]">ADMIN</span> : person.status === "suspended" ? <button disabled={busy === person.user_id} onClick={() => void moderate(person,"admin_restore_user")} className="rounded-full border border-emerald-400/30 px-3 py-2 text-xs text-emerald-300 disabled:opacity-50">Restore</button> : <button disabled={busy === person.user_id} onClick={() => void moderate(person,"admin_ban_user")} className="rounded-full border border-amber-400/30 px-3 py-2 text-xs text-amber-200 disabled:opacity-50">Permanent ban</button>}
            {person.role !== "admin" ? <button disabled={busy === person.user_id} onClick={() => void moderate(person,"admin_delete_user")} className="rounded-full border border-red-400/30 px-3 py-2 text-xs text-red-300 disabled:opacity-50">Delete</button> : null}
          </div>
        </article>)}
      </div>}
    </section>
    <section className="mt-6 rounded-[1.75rem] border border-white/10 bg-[#1b1715] p-4 sm:p-6"><p className="text-xs font-semibold tracking-[.2em] text-[#e47d4f]">AUDIT TRAIL</p><h2 className="mt-1 font-display text-2xl">Recent admin actions</h2>{data.audit.length ? <div className="mt-4 space-y-2">{data.audit.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-[#14110f] p-3"><div><p className="text-sm font-medium">{item.action.replaceAll("_"," ")}</p><p className="mt-1 text-xs text-[#a79b92]">{item.reason || "No note"} · target {item.target_user_id?.slice(0,8) ?? "—"}…</p></div><time className="text-[10px] text-[#8d8179]">{new Date(item.created_at).toLocaleString()}</time></div>)}</div> : <p className="mt-4 text-sm text-[#a79b92]">No moderation actions yet.</p>}</section>
    <p className="mt-5 text-center text-[10px] text-[#746a64]">Private administration · Every moderation action is checked server-side and recorded.</p>
  </Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-[#100e0d] px-4 py-7 text-[#f3eae2] sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl">{children}</div></main>;
}
function Panel({ children }: { children: ReactNode }) {
  return <div className="mx-auto mt-20 max-w-md rounded-[2rem] border border-white/10 bg-[#1b1715] p-7 shadow-2xl">{children}</div>;
}
function Mark() {
  return <div className="grid size-12 place-items-center rounded-2xl bg-[#e47d4f] text-xl font-black text-[#1b120e]">B.</div>;
}
function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-[1.5rem] border border-white/10 bg-[#1b1715] p-5"><p className="text-xs text-[#a79b92]">{label}</p><p className="mt-2 font-display text-3xl">{value.toLocaleString()}</p></div>;
}
