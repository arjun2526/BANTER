import { requireSupabase } from "@/lib/supabase/client";

type ApiResult = { ok: boolean; error?: string; [key: string]: any };

async function invoke<T extends ApiResult = ApiResult>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const { data: result, error } = await requireSupabase().functions.invoke("banter-api", {
    body: { action, data },
  });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response instanceof Response) {
      try { return await response.json() as T; } catch { /* fall through */ }
    }
    return { ok: false, error: error.message || "BANTER request failed." } as T;
  }
  return result as T;
}

export const getMe = () => invoke("get_me");
export const completeOnboarding = ({ data }: { data: Record<string, unknown> }) => invoke("complete_onboarding", data);
export const checkUsername = ({ data }: { data: { username: string } }) => invoke("check_username", data);
export const updateProfile = ({ data }: { data: Record<string, unknown> }) => {
  const keys: Record<string, string> = {
    displayName: "display_name", username: "username", bio: "bio", about: "about",
    hobbies: "hobbies", location: "location", birthday: "birthday", interests: "interests",
    socials: "socials", avatarUrl: "avatar_url", discoverability: "discoverability",
    lastSeenVisibility: "last_seen_visibility", showOnline: "show_online",
    readReceipts: "read_receipts", theme: "theme", notifyMessages: "notify_messages",
    notifyFriends: "notify_friends", notifyStories: "notify_stories",
  };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) if (keys[key]) patch[keys[key]] = value;
  return invoke("update_profile", patch);
};
export const setAccountStatus = ({ data }: { data: { status: "active" | "deactivated" } }) => invoke("set_account_status", data);
export const deleteAccount = () => invoke("delete_account");
export const startOver = () => invoke("start_over");
export const appeal = ({ data }: { data: { body: string } }) => invoke("appeal", data);
export const searchPeople = ({ data }: { data: { q: string } }) => invoke("search_people", data);
export const loadPeople = () => invoke("load_people");
export const getProfile = ({ data }: { data: { userId?: string; username?: string } }) => invoke("get_profile", data);
export const friendAction = ({ data }: { data: { userId: string; action: "request" | "accept" | "reject" | "cancel" | "remove" | "block" | "unblock" } }) => invoke("friend_action", { userId: data.userId, actionType: data.action });
export const reportPerson = ({ data }: { data: { userId?: string; conversationId?: string; reason: string; details?: string } }) => invoke("report_person", data);
export const createInvite = ({ data }: { data: { conversationId?: string } }) => invoke("create_invite", data);
export const redeemInvite = ({ data }: { data: { code: string } }) => invoke("redeem_invite", data);
export const revokeInvite = ({ data }: { data: { code: string } }) => invoke("revoke_invite", data);
export const openDirect = ({ data }: { data: { userId: string } }) => invoke("open_direct", data);
export const createGroup = ({ data }: { data: Record<string, unknown> }) => invoke("create_group", data);
export const groupAction = ({ data }: { data: Record<string, unknown> }) => invoke("group_action", data);
export const sendMessage = ({ data }: { data: Record<string, unknown> }) => invoke("send_message", data);
export const messageAction = ({ data }: { data: Record<string, unknown> }) => invoke("message_action", data);
export const pulseTyping = ({ data }: { data: { conversationId: string; typing: boolean } }) => invoke("pulse_typing", data);
export const getAttachment = ({ data }: { data: { messageId: string } }) => invoke("get_attachment", data);
export const searchMessages = ({ data }: { data: { q: string; conversationId?: string } }) => invoke("search_messages", data);
export const sync = ({ data }: { data?: { conversationId?: string } } = {}) => invoke("sync", data ?? {});
export const markNotices = ({ data }: { data: { id?: string } }) => invoke("mark_notices", data);
export const postStory = ({ data }: { data: Record<string, unknown> }) => invoke("post_story", data);
export const storiesFor = ({ data }: { data: { userId: string } }) => invoke("stories_for", data);
export const storyMedia = ({ data }: { data: { storyId: string } }) => invoke("story_media", data);
export const reactStory = ({ data }: { data: { storyId: string; emoji: string } }) => invoke("react_story", data);
export const deleteStory = ({ data }: { data: { storyId: string } }) => invoke("delete_story", data);
export const startCall = ({ data }: { data: { userId: string; kind: "voice" | "video" } }) => invoke("start_call", data);
export const callAction = ({ data }: { data: { callId: string; action: "accept" | "decline" | "end" | "cancel" } }) => invoke("call_action", data);
export const pollCall = ({ data }: { data: { callId: string; after?: number } }) => invoke("poll_call", data);
export const postSignal = ({ data }: { data: { callId: string; payload: string } }) => invoke("post_signal", data);
export const callLog = () => invoke("call_log");
export const listSessions = async () => {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) return { ok: false, error: error.message, sessions: [] };
  const session = data.session;
  return { ok: true, sessions: session ? [{
    id: "current-device", createdAt: null, updatedAt: null, ip: null,
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  }] : [] };
};
export const signOutAll = async () => {
  const { error } = await requireSupabase().auth.signOut({ scope: "global" });
  return error ? { ok: false, error: error.message } : { ok: true };
};
export const exportArchive = ({ data }: { data: { includeMedia?: boolean } }) => invoke("export_archive", data);
export type AdminOverview = {
  stats: { people: number; messagesDay: number; openReports: number; openAppeals: number; activeDay: number };
  reports: { id: string; reason: string; details: string | null; status: string; createdAt: string; reporter: string | null; target: string | null }[];
  users: { userId: string; username: string | null; displayName: string; status: string; role: string; createdAt: string }[];
  appeals: { id: string; userId: string; username: string | null; body: string; status: string; createdAt: string }[];
};
export const adminOverview = () => invoke<AdminOverview & ApiResult>("admin_overview");
export const adminAct = ({ data }: { data: Record<string, unknown> }) => invoke("admin_act", data);
