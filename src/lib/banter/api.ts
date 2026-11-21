import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { cleanDisplayName, cleanInterests, cleanUsername, snippet } from "@/lib/banter/rules";

type Ok<T extends object> = { ok: true } & T;
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function parseList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseSocials(raw: unknown): { label: string; url: string }[] {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: { label: string; url: string }[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const label = "label" in item && typeof item.label === "string" ? item.label : "";
    const url = "url" in item && typeof item.url === "string" ? item.url : "";
    if (label && url) out.push({ label, url });
  }
  return out.slice(0, 3);
}

const IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"]);
const FILE = new Set([
  "application/pdf",
  "text/plain",
  "application/octet-stream",
]);

function bareBase64(input: string): string | null {
  const matched = input.match(/^data:[^;]+;base64,([\s\S]+)$/);
  const b = (matched ? matched[1] : input).replace(/\s/g, "");
  if (b.length < 16 || b.length > 1_200_000) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b)) return null;
  return b;
}

type ProfileRow = {
  user_id: string;
  username: string | null;
  display_name: string;
  bio: string;
  about: string;
  avatar_url: string | null;
  birthday: string | null;
  location: string;
  interests: string;
  hobbies: string;
  socials: string;
  discoverability: string;
  last_seen_visibility: string;
  show_online: boolean;
  read_receipts: boolean;
  theme: string;
  status: string;
  role: string;
  onboarding_complete: boolean;
  notify_messages: boolean;
  notify_friends: boolean;
  notify_stories: boolean;
  last_seen_at: unknown;
  username_changed_at: unknown;
  created_at: unknown;
};

function mapMe(row: ProfileRow, email: string) {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    about: row.about,
    avatarUrl: safeMediaUrl(row.avatar_url),
    birthday: row.birthday,
    location: row.location,
    interests: parseList(row.interests),
    hobbies: row.hobbies,
    socials: parseSocials(row.socials),
    discoverability: row.discoverability,
    lastSeenVisibility: row.last_seen_visibility,
    showOnline: row.show_online,
    readReceipts: row.read_receipts,
    theme: row.theme === "light" ? "light" : "dark",
    status: row.status,
    role: row.role === "admin" ? "admin" : "user",
    onboardingComplete: row.onboarding_complete,
    notifyMessages: row.notify_messages,
    notifyFriends: row.notify_friends,
    notifyStories: row.notify_stories,
    lastSeenAt: iso(row.last_seen_at),
    usernameChangedAt: iso(row.username_changed_at),
    createdAt: iso(row.created_at),
    email,
  };
}

function safeMediaUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("https://") || url.startsWith("http://")) return url;
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(url)) return url;
  return null;
}

async function authUser(sql: Sql, userId: string) {
  const rows = await sql<{ name: string; email: string; image: string | null }>`
    select "name", "email", "image" from "user" where "id" = ${userId}
  `;
  return rows[0] ?? { name: "New member", email: "", image: null };
}

async function allow(
  sql: Sql,
  userId: string,
  action: string,
  limit: number,
  windowMs: number,
) {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const rows = await sql<{ n: number }>`
    select count(*) as n from rate_events
    where user_id = ${userId} and action = ${action} and created_at > ${cutoff}
  `;
  if (num(rows[0]?.n) >= limit) return false;
  await sql`insert into rate_events (user_id, action) values (${userId}, ${action})`;
  return true;
}

async function blocked(sql: Sql, a: string, b: string) {
  const rows = await sql<{ x: number }>`
    select 1 as x from blocks
    where (blocker_id = ${a} and blocked_id = ${b})
       or (blocker_id = ${b} and blocked_id = ${a})
  `;
  return rows.length > 0;
}

async function blockedByMe(sql: Sql, me: string, them: string) {
  const rows = await sql<{ x: number }>`
    select 1 as x from blocks where blocker_id = ${me} and blocked_id = ${them}
  `;
  return rows.length > 0;
}

async function friends(sql: Sql, a: string, b: string) {
  const [x, y] = pair(a, b);
  const rows = await sql<{ x: number }>`
    select 1 as x from friendships where user_a = ${x} and user_b = ${y}
  `;
  return rows.length > 0;
}

async function notify(
  sql: Sql,
  userId: string,
  kind: string,
  title: string,
  body: string,
  href: string,
) {
  await sql`
    insert into notifications (id, user_id, kind, title, body, href)
    values (${crypto.randomUUID()}, ${userId}, ${kind}, ${title}, ${body}, ${href})
  `;
}

async function memberRole(sql: Sql, conversationId: string, userId: string) {
  const rows = await sql<{ role: string }>`
    select role from conversation_members
    where conversation_id = ${conversationId} and user_id = ${userId} and left_at is null
  `;
  return rows[0]?.role ?? null;
}

async function loadProfile(sql: Sql, userId: string) {
  const rows = await sql<ProfileRow>`select * from profiles where user_id = ${userId}`;
  return rows[0] ?? null;
}

function activeError(row: ProfileRow): string | null {
  if (!row.onboarding_complete) return "Finish setting up your Banter profile first.";
  if (row.status === "suspended") return "This account is suspended.";
  if (row.status === "deactivated") return "Reactivate your account to do that.";
  if (row.status !== "active") return "This account is not active.";
  return null;
}

async function requireActive(sql: Sql, userId: string) {
  const row = await loadProfile(sql, userId);
  if (!row) return { error: "Profile missing." as const, row: null };
  const error = activeError(row);
  if (error) return { error, row };
  return { error: null, row };
}

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<
    | { ok: true; tombstone: true }
    | { ok: true; tombstone: false; me: ReturnType<typeof mapMe> }
    | Err
  > => {
    const sql = await getSql();
    const tomb = await sql<{ user_id: string }>`
      select user_id from account_tombstones where user_id = ${context.userId}
    `;
    if (tomb[0]) return { ok: true, tombstone: true };
    const auth = await authUser(sql, context.userId);
    let row = await loadProfile(sql, context.userId);
    if (!row) {
      const name = cleanDisplayName(auth.name) ?? "New member";
      await sql`
        insert into profiles (user_id, display_name, avatar_url)
        values (${context.userId}, ${name}, ${safeMediaUrl(auth.image)})
        on conflict (user_id) do nothing
      `;
      row = await loadProfile(sql, context.userId);
    }
    if (!row) return fail("Could not open your profile.");
    return { ok: true, tombstone: false, me: mapMe(row, auth.email) };
  });

const Onboard = z.object({
  displayName: z.string(),
  username: z.string(),
  bio: z.string().max(160).optional(),
  about: z.string().max(600).optional(),
  interests: z.array(z.string()).max(12),
  hobbies: z.string().max(200).optional(),
});

export const completeOnboarding = createServerFn({ method: "POST" })
  .validator((input: unknown) => Onboard.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ me: ReturnType<typeof mapMe> }> | Err> => {
    const sql = await getSql();
    const row = await loadProfile(sql, context.userId);
    if (!row) return fail("Profile missing.");
    if (row.status === "suspended") return fail("This account is suspended.");
    const displayName = cleanDisplayName(data.displayName);
    const username = cleanUsername(data.username);
    if (!displayName) return fail("Use a name between 1 and 40 characters.");
    if (!username) return fail("Banter IDs are 3–20 characters: letters, numbers, underscores.");
    const taken = await sql<{ user_id: string }>`
      select user_id from profiles where username = ${username} and user_id <> ${context.userId}
    `;
    if (taken[0]) return fail("That Banter ID is taken.");
    const interests = JSON.stringify(cleanInterests(data.interests));
    await sql`
      update profiles set
        display_name = ${displayName},
        username = ${username},
        bio = ${(data.bio ?? "").trim().slice(0, 160)},
        about = ${(data.about ?? "").trim().slice(0, 600)},
        hobbies = ${(data.hobbies ?? "").trim().slice(0, 200)},
        interests = ${interests},
        onboarding_complete = true,
        username_changed_at = now(),
        status = 'active'
      where user_id = ${context.userId}
    `;
    await sql`
      update profiles set role = 'admin'
      where user_id = ${context.userId}
        and not exists (select 1 from profiles where role = 'admin' and user_id <> ${context.userId})
    `;
    const auth = await authUser(sql, context.userId);
    const next = await loadProfile(sql, context.userId);
    if (!next) return fail("Could not save your profile.");
    return { ok: true, me: mapMe(next, auth.email) };
  });

export const checkUsername = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ username: z.string() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true; available: boolean; username: string | null }> => {
    const username = cleanUsername(data.username);
    if (!username) return { ok: true, available: false, username: null };
    const sql = await getSql();
    const taken = await sql<{ user_id: string }>`
      select user_id from profiles where username = ${username} and user_id <> ${context.userId}
    `;
    return { ok: true, available: !taken[0], username };
  });

const ProfilePatch = z.object({
  displayName: z.string().optional(),
  username: z.string().optional(),
  bio: z.string().max(160).optional(),
  about: z.string().max(600).optional(),
  hobbies: z.string().max(200).optional(),
  location: z.string().max(60).optional(),
  birthday: z.string().nullable().optional(),
  interests: z.array(z.string()).max(12).optional(),
  socials: z.array(z.object({ label: z.string().max(24), url: z.string().max(200) })).max(3).optional(),
  avatarUrl: z.string().max(500_000).nullable().optional(),
  discoverability: z.enum(["everyone", "friends", "nobody"]).optional(),
  lastSeenVisibility: z.enum(["everyone", "friends", "nobody"]).optional(),
  showOnline: z.boolean().optional(),
  readReceipts: z.boolean().optional(),
  theme: z.enum(["dark", "light"]).optional(),
  notifyMessages: z.boolean().optional(),
  notifyFriends: z.boolean().optional(),
  notifyStories: z.boolean().optional(),
});

