import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "@/lib/banter/api";

export type Me = {
  userId: string;
  username: string | null;
  displayName: string;
  bio: string;
  about: string;
  avatarUrl: string | null;
  birthday: string | null;
  location: string;
  interests: string[];
  hobbies: string;
  socials: { label: string; url: string }[];
  discoverability: string;
  lastSeenVisibility: string;
  showOnline: boolean;
  readReceipts: boolean;
  theme: string;
  status: string;
  role: string;
  onboardingComplete: boolean;
  notifyMessages: boolean;
  notifyFriends: boolean;
  notifyStories: boolean;
  lastSeenAt: string | null;
  usernameChangedAt: string | null;
  createdAt: string | null;
  email: string;
};

export type Chat = {
  id: string;
  kind: string;
  title: string | null;
  username: string | null;
  peerId: string | null;
  avatarUrl: string | null;
  description: string;
  muted: boolean;
  archived: boolean;
  wallpaper: string;
  disappearingSeconds: number | null;
  myRole: string;
  unread: number;
  preview: string;
  lastAt: string | null;
  online: boolean;
  memberCount: number;
};

export type Person = {
  userId: string;
  username: string | null;
  displayName: string;
  bio: string;
  about: string;
  avatarUrl: string | null;
  interests: string[];
  hobbies: string;
  location: string;
  birthday: string | null;
  socials: { label: string; url: string }[];
  createdAt: string | null;
  relationship: string;
  sharedInterests: string[];
  online: boolean;
  lastSeenAt: string | null;
  canMessage: boolean;
  blockedByMe?: boolean;
};

export type Notice = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string | null;
};

export type StoryRing = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  count: number;
  unseen: number;
};

export type Msg = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderUsername: string | null;
  body: string;
  kind: string;
  mime: string | null;
  fileName: string | null;
  hasMedia: boolean;
  replyToId: string | null;
  replyBody: string | null;
  replyKind: string | null;
  replyName: string | null;
  forwarded: boolean;
  editedAt: string | null;
  deleted: boolean;
  pinned: boolean;
  createdAt: string;
  reactions: { emoji: string; userId: string }[];
  starred: boolean;
};

export type Thread = {
  conversation: {
    id: string;
    kind: string;
    title: string | null;
    description: string;
    disappearingSeconds: number | null;
    createdBy: string;
    wallpaper: string;
    muted: boolean;
    archived: boolean;
    myRole: string;
  } | null;
  members: {
    userId: string;
    role: string;
    displayName: string;
    username: string | null;
    lastReadAt: string | null;
    online: boolean;
  }[];
  typing: { userId: string; displayName: string }[];
  messages: Msg[];
};

export type View =
  | { name: "inbox" | "people" | "stories" | "calls" | "me" | "edit" | "settings" | "privacy" | "security" | "backup" | "notifications" | "admin" | "new-group" | "search" }
  | { name: "thread" | "group" | "user" | "story"; id: string }
  | { name: "call"; callId: string; peerName: string; kind: "voice" | "video"; role: "caller" | "callee" };

type Incoming = { id: string; callerId: string; callerName: string; kind: string; createdAt: string | null } | null;

type Ctx = {
  loading: boolean;
  tombstone: boolean;
  me: Me | null;
  chats: Chat[];
  notices: Notice[];
  unreadNotices: number;
  stories: StoryRing[];
  incoming: Incoming;
  thread: Thread | null;
  people: { requests: { id: string; direction: "in" | "out"; person: Person }[]; friends: Person[]; suggestions: Person[] } | null;
  view: View;
  toast: string | null;
  nav: (v: View) => void;
  tab: (name: "inbox" | "people" | "stories" | "calls" | "me") => void;
  back: () => void;
  toastMsg: (s: string) => void;
  refresh: () => Promise<void>;
  refreshPeople: () => Promise<void>;
  run: <T>(p: Promise<{ ok: boolean; error?: string } & T>) => Promise<({ ok: true } & T) | null>;
};

const BanterContext = createContext<Ctx | null>(null);

export function useBanter() {
  const ctx = useContext(BanterContext);
  if (!ctx) throw new Error("Banter is not ready");
  return ctx;
}

