import { createServerFn } from "@tanstack/react-start";
import { requireSupabase } from "@/lib/supabase/client";

type SupabaseActionResult = { ok: boolean; error?: string; [key: string]: any };

async function supabaseAction<T extends SupabaseActionResult = SupabaseActionResult>(
  action: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const { data: result, error } = await requireSupabase().functions.invoke("banter-api", { body: { action, data } });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context instanceof Response) {
      try { return await context.json() as T; } catch { /* fallback below */ }
    }
    return { ok: false, error: error.message || "BANTER request failed." } as T;
  }
  return result as T;
}

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

export const getMe = () => supabaseAction("get_me");

const Onboard = z.object({
  displayName: z.string(),
  username: z.string(),
  bio: z.string().max(160).optional(),
  about: z.string().max(600).optional(),
  interests: z.array(z.string()).max(12),
  hobbies: z.string().max(200).optional(),
});

export const completeOnboarding = ({ data }: { data: Record<string, unknown> }) => supabaseAction("complete_onboarding", data);

export const checkUsername = ({ data }: { data: { username: string } }) => supabaseAction("check_username", data);

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

export const updateProfile = ({ data }: { data: Record<string, unknown> }) => {
 const keys: Record<string,string> = {displayName:"display_name",username:"username",bio:"bio",about:"about",hobbies:"hobbies",location:"location",birthday:"birthday",interests:"interests",socials:"socials",avatarUrl:"avatar_url",discoverability:"discoverability",lastSeenVisibility:"last_seen_visibility",showOnline:"show_online",readReceipts:"read_receipts",theme:"theme",notifyMessages:"notify_messages",notifyFriends:"notify_friends",notifyStories:"notify_stories"};
 const patch:Record<string,unknown>={};for(const [key,value] of Object.entries(data))if(keys[key])patch[keys[key]]=value;
 return supabaseAction("update_profile",patch);
};

export const setAccountStatus = ({ data }: { data: { status: "active" | "deactivated" } }) => supabaseAction("set_account_status", data);

export const deleteAccount = () => supabaseAction("delete_account");

export const startOver = () => supabaseAction("start_over");

export const appeal = ({ data }: { data: { body: string } }) => supabaseAction("appeal", data);

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

export const searchPeople = ({ data }: { data: { q: string } }) => supabaseAction("search_people", data);

export const loadPeople = () => supabaseAction("load_people");

export const getProfile = ({ data }: { data: { userId?: string; username?: string } }) => supabaseAction("get_profile", data);

export const friendAction = ({ data }: { data: { userId: string; action: "request" | "accept" | "reject" | "cancel" | "remove" | "block" | "unblock" } }) => supabaseAction("friend_action", { userId: data.userId, actionType: data.action });

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

export const reportPerson = ({ data }: { data: { userId?: string; conversationId?: string; reason: string; details?: string } }) => supabaseAction("report_person", data);

export const createInvite = ({ data }: { data: { conversationId?: string } }) => supabaseAction("create_invite", data);

export const redeemInvite = ({ data }: { data: { code: string } }) => supabaseAction("redeem_invite", data);

export const revokeInvite = ({ data }: { data: { code: string } }) => supabaseAction("revoke_invite", data);

export const openDirect = ({ data }: { data: { userId: string } }) => supabaseAction("open_direct", data);

export const createGroup = ({ data }: { data: Record<string, unknown> }) => supabaseAction("create_group", data);

export const groupAction = ({ data }: { data: Record<string, unknown> }) => supabaseAction("group_action", data);

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

export const sendMessage = ({ data }: { data: Record<string, unknown> }) => supabaseAction("send_message", data);

export const messageAction = ({ data }: { data: Record<string, unknown> }) => supabaseAction("message_action", data);

export const pulseTyping = ({ data }: { data: { conversationId: string; typing: boolean } }) => supabaseAction("pulse_typing", data);

export const getAttachment = ({ data }: { data: { messageId: string } }) => supabaseAction("get_attachment", data);

export const searchMessages = ({ data }: { data: { q: string; conversationId?: string } }) => supabaseAction("search_messages", data);

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

export const sync = ({ data }: { data?: { conversationId?: string } } = {}) => supabaseAction("sync", data ?? {});

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

export const markNotices = ({ data }: { data: { id?: string } }) => supabaseAction("mark_notices", data);

const StoryIn = z.object({
  kind: z.enum(["text", "image"]),
  body: z.string().max(240).optional(),
  bg: z.enum(["clay", "ink", "sage", "dusk", "apricot"]).optional(),
  mediaData: z.string().max(1_200_000).optional(),
  mediaMime: z.string().max(80).optional(),
});

export const postStory = ({ data }: { data: Record<string, unknown> }) => supabaseAction("post_story", data);

export const storiesFor = ({ data }: { data: { userId: string } }) => supabaseAction("stories_for", data);

export const storyMedia = ({ data }: { data: { storyId: string } }) => supabaseAction("story_media", data);

export const reactStory = ({ data }: { data: { storyId: string; emoji: string } }) => supabaseAction("react_story", data);

export const deleteStory = ({ data }: { data: { storyId: string } }) => supabaseAction("delete_story", data);

export const startCall = ({ data }: { data: { userId: string; kind: "voice" | "video" } }) => supabaseAction("start_call", data);

export const callAction = ({ data }: { data: { callId: string; action: "accept" | "decline" | "end" | "cancel" } }) => supabaseAction("call_action", data);

export const pollCall = ({ data }: { data: { callId: string; after?: number } }) => supabaseAction("poll_call", data);

export const postSignal = ({ data }: { data: { callId: string; payload: string } }) => supabaseAction("post_signal", data);

export const callLog = () => supabaseAction("call_log");

export const listSessions = async () => {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) return { ok: false, error: error.message, sessions: [] };
  const session = data.session;
  return { ok: true, sessions: session ? [{
    id: "current-device",
    createdAt: null,
    updatedAt: null,
    ip: null,
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  }] : [] };
};

export const signOutAll = async () => {
  const { error } = await requireSupabase().auth.signOut({ scope: "global" });
  return error ? { ok: false, error: error.message } : { ok: true };
};

export const exportArchive = ({ data }: { data: { includeMedia?: boolean } }) => supabaseAction("export_archive", data);

export const adminOverview = () => supabaseAction("admin_overview");

export const adminAct = ({ data }: { data: Record<string, unknown> }) => supabaseAction("admin_act", data);