export const updateProfile = createServerFn({ method: "POST" })
  .validator((input: unknown) => ProfilePatch.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ me: ReturnType<typeof mapMe> }> | Err> => {
    const sql = await getSql();
    const row = await loadProfile(sql, context.userId);
    if (!row) return fail("Profile missing.");
    if (row.status === "suspended") return fail("This account is suspended.");
    let username = row.username;
    if (data.username != null) {
      const next = cleanUsername(data.username);
      if (!next) return fail("That Banter ID is not valid.");
      if (next !== row.username) {
        const changed = row.username_changed_at ? new Date(String(row.username_changed_at)).getTime() : 0;
        if (row.onboarding_complete && Date.now() - changed < 14 * 24 * 3600 * 1000) {
          return fail("You can change your Banter ID once every 14 days.");
        }
        const taken = await sql<{ user_id: string }>`
          select user_id from profiles where username = ${next} and user_id <> ${context.userId}
        `;
        if (taken[0]) return fail("That Banter ID is taken.");
        username = next;
      }
    }
    const displayName = data.displayName != null ? cleanDisplayName(data.displayName) : row.display_name;
    if (!displayName) return fail("Use a name between 1 and 40 characters.");
    let birthday = row.birthday;
    if (data.birthday !== undefined) {
      if (data.birthday == null || data.birthday === "") birthday = null;
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.birthday)) return fail("Birthday should look like 1998-04-12.");
      else {
        const t = new Date(`${data.birthday}T00:00:00Z`).getTime();
        if (Number.isNaN(t) || t > Date.now() || t < Date.UTC(1900, 0, 1)) return fail("That birthday does not look right.");
        birthday = data.birthday;
      }
    }
    let avatar = row.avatar_url;
    if (data.avatarUrl !== undefined) {
      if (data.avatarUrl == null || data.avatarUrl === "") avatar = null;
      else {
        const safe = safeMediaUrl(data.avatarUrl);
        if (!safe || !safe.startsWith("data:image/")) return fail("Use a JPG, PNG, or WebP photo under 350 KB.");
        avatar = safe;
      }
    }
    let socials = row.socials;
    if (data.socials) {
      const clean: { label: string; url: string }[] = [];
      for (const s of data.socials) {
        const label = s.label.trim();
        const url = s.url.trim();
        if (!label || !url) continue;
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return fail("Social links must be full https addresses.");
        }
        if (parsed.protocol !== "https:") return fail("Social links must start with https://");
        clean.push({ label: label.slice(0, 24), url: parsed.toString().slice(0, 200) });
      }
      socials = JSON.stringify(clean);
    }
    const usernameChanged = username !== row.username ? new Date().toISOString() : iso(row.username_changed_at);
    await sql`
      update profiles set
        display_name = ${displayName},
        username = ${username},
        bio = ${data.bio != null ? data.bio.trim().slice(0, 160) : row.bio},
        about = ${data.about != null ? data.about.trim().slice(0, 600) : row.about},
        hobbies = ${data.hobbies != null ? data.hobbies.trim().slice(0, 200) : row.hobbies},
        location = ${data.location != null ? data.location.trim().slice(0, 60) : row.location},
        birthday = ${birthday},
        interests = ${data.interests ? JSON.stringify(cleanInterests(data.interests)) : row.interests},
        socials = ${socials},
        avatar_url = ${avatar},
        discoverability = ${data.discoverability ?? row.discoverability},
        last_seen_visibility = ${data.lastSeenVisibility ?? row.last_seen_visibility},
        show_online = ${data.showOnline ?? row.show_online},
        read_receipts = ${data.readReceipts ?? row.read_receipts},
        theme = ${data.theme ?? row.theme},
        notify_messages = ${data.notifyMessages ?? row.notify_messages},
        notify_friends = ${data.notifyFriends ?? row.notify_friends},
        notify_stories = ${data.notifyStories ?? row.notify_stories},
        username_changed_at = ${usernameChanged}
      where user_id = ${context.userId}
    `;
    const auth = await authUser(sql, context.userId);
    const next = await loadProfile(sql, context.userId);
    if (!next) return fail("Could not save.");
    return { ok: true, me: mapMe(next, auth.email) };
  });

export const setAccountStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ status: z.enum(["active", "deactivated"]) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const row = await loadProfile(sql, context.userId);
    if (!row) return fail("Profile missing.");
    if (row.status === "suspended") return fail("Suspended accounts cannot reactivate themselves.");
    await sql`update profiles set status = ${data.status} where user_id = ${context.userId}`;
    return { ok: true };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const id = context.userId;
    await sql`
      update messages set body = '', media_data = null, media_mime = null, media_name = null, deleted_at = now()
      where sender_id = ${id}
    `;
    await sql`delete from stories where user_id = ${id}`;
    await sql`delete from notifications where user_id = ${id}`;
    await sql`delete from friend_requests where from_user_id = ${id} or to_user_id = ${id}`;
    await sql`delete from friendships where user_a = ${id} or user_b = ${id}`;
    await sql`delete from blocks where blocker_id = ${id} or blocked_id = ${id}`;
    await sql`delete from invites where created_by = ${id}`;
    await sql`delete from conversation_members where user_id = ${id}`;
    await sql`delete from typing where user_id = ${id}`;
    await sql`delete from profiles where user_id = ${id}`;
    await sql`insert into account_tombstones (user_id) values (${id}) on conflict (user_id) do nothing`;
    await sql`delete from "session" where "userId" = ${id}`;
    return { ok: true };
  });

export const startOver = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Ok<{ me: ReturnType<typeof mapMe> }> | Err> => {
    const sql = await getSql();
    await sql`delete from account_tombstones where user_id = ${context.userId}`;
    const auth = await authUser(sql, context.userId);
    const name = cleanDisplayName(auth.name) ?? "New member";
    await sql`
      insert into profiles (user_id, display_name, avatar_url)
      values (${context.userId}, ${name}, ${safeMediaUrl(auth.image)})
      on conflict (user_id) do nothing
    `;
    const row = await loadProfile(sql, context.userId);
    if (!row) return fail("Could not start a new profile.");
    return { ok: true, me: mapMe(row, auth.email) };
  });

export const appeal = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ body: z.string().min(8).max(800) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const row = await loadProfile(sql, context.userId);
    if (!row || row.status !== "suspended") return fail("Appeals are for suspended accounts.");
    if (!(await allow(sql, context.userId, "appeal", 3, 24 * 3600 * 1000))) {
      return fail("You already sent an appeal recently.");
    }
    await sql`
      insert into appeals (id, user_id, body) values (${crypto.randomUUID()}, ${context.userId}, ${data.body.trim()})
    `;
    return { ok: true };
  });

async function relationship(sql: Sql, me: string, them: string) {
  if (await blockedByMe(sql, me, them)) return "blocked" as const;
  if (await friends(sql, me, them)) return "friends" as const;
  const pending = await sql<{ from_user_id: string; status: string }>`
    select from_user_id, status from friend_requests
    where status = 'pending'
      and ((from_user_id = ${me} and to_user_id = ${them}) or (from_user_id = ${them} and to_user_id = ${me}))
    limit 1
  `;
  if (!pending[0]) return "none" as const;
  return pending[0].from_user_id === me ? "pending-out" as const : "pending-in" as const;
}

function visibleLastSeen(row: ProfileRow, rel: string) {
  if (row.last_seen_visibility === "nobody") return null;
  if (row.last_seen_visibility === "friends" && rel !== "friends") return null;
  return iso(row.last_seen_at);
}

function mapPublic(row: ProfileRow, rel: string, meInterests: string[]) {
  const interests = parseList(row.interests);
  const online =
    row.show_online &&
    row.status === "active" &&
    !!row.last_seen_at &&
    Date.now() - new Date(String(row.last_seen_at)).getTime() < 45_000 &&
    visibleLastSeen(row, rel) != null;
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.status === "deactivated" ? "Deactivated account" : row.display_name,
    bio: row.status === "active" ? row.bio : "",
    about: rel === "friends" && row.status === "active" ? row.about : "",
    avatarUrl: row.status === "active" ? safeMediaUrl(row.avatar_url) : null,
    interests: row.status === "active" ? interests : [],
    hobbies: rel === "friends" ? row.hobbies : "",
    location: rel === "friends" ? row.location : "",
    birthday: rel === "friends" ? row.birthday : null,
    socials: rel === "friends" ? parseSocials(row.socials) : [],
    createdAt: iso(row.created_at),
    relationship: rel,
    sharedInterests: interests.filter((i) => meInterests.includes(i)),
    online,
    lastSeenAt: row.status === "active" ? visibleLastSeen(row, rel) : null,
    canMessage: rel === "friends" && row.status === "active",
  };
}

export const searchPeople = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ q: z.string().max(40) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await loadProfile(sql, context.userId);
    if (!me?.onboarding_complete) return fail("Finish your profile first.");
    const q = data.q.trim().toLowerCase().replace(/^@/, "").replace(/[\\%_]/g, "");
    if (q.length < 2) return { ok: true as const, people: [] };
    const prefix = `${q}%`;
    const rows = await sql<ProfileRow>`
      select * from profiles
      where onboarding_complete = true
        and status = 'active'
        and user_id <> ${context.userId}
        and username is not null
        and discoverability <> 'nobody'
        and username like ${prefix}
        and not exists (
          select 1 from blocks b
          where (b.blocker_id = ${context.userId} and b.blocked_id = profiles.user_id)
             or (b.blocker_id = profiles.user_id and b.blocked_id = ${context.userId})
        )
      order by (username = ${q}) desc, username asc
      limit 15
    `;
    const mine = parseList(me.interests);
    const people = [];
    for (const row of rows) {
      const rel = await relationship(sql, context.userId, row.user_id);
      if (row.discoverability === "friends" && rel !== "friends" && row.username !== q) continue;
      people.push(mapPublic(row, rel, mine));
    }
    return { ok: true as const, people };
  });