export function BanterProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [tombstone, setTombstone] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [stories, setStories] = useState<StoryRing[]>([]);
  const [incoming, setIncoming] = useState<Incoming>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [people, setPeople] = useState<Ctx["people"]>(null);
  const [stack, setStack] = useState<View[]>([{ name: "inbox" }]);
  const [toast, setToast] = useState<string | null>(null);
  const view = stack[stack.length - 1] ?? { name: "inbox" as const };
  const viewRef = useRef(view);
  viewRef.current = view;
  const toastTimer = useRef<number | null>(null);

  const toastMsg = useCallback((s: string) => {
    setToast(s);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const run = useCallback(<T,>(p: Promise<{ ok: boolean; error?: string } & T>) => {
    return p.then((res) => {
      if (!res.ok) {
        toastMsg(res.error || "Something went wrong.");
        return null;
      }
      return res as { ok: true } & T;
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      if (message.toLowerCase().includes("unauthorized")) toastMsg("Sign in again to continue.");
      else toastMsg(message);
      return null;
    });
  }, [toastMsg]);

  const applySync = useCallback((res: Awaited<ReturnType<typeof api.sync>>) => {
    if (!res.ok) return;
    if (res.tombstone) {
      setTombstone(true);
      setMe(null);
      return;
    }
    setTombstone(false);
    setMe(res.me as Me);
    setChats(res.chats as Chat[]);
    setNotices(res.notices as Notice[]);
    setUnreadNotices(res.unreadNotices);
    setStories(res.stories as StoryRing[]);
    setIncoming(res.incoming as Incoming);
    const open = viewRef.current;
    const openId = open.name === "thread" || open.name === "group" ? open.id : null;
    if (openId && res.thread && res.thread.conversation?.id === openId) setThread(res.thread as Thread);
  }, []);

  const refresh = useCallback(async () => {
    const open = viewRef.current;
    const conversationId = open.name === "thread" || open.name === "group" ? open.id : undefined;
    const res = await api.sync({ data: { conversationId } });
    applySync(res);
  }, [applySync]);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await api.getMe();
        if (stop) return;
        if (!res.ok) {
          toastMsg(res.error ?? "Could not load your account.");
          setLoading(false);
          return;
        }
        if (res.tombstone) {
          setTombstone(true);
          setLoading(false);
          return;
        }
        setMe(res.me as Me);
        setLoading(false);
        if (res.me.onboardingComplete && res.me.status === "active") {
          const syncRes = await api.sync({ data: {} });
          if (!stop) applySync(syncRes);
        }
      } catch (err) {
        if (!stop) {
          toastMsg(err instanceof Error ? err.message : "Could not open Banter.");
          setLoading(false);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [applySync, toastMsg]);

  useEffect(() => {
    if (!me?.onboardingComplete || me.status !== "active") return;
    const id = window.setInterval(() => {
      void refresh();
    }, 3000);
    void refresh();
    return () => window.clearInterval(id);
  }, [me?.onboardingComplete, me?.status, me?.userId, view.name, view.name === "thread" || view.name === "group" ? view.id : "", refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = me?.theme === "light" ? "light" : "dark";
  }, [me?.theme]);

  const intentHandled = useRef(false);
  useEffect(() => {
    if (!me?.onboardingComplete || intentHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join");
    const username = params.get("u");
    if (!join && !username) return;
    intentHandled.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    if (join) {
      void run(api.redeemInvite({ data: { code: join } })).then((res) => {
        if (!res || !("kind" in res)) return;
        toastMsg(res.kind === "group" ? "You joined the group." : "You're connected with your friend.");
        if (res.conversationId) setStack([{ name: "inbox" }, { name: "thread", id: res.conversationId }]);
        void refresh();
      });
    } else if (username) {
      void api.getProfile({ data: { username } }).then((res) => {
        if (!res.ok) return;
        if (res.self) setStack([{ name: "me" }]);
        else setStack([{ name: "inbox" }, { name: "user", id: res.person.userId }]);
      });
    }
  }, [me?.onboardingComplete, me?.userId, refresh, run, toastMsg]);

  const loadPeople = useCallback(async () => {
    const res = await run(api.loadPeople());
    if (res && "friends" in res) setPeople({ requests: res.requests, friends: res.friends, suggestions: res.suggestions });
  }, [run]);

  const refreshPeople = useCallback(async () => {
    await loadPeople();
  }, [loadPeople]);

  useEffect(() => {
    if (view.name === "people" || view.name === "new-group") void loadPeople();
  }, [view.name, loadPeople]);

  const nav = useCallback((v: View) => {
    setStack((s) => {
      const top = s[s.length - 1];
      if (v.name === "thread" && top?.name === "thread") return [...s.slice(0, -1), v];
      return [...s, v];
    });
  }, []);

  const tab = useCallback((name: "inbox" | "people" | "stories" | "calls" | "me") => {
    setStack([{ name }]);
    if (name !== "inbox") setThread(null);
  }, []);

  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : [{ name: "inbox" }]));
  }, []);

  const value = useMemo<Ctx>(() => ({
    loading, tombstone, me, chats, notices, unreadNotices, stories, incoming, thread, people, view, toast,
    nav, tab, back, toastMsg, refresh, refreshPeople, run,
  }), [loading, tombstone, me, chats, notices, unreadNotices, stories, incoming, thread, people, view, toast, nav, tab, back, toastMsg, refresh, refreshPeople, run]);

  return <BanterContext.Provider value={value}>{children}</BanterContext.Provider>;
}