export const loadPeople = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await loadProfile(sql, context.userId);
    if (!me?.onboarding_complete) return fail("Finish your profile first.");
    const mine = parseList(me.interests);
    const reqRows = await sql<ProfileRow & { request_id: string; direction: string }>`
      select p.*, r.id as request_id,
        case when r.from_user_id = ${context.userId} then 'out' else 'in' end as direction
      from friend_requests r
      join profiles p on p.user_id = case when r.from_user_id = ${context.userId} then r.to_user_id else r.from_user_id end
      where r.status = 'pending' and (r.from_user_id = ${context.userId} or r.to_user_id = ${context.userId})
      order by r.created_at desc
    `;
    const friendRows = await sql<ProfileRow>`
      select p.* from friendships f
      join profiles p on p.user_id = case when f.user_a = ${context.userId} then f.user_b else f.user_a end
      where f.user_a = ${context.userId} or f.user_b = ${context.userId}
      order by p.display_name asc
    `;
    const suggestions = await sql<ProfileRow>`
      select * from profiles
      where onboarding_complete = true and status = 'active' and discoverability = 'everyone'
        and user_id <> ${context.userId}
        and not exists (
          select 1 from blocks b
          where (b.blocker_id = ${context.userId} and b.blocked_id = profiles.user_id)
             or (b.blocker_id = profiles.user_id and b.blocked_id = ${context.userId})
        )
        and not exists (
          select 1 from friendships f
          where (f.user_a = ${context.userId} and f.user_b = profiles.user_id)
             or (f.user_b = ${context.userId} and f.user_a = profiles.user_id)
        )
      order by created_at desc
      limit 40
    `;
    const ranked = suggestions
      .map((row) => ({ row, score: parseList(row.interests).filter((i) => mine.includes(i)).length }))
      .filter((x) => (mine.length ? x.score > 0 : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    return {
      ok: true as const,
      requests: reqRows.map((row) => ({
        id: row.request_id,
        direction: row.direction === "out" ? "out" as const : "in" as const,
        person: mapPublic(row, row.direction === "out" ? "pending-out" : "pending-in", mine),
      })),
      friends: friendRows.map((row) => mapPublic(row, "friends", mine)),
      suggestions: ranked.map((x) => mapPublic(x.row, "none", mine)),
    };
  });

export const getProfile = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ userId: z.string().optional(), username: z.string().optional() }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await loadProfile(sql, context.userId);
    if (!me) return fail("Profile missing.");
    let row: ProfileRow | null = null;
    if (data.userId) row = await loadProfile(sql, data.userId);
    else if (data.username) {
      const username = cleanUsername(data.username);
      if (!username) return fail("That Banter ID is not valid.");
      const rows = await sql<ProfileRow>`select * from profiles where username = ${username}`;
      row = rows[0] ?? null;
    }
    if (!row || !row.onboarding_complete) return fail("No one uses that Banter ID.");
    if (row.user_id === context.userId) {
      const auth = await authUser(sql, context.userId);
      return { ok: true as const, self: true as const, me: mapMe(row, auth.email) };
    }
    if (row.discoverability === "nobody" && !(await friends(sql, context.userId, row.user_id))) {
      return fail("This profile is not available.");
    }
    if (await blocked(sql, context.userId, row.user_id)) {
      const byMe = await blockedByMe(sql, context.userId, row.user_id);
      return {
        ok: true as const,
        self: false as const,
        person: {
          ...mapPublic(row, "blocked", []),
          displayName: byMe ? row.display_name : "Unavailable",
          bio: "",
          about: "",
          avatarUrl: null,
          interests: [],
          blockedByMe: byMe,
          canMessage: false,
        },
      };
    }
    const rel = await relationship(sql, context.userId, row.user_id);
    return {
      ok: true as const,
      self: false as const,
      person: { ...mapPublic(row, rel, parseList(me.interests)), blockedByMe: false },
    };
  });

export const friendAction = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      userId: z.string(),
      action: z.enum(["request", "accept", "reject", "cancel", "remove", "block", "unblock"]),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data}): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error || !gate.row) return fail(gate.error ?? "Unavailable.");
    const them = await loadProfile(sql, data.userId);
    if (!them || them.user_id === context.userId) return fail("That person is not available.");
    const me = gate.row;
    if (data.action === "unblock") {
      await sql`delete from blocks where blocker_id = ${me.user_id} and blocked_id = ${them.user_id}`;
      return { ok: true };
    }
    if (data.action === "block") {
      if (!(await allow(sql, me.user_id, "block", 30, 3600_000))) return fail("Slow down a moment.");
      await sql`
        insert into blocks (blocker_id, blocked_id) values (${me.user_id}, ${them.user_id})
        on conflict do nothing
      `;
      const [a, b] = pair(me.user_id, them.user_id);
      await sql`delete from friendships where user_a = ${a} and user_b = ${b}`;
      await sql`
        update friend_requests set status = 'cancelled', updated_at = now()
        where status = 'pending'
          and ((from_user_id = ${me.user_id} and to_user_id = ${them.user_id})
            or (from_user_id = ${them.user_id} and to_user_id = ${me.user_id}))
      `;
      return { ok: true };
    }
    if (await blocked(sql, me.user_id, them.user_id)) return fail("You can't reach this person.");
    if (data.action === "request") {
      if (them.status !== "active") return fail("That account is not accepting requests.");
      if (await friends(sql, me.user_id, them.user_id)) return fail("You're already friends.");
      if (!(await allow(sql, me.user_id, "friend", 20, 3600_000))) return fail("Too many requests. Try again later.");
      const existing = await sql<{ id: string; from_user_id: string; status: string }>`
        select id, from_user_id, status from friend_requests
        where (from_user_id = ${me.user_id} and to_user_id = ${them.user_id})
           or (from_user_id = ${them.user_id} and to_user_id = ${me.user_id})
        order by created_at desc limit 1
      `;
      if (existing[0]?.status === "pending" && existing[0].from_user_id === them.user_id) {
        return friendAccept(sql, me, them, existing[0].id);
      }
      if (existing[0]?.status === "pending") return fail("Request already sent.");
      const id = crypto.randomUUID();
      if (existing[0]) {
        await sql`
          update friend_requests set status = 'pending', from_user_id = ${me.user_id}, to_user_id = ${them.user_id}, updated_at = now()
          where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into friend_requests (id, from_user_id, to_user_id) values (${id}, ${me.user_id}, ${them.user_id})
        `;
      }
      if (them.notify_friends) {
        await notify(sql, them.user_id, "friend", "New friend request", `${me.display_name} wants to talk`, `user:${me.user_id}`);
      }
      return { ok: true };
    }
    if (data.action === "cancel") {
      await sql`
        update friend_requests set status = 'cancelled', updated_at = now()
        where from_user_id = ${me.user_id} and to_user_id = ${them.user_id} and status = 'pending'
      `;
      return { ok: true };
    }
    if (data.action === "reject") {
      await sql`
        update friend_requests set status = 'rejected', updated_at = now()
        where from_user_id = ${them.user_id} and to_user_id = ${me.user_id} and status = 'pending'
      `;
      return { ok: true };
    }
    if (data.action === "accept") {
      const pending = await sql<{ id: string }>`
        select id from friend_requests
        where from_user_id = ${them.user_id} and to_user_id = ${me.user_id} and status = 'pending'
      `;
      if (!pending[0]) return fail("That request is no longer open.");
      return friendAccept(sql, me, them, pending[0].id);
    }
    const [a, b] = pair(me.user_id, them.user_id);
    await sql`delete from friendships where user_a = ${a} and user_b = ${b}`;
    return { ok: true };
  });

async function friendAccept(sql: Sql, me: ProfileRow, them: ProfileRow, requestId: string): Promise<{ ok: true }> {
  await sql`update friend_requests set status = 'accepted', updated_at = now() where id = ${requestId}`;
  const [a, b] = pair(me.user_id, them.user_id);
  await sql`
    insert into friendships (user_a, user_b) values (${a}, ${b})
    on conflict do nothing
  `;
  if (them.notify_friends) {
    await notify(sql, them.user_id, "friend", "You're friends", `${me.display_name} accepted your request`, `user:${me.user_id}`);
  }
  return { ok: true };
}

export const reportPerson = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      userId: z.string().optional(),
      conversationId: z.string().optional(),
      reason: z.string().min(3).max(80),
      details: z.string().max(500).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error) return fail(gate.error);
    if (!(await allow(sql, context.userId, "report", 10, 24 * 3600_000))) {
      return fail("You've sent several reports. Try again tomorrow.");
    }
    await sql`
      insert into reports (id, reporter_id, target_user_id, target_conversation_id, reason, details)
      values (
        ${crypto.randomUUID()}, ${context.userId}, ${data.userId ?? null},
        ${data.conversationId ?? null}, ${data.reason.trim()}, ${(data.details ?? "").trim()}
      )
    `;
    return { ok: true };
  });

export const createInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ conversationId: z.string().optional() }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ code: string; expiresAt: string }> | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error) return fail(gate.error);
    if (data.conversationId) {
      const role = await memberRole(sql, data.conversationId, context.userId);
      if (role !== "admin") return fail("Only group admins can create invite links.");
    }
    if (!(await allow(sql, context.userId, "invite", 20, 3600_000))) return fail("Too many invite links.");
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    let code = "";
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    for (const b of bytes) code += alphabet[b % alphabet.length];
    const expires = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    await sql`
      insert into invites (code, created_by, conversation_id, expires_at)
      values (${code}, ${context.userId}, ${data.conversationId ?? null}, ${expires})
    `;
    return { ok: true, code, expiresAt: expires };
  });

export const redeemInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ code: z.string().max(20) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ kind: string; conversationId: string | null }> | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error || !gate.row) return fail(gate.error ?? "Unavailable.");
    const code = data.code.trim().toLowerCase();
    const rows = await sql<{
      code: string;
      created_by: string;
      conversation_id: string | null;
      expires_at: unknown;
      revoked_at: unknown;
      max_uses: number;
      uses: number;
    }>`select * from invites where code = ${code}`;
    const invite = rows[0];
    if (!invite || invite.revoked_at) return fail("This invite is no longer valid.");
    if (new Date(String(invite.expires_at)).getTime() < Date.now()) return fail("This invite has expired.");
    if (num(invite.uses) >= num(invite.max_uses)) return fail("This invite has been used up.");
    if (invite.created_by === context.userId) return fail("That's your own invite.");
    if (await blocked(sql, context.userId, invite.created_by)) return fail("You can't use this invite.");
    if (invite.conversation_id) {
      const role = await memberRole(sql, invite.conversation_id, context.userId);
      if (!role) {
        const members = await sql<{ n: number }>`
          select count(*) as n from conversation_members
          where conversation_id = ${invite.conversation_id} and left_at is null
        `;
        if (num(members[0]?.n) >= 50) return fail("That group is full.");
        await sql`
          insert into conversation_members (conversation_id, user_id, role)
          values (${invite.conversation_id}, ${context.userId}, 'member')
          on conflict (conversation_id, user_id) do update set left_at = null, joined_at = now()
        `;
        await sql`
          insert into messages (id, conversation_id, sender_id, body, kind)
          values (${crypto.randomUUID()}, ${invite.conversation_id}, ${context.userId}, ${"joined the group"}, 'system')
        `;
      }
    } else if (!(await friends(sql, context.userId, invite.created_by))) {
      const [a, b] = pair(context.userId, invite.created_by);
      await sql`insert into friendships (user_a, user_b) values (${a}, ${b}) on conflict do nothing`;
      const inviter = await loadProfile(sql, invite.created_by);
      if (inviter?.notify_friends) {
        await notify(
          sql,
          invite.created_by,
          "friend",
          "Invite accepted",
          `${gate.row.display_name} joined Banter from your link`,
          `user:${context.userId}`,
        );
      }
    }
    await sql`update invites set uses = uses + 1 where code = ${code}`;
    return { ok: true, kind: invite.conversation_id ? "group" : "friend", conversationId: invite.conversation_id };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ code: z.string() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    await sql`
      update invites set revoked_at = now()
      where code = ${data.code} and created_by = ${context.userId} and revoked_at is null
    `;
    return { ok: true };
  });

export const openDirect = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ conversationId: string }> | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error) return fail(gate.error);
    if (!(await friends(sql, context.userId, data.userId))) return fail("Add each other as friends before messaging.");
    if (await blocked(sql, context.userId, data.userId)) return fail("You can't message this person.");
    const [a, b] = pair(context.userId, data.userId);
    const existing = await sql<{ conversation_id: string }>`
      select conversation_id from direct_pairs where user_a = ${a} and user_b = ${b}
    `;
    if (existing[0]) {
      await sql`
        update conversation_members set left_at = null
        where conversation_id = ${existing[0].conversation_id} and user_id = ${context.userId}
      `;
      return { ok: true, conversationId: existing[0].conversation_id };
    }
    const id = crypto.randomUUID();
    await sql`
      insert into conversations (id, kind, created_by) values (${id}, 'direct', ${context.userId})
    `;
    await sql`
      insert into conversation_members (conversation_id, user_id, role) values
        (${id}, ${a}, 'member'), (${id}, ${b}, 'member')
    `;
    await sql`insert into direct_pairs (user_a, user_b, conversation_id) values (${a}, ${b}, ${id})`;
    return { ok: true, conversationId: id };
  });

export const createGroup = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      title: z.string().min(1).max(48),
      description: z.string().max(240).optional(),
      memberIds: z.array(z.string()).max(49),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ conversationId: string }> | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error || !gate.row) return fail(gate.error ?? "Unavailable.");
    const title = data.title.trim();
    if (!title) return fail("Give the group a name.");
    const ids = [...new Set(data.memberIds.filter((id) => id !== context.userId))];
    for (const id of ids) {
      if (!(await friends(sql, context.userId, id)) || (await blocked(sql, context.userId, id))) {
        return fail("You can only add friends.");
      }
    }
    const conversationId = crypto.randomUUID();
    await sql`
      insert into conversations (id, kind, title, description, created_by)
      values (${conversationId}, 'group', ${title}, ${(data.description ?? "").trim()}, ${context.userId})
    `;
    await sql`
      insert into conversation_members (conversation_id, user_id, role)
      values (${conversationId}, ${context.userId}, 'admin')
    `;
    for (const id of ids) {
      await sql`
        insert into conversation_members (conversation_id, user_id, role)
        values (${conversationId}, ${id}, 'member')
      `;
      const person = await loadProfile(sql, id);
      if (person?.notify_messages) {
        await notify(sql, id, "group", "Added to a group", `${gate.row.display_name} added you to ${title}`, `thread:${conversationId}`);
      }
    }
    await sql`
      insert into messages (id, conversation_id, sender_id, body, kind)
      values (${crypto.randomUUID()}, ${conversationId}, ${context.userId}, ${`${gate.row.display_name} created the group`}, 'system')
    `;
    return { ok: true, conversationId };
  });

export const groupAction = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      conversationId: z.string(),
      action: z.enum(["rename", "describe", "add", "remove", "leave", "promote", "disappearing", "wallpaper", "mute", "archive"]),
      title: z.string().max(48).optional(),
      description: z.string().max(240).optional(),
      userId: z.string().optional(),
      seconds: z.number().nullable().optional(),
      wallpaper: z.enum(["ink", "paper", "clay", "sage", "dusk"]).optional(),
      muted: z.boolean().optional(),
      archived: z.boolean().optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error || !gate.row) return fail(gate.error ?? "Unavailable.");
    const role = await memberRole(sql, data.conversationId, context.userId);
    if (!role) return fail("You don't have access to that conversation.");
    const conv = await sql<{ kind: string }>`select kind from conversations where id = ${data.conversationId}`;
    if (!conv[0]) return fail("Conversation missing.");
    const admin = role === "admin";
    if (data.action === "wallpaper" && data.wallpaper) {
      await sql`
        update conversation_members set wallpaper = ${data.wallpaper}
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
      return { ok: true };
    }
    if (data.action === "mute") {
      await sql`
        update conversation_members set muted = ${!!data.muted}
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
      return { ok: true };
    }
    if (data.action === "archive") {
      await sql`
        update conversation_members set archived = ${!!data.archived}
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
      return { ok: true };
    }
    if (data.action === "leave") {
      await leaveConversation(sql, data.conversationId, context.userId, gate.row.display_name);
      return { ok: true };
    }
    if (conv[0].kind === "group" && !admin) {
      return fail("Only admins can change the group.");
    }
    if (data.action === "rename" && data.title?.trim()) {
      await sql`update conversations set title = ${data.title.trim()}, updated_at = now() where id = ${data.conversationId}`;
      return { ok: true };
    }
    if (data.action === "describe") {
      await sql`
        update conversations set description = ${(data.description ?? "").trim()}, updated_at = now()
        where id = ${data.conversationId}
      `;
      return { ok: true };
    }
    if (data.action === "disappearing") {
      const allowed = new Set([null, 3600, 86400, 604800]);
      const seconds = data.seconds ?? null;
      if (!allowed.has(seconds)) return fail("Pick an expiry Banter supports.");
      if (conv[0].kind === "direct" || admin) {
        await sql`update conversations set disappearing_seconds = ${seconds}, updated_at = now() where id = ${data.conversationId}`;
        return { ok: true };
      }
      return fail("Only admins can change disappearing messages.");
    }
    if (!data.userId) return fail("Choose a person.");
    if (data.action === "add") {
      if (!(await friends(sql, context.userId, data.userId))) return fail("You can only add friends.");
      if (await blocked(sql, context.userId, data.userId)) return fail("You can't add this person.");
      const count = await sql<{ n: number }>`
        select count(*) as n from conversation_members where conversation_id = ${data.conversationId} and left_at is null
      `;
      if (num(count[0]?.n) >= 50) return fail("Groups can hold 50 people.");
      await sql`
        insert into conversation_members (conversation_id, user_id, role)
        values (${data.conversationId}, ${data.userId}, 'member')
        on conflict (conversation_id, user_id) do update set left_at = null, role = 'member', joined_at = now()
      `;
      const person = await loadProfile(sql, data.userId);
      await sql`
        insert into messages (id, conversation_id, sender_id, body, kind)
        values (${crypto.randomUUID()}, ${data.conversationId}, ${context.userId}, ${`${person?.display_name ?? "Someone"} was added`}, 'system')
      `;
      return { ok: true };
    }
    if (data.action === "promote") {
      await sql`
        update conversation_members set role = 'admin'
        where conversation_id = ${data.conversationId} and user_id = ${data.userId} and left_at is null
      `;
      return { ok: true };
    }
    if (data.userId === context.userId) return fail("Use leave for yourself.");
    await leaveConversation(sql, data.conversationId, data.userId, "A member");
    return { ok: true };
  });

async function leaveConversation(sql: Sql, conversationId: string, userId: string, name: string) {
  await sql`
    update conversation_members set left_at = now()
    where conversation_id = ${conversationId} and user_id = ${userId}
  `;
  const admins = await sql<{ n: number }>`
    select count(*) as n from conversation_members
    where conversation_id = ${conversationId} and left_at is null and role = 'admin'
  `;
  if (num(admins[0]?.n) === 0) {
    const next = await sql<{ user_id: string }>`
      select user_id from conversation_members
      where conversation_id = ${conversationId} and left_at is null
      order by joined_at asc limit 1
    `;
    if (next[0]) {
      await sql`
        update conversation_members set role = 'admin'
        where conversation_id = ${conversationId} and user_id = ${next[0].user_id}
      `;
    }
  }
  await sql`
    insert into messages (id, conversation_id, sender_id, body, kind)
    values (${crypto.randomUUID()}, ${conversationId}, ${userId}, ${`${name} left`}, 'system')
  `;
}

const Send = z.object({
  conversationId: z.string(),
  body: z.string().max(4000).optional(),
  kind: z.enum(["text", "image", "audio", "file", "announce"]).optional(),
  mediaData: z.string().max(1_200_000).nullable().optional(),
  mediaMime: z.string().max(80).nullable().optional(),
  mediaName: z.string().max(120).nullable().optional(),
  replyToId: z.string().nullable().optional(),
});

export const sendMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => Send.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ id: string }> | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error || !gate.row) return fail(gate.error ?? "Unavailable.");
    const role = await memberRole(sql, data.conversationId, context.userId);
    if (!role) return fail("You don't have access to that conversation.");
    if (!(await allow(sql, context.userId, "message", 40, 60_000))) return fail("You're sending messages very quickly.");
    const conv = await sql<{ kind: string; disappearing_seconds: number | null }>`
      select kind, disappearing_seconds from conversations where id = ${data.conversationId}
    `;
    if (!conv[0]) return fail("Conversation missing.");
    if (conv[0].kind === "direct") {
      const others = await sql<{ user_id: string }>`
        select user_id from conversation_members
        where conversation_id = ${data.conversationId} and user_id <> ${context.userId} and left_at is null
      `;
      const other = others[0]?.user_id;
      if (!other || !(await friends(sql, context.userId, other)) || (await blocked(sql, context.userId, other))) {
        return fail("You can't message this person.");
      }
    }
    let kind = data.kind ?? "text";
    if (kind === "announce") {
      if (role !== "admin" || conv[0].kind !== "group") return fail("Only group admins can post an announcement.");
    }
    let media: string | null = null;
    let mime: string | null = null;
    let name: string | null = data.mediaName?.trim().slice(0, 120) || null;
    if (kind === "image" || kind === "audio" || kind === "file") {
      if (!data.mediaData || !data.mediaMime) return fail("That attachment is empty.");
      const bare = bareBase64(data.mediaData);
      if (!bare) return fail("That file could not be read.");
      const bytes = Math.floor(bare.length * 0.75);
      const allowed = kind === "image" ? IMAGE : kind === "audio" ? AUDIO : FILE;
      const cap = kind === "image" ? 380_000 : kind === "audio" ? 700_000 : 280_000;
      if (!allowed.has(data.mediaMime)) return fail("That file type is not supported.");
      if (bytes > cap) return fail("That file is too large for Banter. Try a smaller one.");
      const day = new Date(Date.now() - 24 * 3600_000).toISOString();
      const used = await sql<{ n: number }>`
        select count(*) as n from messages
        where sender_id = ${context.userId} and kind in ('image','audio','file') and created_at > ${day}
      `;
      if (num(used[0]?.n) >= 30) return fail("Daily media limit reached.");
      media = bare;
      mime = data.mediaMime;
    } else {
      kind = kind === "announce" ? "announce" : "text";
    }
    const body = (data.body ?? "").trim().slice(0, 4000);
    if ((kind === "text" || kind === "announce") && !body) return fail("Write a message first.");
    let reply: string | null = null;
    if (data.replyToId) {
      const parent = await sql<{ id: string }>`
        select id from messages where id = ${data.replyToId} and conversation_id = ${data.conversationId}
      `;
      if (parent[0]) reply = parent[0].id;
    }
    const expires = conv[0].disappearing_seconds
      ? new Date(Date.now() + conv[0].disappearing_seconds * 1000).toISOString()
      : null;
    const id = crypto.randomUUID();
    await sql`
      insert into messages (
        id, conversation_id, sender_id, body, kind, media_data, media_mime, media_name, reply_to_id, expires_at
      ) values (
        ${id}, ${data.conversationId}, ${context.userId}, ${body}, ${kind}, ${media}, ${mime}, ${name}, ${reply}, ${expires}
      )
    `;
    await sql`update conversations set updated_at = now() where id = ${data.conversationId}`;
    await sql`delete from typing where conversation_id = ${data.conversationId} and user_id = ${context.userId}`;
    const members = await sql<{ user_id: string; muted: boolean; notify_messages: boolean }>`
      select cm.user_id, cm.muted, p.notify_messages
      from conversation_members cm
      join profiles p on p.user_id = cm.user_id
      where cm.conversation_id = ${data.conversationId} and cm.left_at is null and cm.user_id <> ${context.userId}
    `;
    const preview = kind === "image" ? "Sent a photo" : kind === "audio" ? "Sent a voice note" : kind === "file" ? "Sent a file" : snippet(body, 90);
    for (const m of members) {
      if (!m.muted && m.notify_messages) {
        await notify(sql, m.user_id, "message", gate.row.display_name, preview, `thread:${data.conversationId}`);
      }
    }
    if (kind === "text" || kind === "announce") {
      const names = [...new Set((body.match(/@([a-z][a-z0-9_]{2,19})/g) ?? []).map((s) => s.slice(1)))];
      for (const username of names) {
        const hit = await sql<{ user_id: string; notify_messages: boolean }>`
          select p.user_id, p.notify_messages from profiles p
          join conversation_members cm on cm.user_id = p.user_id
          where p.username = ${username} and cm.conversation_id = ${data.conversationId} and cm.left_at is null
            and p.user_id <> ${context.userId}
        `;
        if (hit[0]?.notify_messages) {
          await notify(sql, hit[0].user_id, "mention", `${gate.row.display_name} mentioned you`, snippet(body, 90), `thread:${data.conversationId}`);
        }
      }
    }
    return { ok: true, id };
  });

export const messageAction = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      messageId: z.string(),
      action: z.enum(["edit", "delete", "hide", "react", "star", "pin", "forward"]),
      body: z.string().max(4000).optional(),
      emoji: z.string().max(8).optional(),
      conversationId: z.string().optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ id?: string }> | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error) return fail(gate.error);
    const rows = await sql<{
      id: string;
      conversation_id: string;
      sender_id: string;
      kind: string;
      deleted_at: unknown;
      body: string;
      pinned: boolean;
    }>`select id, conversation_id, sender_id, kind, deleted_at, body, pinned from messages where id = ${data.messageId}`;
    const msg = rows[0];
    if (!msg) return fail("Message not found.");
    const role = await memberRole(sql, msg.conversation_id, context.userId);
    if (!role) return fail("You don't have access to that conversation.");
    if (data.action === "hide") {
      await sql`
        insert into message_hides (message_id, user_id) values (${msg.id}, ${context.userId})
        on conflict do nothing
      `;
      return { ok: true };
    }
    if (data.action === "star") {
      const existing = await sql<{ x: number }>`
        select 1 as x from message_stars where message_id = ${msg.id} and user_id = ${context.userId}
      `;
      if (existing[0]) await sql`delete from message_stars where message_id = ${msg.id} and user_id = ${context.userId}`;
      else await sql`insert into message_stars (message_id, user_id) values (${msg.id}, ${context.userId})`;
      return { ok: true };
    }
    if (data.action === "react") {
      const emoji = (data.emoji ?? "").trim();
      if (!["♥", "☺", "!", "…", "✦", "↑"].includes(emoji)) return fail("That reaction is not available.");
      const existing = await sql<{ x: number }>`
        select 1 as x from message_reactions
        where message_id = ${msg.id} and user_id = ${context.userId} and emoji = ${emoji}
      `;
      if (existing[0]) {
        await sql`delete from message_reactions where message_id = ${msg.id} and user_id = ${context.userId} and emoji = ${emoji}`;
      } else {
        await sql`insert into message_reactions (message_id, user_id, emoji) values (${msg.id}, ${context.userId}, ${emoji})`;
      }
      return { ok: true };
    }
    if (data.action === "pin") {
      const conv = await sql<{ kind: string }>`select kind from conversations where id = ${msg.conversation_id}`;
      if (conv[0]?.kind === "group" && role !== "admin") return fail("Only admins can pin in a group.");
      if (msg.pinned) {
        await sql`update messages set pinned = false where id = ${msg.id}`;
        return { ok: true };
      }
      const pins = await sql<{ n: number }>`
        select count(*) as n from messages where conversation_id = ${msg.conversation_id} and pinned = true and deleted_at is null
      `;
      if (num(pins[0]?.n) >= 3) return fail("Unpin something first. Three pins is the limit.");
      await sql`update messages set pinned = true where id = ${msg.id}`;
      return { ok: true };
    }
    if (data.action === "edit") {
      if (msg.sender_id !== context.userId || msg.kind !== "text" && msg.kind !== "announce") {
        return fail("You can edit your own text.");
      }
      const body = (data.body ?? "").trim();
      if (!body) return fail("Message can't be empty.");
      await sql`update messages set body = ${body.slice(0, 4000)}, edited_at = now() where id = ${msg.id}`;
      return { ok: true };
    }
    if (data.action === "delete") {
      if (msg.sender_id !== context.userId) return fail("You can delete your own messages.");
      await sql`
        update messages set body = '', media_data = null, media_mime = null, media_name = null, deleted_at = now(), pinned = false
        where id = ${msg.id}
      `;
      return { ok: true };
    }
    if (!data.conversationId) return fail("Choose a conversation to forward to.");
    const destRole = await memberRole(sql, data.conversationId, context.userId);
    if (!destRole) return fail("You can't forward there.");
    if (msg.deleted_at) return fail("That message was removed.");
    const full = await sql<{ media_data: string | null; media_mime: string | null; media_name: string | null; kind: string; body: string }>`
      select media_data, media_mime, media_name, kind, body from messages where id = ${msg.id}
    `;
    const src = full[0];
    const id = crypto.randomUUID();
    await sql`
      insert into messages (id, conversation_id, sender_id, body, kind, media_data, media_mime, media_name, forwarded)
      values (
        ${id}, ${data.conversationId}, ${context.userId}, ${src?.body ?? ""}, ${src?.kind === "system" ? "text" : src?.kind ?? "text"},
        ${src?.media_data ?? null}, ${src?.media_mime ?? null}, ${src?.media_name ?? null}, true
      )
    `;
    await sql`update conversations set updated_at = now() where id = ${data.conversationId}`;
    return { ok: true, id };
  });

export const pulseTyping = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ conversationId: z.string(), typing: z.boolean() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const role = await memberRole(sql, data.conversationId, context.userId);
    if (!role) return fail("Not a member.");
    if (!data.typing) {
      await sql`delete from typing where conversation_id = ${data.conversationId} and user_id = ${context.userId}`;
    } else {
      await sql`
        insert into typing (conversation_id, user_id, updated_at) values (${data.conversationId}, ${context.userId}, now())
        on conflict (conversation_id, user_id) do update set updated_at = now()
      `;
    }
    return { ok: true };
  });

export const getAttachment = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ messageId: z.string() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{
      conversation_id: string;
      media_data: string | null;
      media_mime: string | null;
      media_name: string | null;
      deleted_at: unknown;
    }>`
      select conversation_id, media_data, media_mime, media_name, deleted_at from messages where id = ${data.messageId}
    `;
    const msg = rows[0];
    if (!msg || msg.deleted_at || !msg.media_data || !msg.media_mime) return fail("Attachment unavailable.");
    if (!(await memberRole(sql, msg.conversation_id, context.userId))) return fail("You don't have access.");
    return { ok: true as const, mime: msg.media_mime, data: msg.media_data, name: msg.media_name };
  });

export const searchMessages = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ q: z.string().max(80), conversationId: z.string().optional() }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const q = data.q.trim().replace(/[\\%_]/g, "");
    if (q.length < 2) return { ok: true as const, hits: [] };
    const like = `%${q}%`;
    const rows = await sql<{
      id: string;
      conversation_id: string;
      body: string;
      created_at: unknown;
      title: string | null;
      kind: string;
    }>`
      select m.id, m.conversation_id, m.body, m.created_at, c.title, c.kind
      from messages m
      join conversations c on c.id = m.conversation_id
      join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${context.userId} and cm.left_at is null
      where m.deleted_at is null
        and (m.expires_at is null or m.expires_at > now())
        and m.body ilike ${like}
        and (${data.conversationId ?? null}::text is null or m.conversation_id = ${data.conversationId ?? null})
        and not exists (select 1 from message_hides h where h.message_id = m.id and h.user_id = ${context.userId})
      order by m.created_at desc
      limit 30
    `;
    return {
      ok: true as const,
      hits: rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        body: snippet(r.body, 120),
        createdAt: iso(r.created_at),
        title: r.title,
        kind: r.kind,
      })),
    };
  });

type Msg = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  kind: string;
  media_mime: string | null;
  media_name: string | null;
  reply_to_id: string | null;
  forwarded: boolean;
  edited_at: unknown;
  deleted_at: unknown;
  pinned: boolean;
  created_at: unknown;
  has_media: boolean;
  sender_name: string;
  sender_username: string | null;
  reply_body: string | null;
  reply_kind: string | null;
  reply_deleted: unknown;
  reply_name: string | null;
};

function mapMsg(row: Msg, reactions: { emoji: string; userId: string }[], starred: boolean) {
  const deleted = !!row.deleted_at;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderUsername: row.sender_username,
    body: deleted ? "" : row.body,
    kind: row.kind,
    mime: deleted ? null : row.media_mime,
    fileName: deleted ? null : row.media_name,
    hasMedia: !deleted && !!row.has_media,
    replyToId: row.reply_to_id,
    replyBody: row.reply_deleted ? "" : row.reply_body,
    replyKind: row.reply_kind,
    replyName: row.reply_name,
    forwarded: row.forwarded,
    editedAt: iso(row.edited_at),
    deleted,
    pinned: row.pinned && !deleted,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    reactions,
    starred,
  };
}

async function threadPayload(sql: Sql, conversationId: string, userId: string) {
  await sql`
    update conversation_members set last_read_at = now()
    where conversation_id = ${conversationId} and user_id = ${userId} and left_at is null
  `;
  const messages = await sql<Msg>`
    select m.id, m.conversation_id, m.sender_id, m.body, m.kind, m.media_mime, m.media_name,
      m.reply_to_id, m.forwarded, m.edited_at, m.deleted_at, m.pinned, m.created_at,
      (m.media_data is not null) as has_media,
      coalesce(p.display_name, 'Former member') as sender_name,
      p.username as sender_username,
      r.body as reply_body, r.kind as reply_kind, r.deleted_at as reply_deleted,
      rp.display_name as reply_name
    from messages m
    left join profiles p on p.user_id = m.sender_id
    left join messages r on r.id = m.reply_to_id
    left join profiles rp on rp.user_id = r.sender_id
    where m.conversation_id = ${conversationId}
      and (m.expires_at is null or m.expires_at > now())
      and not exists (
        select 1 from message_hides h where h.message_id = m.id and h.user_id = ${userId}
      )
    order by m.created_at desc
    limit 80
  `;
  messages.reverse();
  const reactionRows = await sql<{ message_id: string; user_id: string; emoji: string }>`
    select mr.message_id, mr.user_id, mr.emoji
    from message_reactions mr
    join messages m on m.id = mr.message_id
    where m.conversation_id = ${conversationId}
  `;
  const starRows = await sql<{ message_id: string }>`
    select s.message_id from message_stars s
    join messages m on m.id = s.message_id
    where s.user_id = ${userId} and m.conversation_id = ${conversationId}
  `;
  const stars = new Set(starRows.map((s) => s.message_id));
  const byMsg = new Map<string, { emoji: string; userId: string }[]>();
  for (const r of reactionRows) {
    const list = byMsg.get(r.message_id) ?? [];
    list.push({ emoji: r.emoji, userId: r.user_id });
    byMsg.set(r.message_id, list);
  }
  const members = await sql<{
    user_id: string;
    role: string;
    display_name: string;
    username: string | null;
    last_read_at: unknown;
    read_receipts: boolean;
    last_seen_at: unknown;
    show_online: boolean;
    last_seen_visibility: string;
    status: string;
  }>`
    select cm.user_id, cm.role, coalesce(p.display_name, 'Former member') as display_name,
      p.username, cm.last_read_at, coalesce(p.read_receipts, false) as read_receipts,
      p.last_seen_at, coalesce(p.show_online, false) as show_online,
      coalesce(p.last_seen_visibility, 'nobody') as last_seen_visibility,
      coalesce(p.status, 'active') as status
    from conversation_members cm
    left join profiles p on p.user_id = cm.user_id
    where cm.conversation_id = ${conversationId} and cm.left_at is null
  `;
  const typing = await sql<{ user_id: string; display_name: string }>`
    select t.user_id, coalesce(p.display_name, 'Someone') as display_name
    from typing t
    left join profiles p on p.user_id = t.user_id
    where t.conversation_id = ${conversationId}
      and t.user_id <> ${userId}
      and t.updated_at > now() - interval '4 seconds'
  `;
  const conv = await sql<{
    id: string;
    kind: string;
    title: string | null;
    description: string;
    disappearing_seconds: number | null;
    created_by: string;
  }>`select id, kind, title, description, disappearing_seconds, created_by from conversations where id = ${conversationId}`;
  const mine = await sql<{ wallpaper: string; muted: boolean; archived: boolean; role: string }>`
    select wallpaper, muted, archived, role from conversation_members
    where conversation_id = ${conversationId} and user_id = ${userId}
  `;
  return {
    conversation: conv[0]
      ? {
          id: conv[0].id,
          kind: conv[0].kind,
          title: conv[0].title,
          description: conv[0].description,
          disappearingSeconds: conv[0].disappearing_seconds,
          createdBy: conv[0].created_by,
          wallpaper: mine[0]?.wallpaper ?? "ink",
          muted: !!mine[0]?.muted,
          archived: !!mine[0]?.archived,
          myRole: mine[0]?.role ?? "member",
        }
      : null,
    members: members.map((m) => ({
      userId: m.user_id,
      role: m.role,
      displayName: m.display_name,
      username: m.username,
      lastReadAt: m.read_receipts || m.user_id === userId ? iso(m.last_read_at) : null,
      online:
        m.show_online &&
        m.status === "active" &&
        !!m.last_seen_at &&
        Date.now() - new Date(String(m.last_seen_at)).getTime() < 45_000,
    })),
    typing: typing.map((t) => ({ userId: t.user_id, displayName: t.display_name })),
    messages: messages.map((m) => mapMsg(m, byMsg.get(m.id) ?? [], stars.has(m.id))),
  };
}

export const sync = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ conversationId: z.string().optional() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const tomb = await sql<{ user_id: string }>`
      select user_id from account_tombstones where user_id = ${context.userId}
    `;
    if (tomb[0]) return { ok: true as const, tombstone: true as const };
    const auth = await authUser(sql, context.userId);
    const meRow = await loadProfile(sql, context.userId);
    if (!meRow) return fail("Profile missing.");
    if (meRow.status === "active") {
      await sql`update profiles set last_seen_at = now() where user_id = ${context.userId}`;
    }
    await sql`delete from messages where expires_at is not null and expires_at < now()`;
    const stale = new Date(Date.now() - 45_000).toISOString();
    const missed = await sql<{ id: string; callee_id: string; caller_id: string }>`
      select id, callee_id, caller_id from calls
      where status = 'ringing' and created_at < ${stale}
    `;
    for (const call of missed) {
      await sql`update calls set status = 'missed', ended_at = now() where id = ${call.id} and status = 'ringing'`;
      await notify(sql, call.callee_id, "call", "Missed call", "You missed a call", `calls`);
    }
    const chats = await loadChats(sql, context.userId);
    const notices = await sql<{
      id: string;
      kind: string;
      title: string;
      body: string;
      href: string;
      read_at: unknown;
      created_at: unknown;
    }>`
      select id, kind, title, body, href, read_at, created_at from notifications
      where user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
    const unread = await sql<{ n: number }>`
      select count(*) as n from notifications where user_id = ${context.userId} and read_at is null
    `;
    const incoming = await sql<{
      id: string;
      caller_id: string;
      kind: string;
      created_at: unknown;
      display_name: string;
    }>`
      select c.id, c.caller_id, c.kind, c.created_at, coalesce(p.display_name, 'Someone') as display_name
      from calls c
      left join profiles p on p.user_id = c.caller_id
      where c.callee_id = ${context.userId} and c.status = 'ringing'
      order by c.created_at desc
      limit 1
    `;
    const storyRows = await sql<{
      user_id: string;
      display_name: string;
      username: string | null;
      n: number;
      unseen: number;
    }>`
      select p.user_id, p.display_name, p.username,
        count(*) as n,
        count(*) filter (where v.viewer_id is null and p.user_id <> ${context.userId}) as unseen
      from stories s
      join profiles p on p.user_id = s.user_id
      left join story_views v on v.story_id = s.id and v.viewer_id = ${context.userId}
      where s.expires_at > now()
        and (
          s.user_id = ${context.userId}
          or exists (
            select 1 from friendships f
            where (f.user_a = ${context.userId} and f.user_b = s.user_id)
               or (f.user_b = ${context.userId} and f.user_a = s.user_id)
          )
        )
      group by p.user_id, p.display_name, p.username
      order by max(s.created_at) desc
      limit 30
    `;
    let thread = null as Awaited<ReturnType<typeof threadPayload>> | null;
    if (data.conversationId && (await memberRole(sql, data.conversationId, context.userId))) {
      thread = await threadPayload(sql, data.conversationId, context.userId);
    }
    return {
      ok: true as const,
      tombstone: false as const,
      me: mapMe(meRow, auth.email),
      chats,
      notices: notices.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: n.href,
        read: !!n.read_at,
        createdAt: iso(n.created_at),
      })),
      unreadNotices: num(unread[0]?.n),
      incoming: incoming[0]
        ? {
            id: incoming[0].id,
            callerId: incoming[0].caller_id,
            callerName: incoming[0].display_name,
            kind: incoming[0].kind,
            createdAt: iso(incoming[0].created_at),
          }
        : null,
      stories: storyRows.map((s) => ({
        userId: s.user_id,
        displayName: s.display_name,
        username: s.username,
        count: num(s.n),
        unseen: num(s.unseen),
      })),
      thread,
    };
  });

async function loadChats(sql: Sql, userId: string) {
  const memberships = await sql<{
    conversation_id: string;
    role: string;
    muted: boolean;
    archived: boolean;
    wallpaper: string;
    kind: string;
    title: string | null;
    description: string;
    disappearing_seconds: number | null;
    updated_at: unknown;
  }>`
    select cm.conversation_id, cm.role, cm.muted, cm.archived, cm.wallpaper,
      c.kind, c.title, c.description, c.disappearing_seconds, c.updated_at
    from conversation_members cm
    join conversations c on c.id = cm.conversation_id
    where cm.user_id = ${userId} and cm.left_at is null
    order by c.updated_at desc
  `;
  if (!memberships.length) return [];
  const members = await sql<{
    conversation_id: string;
    user_id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    last_seen_at: unknown;
    show_online: boolean;
    status: string;
  }>`
    select cm.conversation_id, cm.user_id, coalesce(p.display_name, 'Former member') as display_name,
      p.username, p.avatar_url, p.last_seen_at, coalesce(p.show_online, false) as show_online,
      coalesce(p.status, 'active') as status
    from conversation_members cm
    left join profiles p on p.user_id = cm.user_id
    where cm.left_at is null
      and cm.conversation_id in (
        select conversation_id from conversation_members where user_id = ${userId} and left_at is null
      )
  `;
  const lasts = await sql<{
    conversation_id: string;
    body: string;
    kind: string;
    sender_id: string;
    created_at: unknown;
    deleted_at: unknown;
  }>`
    select distinct on (conversation_id)
      conversation_id, body, kind, sender_id, created_at, deleted_at
    from messages
    where (expires_at is null or expires_at > now())
      and conversation_id in (
        select conversation_id from conversation_members where user_id = ${userId} and left_at is null
      )
    order by conversation_id, created_at desc
  `;
  const unreads = await sql<{ conversation_id: string; n: number }>`
    select m.conversation_id, count(*) as n
    from messages m
    join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${userId} and cm.left_at is null
    where m.sender_id <> ${userId}
      and m.deleted_at is null
      and (m.expires_at is null or m.expires_at > now())
      and m.created_at > coalesce(cm.last_read_at, '1970-01-01'::timestamptz)
      and not exists (select 1 from message_hides h where h.message_id = m.id and h.user_id = ${userId})
    group by m.conversation_id
  `;
  const unreadMap = new Map(unreads.map((u) => [u.conversation_id, num(u.n)]));
  const lastMap = new Map(lasts.map((l) => [l.conversation_id, l]));
  return memberships.map((c) => {
    const people = members.filter((m) => m.conversation_id === c.conversation_id);
    const others = people.filter((m) => m.user_id !== userId);
    const peer = others[0];
    const last = lastMap.get(c.conversation_id);
    let preview = "No messages yet";
    if (last?.deleted_at) preview = "Message removed";
    else if (last?.kind === "image") preview = "Photo";
    else if (last?.kind === "audio") preview = "Voice note";
    else if (last?.kind === "file") preview = "File";
    else if (last?.kind === "system") preview = last.body;
    else if (last?.kind === "announce") preview = last.body;
    else if (last) preview = snippet(last.body, 80);
    const online = !!(
      peer &&
      peer.show_online &&
      peer.status === "active" &&
      peer.last_seen_at &&
      Date.now() - new Date(String(peer.last_seen_at)).getTime() < 45_000
    );
    return {
      id: c.conversation_id,
      kind: c.kind,
      title: c.kind === "group" ? c.title || "Group" : peer?.display_name || "Conversation",
      username: c.kind === "direct" ? peer?.username ?? null : null,
      peerId: c.kind === "direct" ? peer?.user_id ?? null : null,
      avatarUrl: c.kind === "direct" ? safeMediaUrl(peer?.avatar_url ?? null) : null,
      description: c.description,
      muted: c.muted,
      archived: c.archived,
      wallpaper: c.wallpaper,
      disappearingSeconds: c.disappearing_seconds,
      myRole: c.role,
      unread: unreadMap.get(c.conversation_id) ?? 0,
      preview,
      lastAt: last ? iso(last.created_at) : iso(c.updated_at),
      online,
      memberCount: people.length,
    };
  });
}

export const markNotices = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().optional() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const sql = await getSql();
    if (data.id) {
      await sql`update notifications set read_at = now() where id = ${data.id} and user_id = ${context.userId}`;
    } else {
      await sql`update notifications set read_at = now() where user_id = ${context.userId} and read_at is null`;
    }
    return { ok: true };
  });

const StoryIn = z.object({
  kind: z.enum(["text", "image"]),
  body: z.string().max(240).optional(),
  bg: z.enum(["clay", "ink", "sage", "dusk", "apricot"]).optional(),
  mediaData: z.string().max(1_200_000).optional(),
  mediaMime: z.string().max(80).optional(),
});

export const postStory = createServerFn({ method: "POST" })
  .validator((input: unknown) => StoryIn.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ id: string }> | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error) return fail(gate.error);
    if (!(await allow(sql, context.userId, "story", 12, 24 * 3600_000))) return fail("Story limit for today reached.");
    let media: string | null = null;
    if (data.kind === "image") {
      if (!data.mediaData || !data.mediaMime || !IMAGE.has(data.mediaMime)) return fail("Use a JPG, PNG, or WebP.");
      const bare = bareBase64(data.mediaData);
      if (!bare || Math.floor(bare.length * 0.75) > 380_000) return fail("That photo is too large.");
      media = bare;
    } else if (!(data.body ?? "").trim()) return fail("Write a status first.");
    const id = crypto.randomUUID();
    const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
    await sql`
      insert into stories (id, user_id, kind, body, media_data, bg, expires_at)
      values (${id}, ${context.userId}, ${data.kind}, ${(data.body ?? "").trim()}, ${media}, ${data.bg ?? "clay"}, ${expires})
    `;
    return { ok: true, id };
  });

export const storiesFor = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (data.userId !== context.userId && !(await friends(sql, context.userId, data.userId))) {
      return fail("Stories are visible to friends.");
    }
    const rows = await sql<{
      id: string;
      kind: string;
      body: string;
      bg: string;
      created_at: unknown;
      expires_at: unknown;
      has_media: boolean;
      views: number;
    }>`
      select s.id, s.kind, s.body, s.bg, s.created_at, s.expires_at,
        (s.media_data is not null) as has_media,
        (select count(*) from story_views v where v.story_id = s.id) as views
      from stories s
      where s.user_id = ${data.userId} and s.expires_at > now()
      order by s.created_at asc
    `;
    if (data.userId !== context.userId) {
      for (const row of rows) {
        await sql`
          insert into story_views (story_id, viewer_id) values (${row.id}, ${context.userId})
          on conflict do nothing
        `;
      }
    }
    const reactions = await sql<{ story_id: string; emoji: string; n: number }>`
      select story_id, emoji, count(*) as n from story_reactions
      where story_id in (select id from stories where user_id = ${data.userId} and expires_at > now())
      group by story_id, emoji
    `;
    return {
      ok: true as const,
      stories: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        bg: r.bg,
        hasMedia: !!r.has_media,
        createdAt: iso(r.created_at),
        expiresAt: iso(r.expires_at),
        views: data.userId === context.userId ? num(r.views) : 0,
        reactions: reactions.filter((x) => x.story_id === r.id).map((x) => ({ emoji: x.emoji, count: num(x.n) })),
      })),
    };
  });

export const storyMedia = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ storyId: z.string() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ user_id: string; media_data: string | null; media_mime_missing: string | null }>`
      select user_id, media_data, null as media_mime_missing from stories where id = ${data.storyId} and expires_at > now()
    `;
    const row = rows[0];
    if (!row?.media_data) return fail("Story unavailable.");
    if (row.user_id !== context.userId && !(await friends(sql, context.userId, row.user_id))) {
      return fail("Stories are visible to friends.");
    }
    return { ok: true as const, data: row.media_data };
  });

export const reactStory = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ storyId: z.string(), emoji: z.string().max(8) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    if (!["♥", "☺", "!", "…", "✦", "↑"].includes(data.emoji)) return fail("That reaction is not available.");
    const rows = await sql<{ user_id: string }>`
      select user_id from stories where id = ${data.storyId} and expires_at > now()
    `;
    const owner = rows[0]?.user_id;
    if (!owner) return fail("Story unavailable.");
    if (owner !== context.userId && !(await friends(sql, context.userId, owner))) return fail("Not available.");
    await sql`
      insert into story_reactions (story_id, user_id, emoji) values (${data.storyId}, ${context.userId}, ${data.emoji})
      on conflict (story_id, user_id) do update set emoji = ${data.emoji}
    `;
    if (owner !== context.userId) {
      const ownerProfile = await loadProfile(sql, owner);
      const me = await loadProfile(sql, context.userId);
      if (ownerProfile?.notify_stories && me) {
        await notify(sql, owner, "story", "Story reaction", `${me.display_name} reacted to your story`, `story:${owner}`);
      }
    }
    return { ok: true };
  });

export const deleteStory = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ storyId: z.string() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    await sql`delete from stories where id = ${data.storyId} and user_id = ${context.userId}`;
    return { ok: true };
  });

export const startCall = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string(), kind: z.enum(["voice", "video"]) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ callId: string }> | Err> => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error || !gate.row) return fail(gate.error ?? "Unavailable.");
    if (!(await friends(sql, context.userId, data.userId))) return fail("You can call friends.");
    if (await blocked(sql, context.userId, data.userId)) return fail("You can't call this person.");
    if (!(await allow(sql, context.userId, "call", 12, 3600_000))) return fail("Too many call attempts.");
    const id = crypto.randomUUID();
    await sql`
      insert into calls (id, caller_id, callee_id, kind, status) values (${id}, ${context.userId}, ${data.userId}, ${data.kind}, 'ringing')
    `;
    const callee = await loadProfile(sql, data.userId);
    if (callee?.notify_messages) {
      await notify(sql, data.userId, "call", data.kind === "video" ? "Incoming video call" : "Incoming voice call", gate.row.display_name, `call:${id}`);
    }
    return { ok: true, callId: id };
  });

export const callAction = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ callId: z.string(), action: z.enum(["accept", "decline", "end", "cancel"]) }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<Ok<{ status: string }> | Err> => {
    const sql = await getSql();
    const rows = await sql<{ caller_id: string; callee_id: string; status: string }>`
      select caller_id, callee_id, status from calls where id = ${data.callId}
    `;
    const call = rows[0];
    if (!call) return fail("Call not found.");
    if (call.caller_id !== context.userId && call.callee_id !== context.userId) return fail("Not your call.");
    if (data.action === "accept") {
      if (call.callee_id !== context.userId) return fail("Only the person called can answer.");
      await sql`update calls set status = 'active', started_at = now() where id = ${data.callId} and status = 'ringing'`;
    } else if (data.action === "decline") {
      await sql`update calls set status = 'declined', ended_at = now() where id = ${data.callId} and status = 'ringing'`;
      await notify(sql, call.caller_id, "call", "Call declined", "They didn't pick up", "calls");
    } else if (data.action === "cancel" || data.action === "end") {
      const next = call.status === "ringing" ? "missed" : "ended";
      await sql`update calls set status = ${data.action === "cancel" ? "missed" : "ended"}, ended_at = now() where id = ${data.callId}`;
      if (data.action === "cancel") await notify(sql, call.callee_id, "call", "Missed call", "You missed a call", "calls");
      return { ok: true, status: data.action === "cancel" ? "missed" : next };
    }
    const updated = await sql<{ status: string }>`select status from calls where id = ${data.callId}`;
    return { ok: true, status: updated[0]?.status ?? "ended" };
  });

export const pollCall = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ callId: z.string(), after: z.number().optional() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ caller_id: string; callee_id: string; status: string; kind: string }>`
      select caller_id, callee_id, status, kind from calls where id = ${data.callId}
    `;
    const call = rows[0];
    if (!call || (call.caller_id !== context.userId && call.callee_id !== context.userId)) return fail("Not your call.");
    const signals = await sql<{ id: number; from_user_id: string; payload: string }>`
      select id, from_user_id, payload from call_signals
      where call_id = ${data.callId} and id > ${data.after ?? 0} and from_user_id <> ${context.userId}
      order by id asc
      limit 40
    `;
    return {
      ok: true as const,
      status: call.status,
      kind: call.kind,
      signals: signals.map((s) => ({ id: num(s.id), from: s.from_user_id, payload: s.payload })),
    };
  });

export const postSignal = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ callId: z.string(), payload: z.string().max(30_000) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const rows = await sql<{ caller_id: string; callee_id: string; status: string }>`
      select caller_id, callee_id, status from calls where id = ${data.callId}
    `;
    const call = rows[0];
    if (!call || (call.caller_id !== context.userId && call.callee_id !== context.userId)) return fail("Not your call.");
    if (call.status !== "active" && call.status !== "ringing") return fail("Call is over.");
    await sql`
      insert into call_signals (call_id, from_user_id, payload) values (${data.callId}, ${context.userId}, ${data.payload})
    `;
    return { ok: true };
  });

export const callLog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      caller_id: string;
      callee_id: string;
      kind: string;
      status: string;
      created_at: unknown;
      started_at: unknown;
      ended_at: unknown;
    }>`
      select id, caller_id, callee_id, kind, status, created_at, started_at, ended_at
      from calls
      where caller_id = ${context.userId} or callee_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
    const ids = [...new Set(rows.flatMap((r) => [r.caller_id, r.callee_id]))];
    const names = new Map<string, string>();
    for (const id of ids) {
      const p = await loadProfile(sql, id);
      names.set(id, p?.display_name ?? "Former member");
    }
    return {
      ok: true as const,
      calls: rows.map((r) => ({
        id: r.id,
        callerId: r.caller_id,
        calleeId: r.callee_id,
        peerId: r.caller_id === context.userId ? r.callee_id : r.caller_id,
        peerName: names.get(r.caller_id === context.userId ? r.callee_id : r.caller_id) ?? "Someone",
        kind: r.kind,
        status: r.status,
        direction: r.caller_id === context.userId ? "out" as const : "in" as const,
        createdAt: iso(r.created_at),
        startedAt: iso(r.started_at),
        endedAt: iso(r.ended_at),
      })),
    };
  });

export const listSessions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      createdAt: unknown;
      updatedAt: unknown;
      ipAddress: string | null;
      userAgent: string | null;
      expiresAt: unknown;
    }>`
      select "id", "createdAt", "updatedAt", "ipAddress", "userAgent", "expiresAt"
      from "session" where "userId" = ${context.userId}
      order by "updatedAt" desc
    `;
    return {
      ok: true as const,
      sessions: rows.map((r) => ({
        id: r.id,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
        ip: r.ipAddress,
        userAgent: r.userAgent,
        expiresAt: iso(r.expiresAt),
      })),
    };
  });

export const signOutAll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const sql = await getSql();
    await sql`delete from "session" where "userId" = ${context.userId}`;
    return { ok: true };
  });

export const exportArchive = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ includeMedia: z.boolean().optional() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const gate = await requireActive(sql, context.userId);
    if (gate.error || !gate.row) return fail(gate.error ?? "Unavailable.");
    if (!(await allow(sql, context.userId, "export", 6, 3600_000))) return fail("Export limit reached. Try again in an hour.");
    const auth = await authUser(sql, context.userId);
    const messages = await sql<{
      id: string;
      conversation_id: string;
      body: string;
      kind: string;
      created_at: unknown;
      media_name: string | null;
      media_mime: string | null;
      media_data: string | null;
    }>`
      select m.id, m.conversation_id, m.body, m.kind, m.created_at, m.media_name, m.media_mime,
        case when ${!!data.includeMedia} then m.media_data else null end as media_data
      from messages m
      join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${context.userId}
      where m.sender_id = ${context.userId} and m.deleted_at is null
      order by m.created_at desc
      limit 2000
    `;
    let mediaKept = 0;
    const trimmed = messages.map((m) => {
      let media: string | null = null;
      if (data.includeMedia && m.media_data && mediaKept < 20) {
        media = m.media_data;
        mediaKept += 1;
      }
      return {
        id: m.id,
        conversationId: m.conversation_id,
        body: m.body,
        kind: m.kind,
        createdAt: iso(m.created_at),
        fileName: m.media_name,
        mime: media ? m.media_mime : null,
        media,
      };
    });
    await sql`
      insert into backup_records (id, user_id, kind, note)
      values (${crypto.randomUUID()}, ${context.userId}, 'export', ${data.includeMedia ? "with-recent-media" : "text"})
    `;
    return {
      ok: true as const,
      archive: {
        product: "BANTER",
        exportedAt: new Date().toISOString(),
        note: "Live chats stay on Banter servers so they can be delivered. This file is your personal copy. It is not end-to-end encryption of the live conversation.",
        profile: mapMe(gate.row, auth.email),
        messages: trimmed.reverse(),
      },
    };
  });

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await loadProfile(sql, context.userId);
    if (me?.role !== "admin") return fail("Admins only.");
    const users = await sql<{ n: number }>`select count(*) as n from profiles where onboarding_complete = true`;
    const day = new Date(Date.now() - 24 * 3600_000).toISOString();
    const msgs = await sql<{ n: number }>`select count(*) as n from messages where created_at > ${day}`;
    const openReports = await sql<{ n: number }>`select count(*) as n from reports where status = 'open'`;
    const appealsOpen = await sql<{ n: number }>`select count(*) as n from appeals where status = 'open'`;
    const active = await sql<{ n: number }>`select count(*) as n from profiles where last_seen_at > ${day}`;
    const reportRows = await sql<{
      id: string;
      reason: string;
      details: string;
      status: string;
      created_at: unknown;
      reporter: string | null;
      target: string | null;
    }>`
      select r.id, r.reason, r.details, r.status, r.created_at,
        rp.username as reporter, tp.username as target
      from reports r
      left join profiles rp on rp.user_id = r.reporter_id
      left join profiles tp on tp.user_id = r.target_user_id
      order by r.created_at desc
      limit 40
    `;
    const userRows = await sql<{
      user_id: string;
      username: string | null;
      display_name: string;
      status: string;
      role: string;
      created_at: unknown;
    }>`
      select user_id, username, display_name, status, role, created_at
      from profiles order by created_at desc limit 50
    `;
    const appealRows = await sql<{ id: string; body: string; status: string; created_at: unknown; username: string | null; user_id: string }>`
      select a.id, a.body, a.status, a.created_at, p.username, a.user_id
      from appeals a left join profiles p on p.user_id = a.user_id
      order by a.created_at desc limit 20
    `;
    return {
      ok: true as const,
      stats: {
        people: num(users[0]?.n),
        messagesDay: num(msgs[0]?.n),
        openReports: num(openReports[0]?.n),
        openAppeals: num(appealsOpen[0]?.n),
        activeDay: num(active[0]?.n),
      },
      reports: reportRows.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: iso(r.created_at),
        reporter: r.reporter,
        target: r.target,
      })),
      users: userRows.map((u) => ({
        userId: u.user_id,
        username: u.username,
        displayName: u.display_name,
        status: u.status,
        role: u.role,
        createdAt: iso(u.created_at),
      })),
      appeals: appealRows.map((a) => ({
        id: a.id,
        userId: a.user_id,
        username: a.username,
        body: a.body,
        status: a.status,
        createdAt: iso(a.created_at),
      })),
    };
  });

export const adminAct = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      action: z.enum(["suspend", "restore", "dismiss-report", "close-appeal"]),
      userId: z.string().optional(),
      reportId: z.string().optional(),
      appealId: z.string().optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true } | Err> => {
    const sql = await getSql();
    const me = await loadProfile(sql, context.userId);
    if (me?.role !== "admin") return fail("Admins only.");
    if (data.action === "suspend" || data.action === "restore") {
      if (!data.userId || data.userId === context.userId) return fail("You can't change your own standing.");
      const target = await loadProfile(sql, data.userId);
      if (!target) return fail("No such account.");
      if (target.role === "admin") return fail("Admin accounts are not changed here.");
      await sql`
        update profiles set status = ${data.action === "suspend" ? "suspended" : "active"}
        where user_id = ${data.userId}
      `;
      return { ok: true };
    }
    if (data.action === "dismiss-report" && data.reportId) {
      await sql`update reports set status = 'dismissed' where id = ${data.reportId}`;
      return { ok: true };
    }
    if (data.action === "close-appeal" && data.appealId) {
      await sql`update appeals set status = 'closed' where id = ${data.appealId}`;
      return { ok: true };
    }
    return fail("Nothing to do.");
  });
