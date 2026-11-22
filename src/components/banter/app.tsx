import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Bell,
  ImagePlus,
  Mic,
  Phone,
  Search,
  Send,
  Shield,
  Square,
  UserRound,
  Users,
  Video,
} from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { requireSupabase } from "@/lib/supabase/client";
import { signOut } from "@/lib/auth/client";
import * as api from "@/lib/banter/api";
import { decryptArchive, downloadBlob, encryptArchive } from "@/lib/banter/backup";
import { blobToBase64, compressImage, dataUrl } from "@/lib/banter/media";
import { INTERESTS, REACTIONS } from "@/lib/banter/rules";
import { CallRoom } from "@/components/banter/call-room";
import { Mark, Wordmark } from "@/components/banter/mark";
import { useBanter, type Chat, type Me, type Msg, type Person, type View } from "@/components/banter/provider";
import { Avatar, Btn, Empty, Field, TopBar, inputClass, when } from "@/components/banter/ui";

const EMOJI = ["😀", "😂", "🥹", "🔥", "✨", "👏", "❤️", "🎉", "🙏", "😎", "🤔", "😭"];

function mediaExt(mime: string) {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  };
  return map[mime] ?? "";
}

async function uploadUserMedia(bucket: "banter-avatars" | "banter-story-media", userId: string, file: File, maxBytes: number) {
  const ext = mediaExt(file.type);
  if (!ext) throw new Error("Choose a supported JPG, PNG, WebP, MP4, WebM, or MOV file.");
  if (file.size > maxBytes) throw new Error(`Choose a file smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await requireSupabase().storage.from(bucket).upload(path, file, {
    contentType: file.type, cacheControl: "3600", upsert: false,
  });
  if (error) throw error;
  return path;
}

export function BanterApp() {
  const b = useBanter();
  if (b.loading) return <main className="grid min-h-dvh place-items-center bg-bg"><Mark className="size-14" /></main>;
  if (b.tombstone) return <Tombstone />;
  if (!b.me) return <main className="grid min-h-dvh place-items-center px-6 text-center text-muted">Could not open your profile.</main>;
  if (!b.me.onboardingComplete) return <Onboarding me={b.me} />;
  if (b.me.status === "suspended") return <Suspended />;
  if (b.me.status === "deactivated") return <Deactivated />;
  return <Frame />;
}

function Frame() {
  const b = useBanter();
  const tab = b.view.name === "inbox" || b.view.name === "stories" || b.view.name === "people" || b.view.name === "calls" || b.view.name === "me";
  return (
    <div className="relative flex h-dvh bg-bg text-fg">
      <aside className="hidden w-[22rem] shrink-0 flex-col border-r border-line md:flex">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 md:hidden">
          {b.view.name === "inbox" ? <Inbox mobile /> : <Panel />}
        </div>
        <div className="hidden min-h-0 flex-1 md:block">
          {b.view.name === "inbox" ? <StoryPane /> : <Panel />}
        </div>
        {tab ? <BottomNav /> : null}
        {b.incoming && b.view.name !== "call" ? (
          <div className="absolute inset-x-0 top-3 z-20 mx-auto flex w-[min(100%-1.5rem,28rem)] items-center gap-3 rounded-3xl bg-elev px-3 py-3 shadow-lg ring-1 ring-line">
            <Avatar name={b.incoming.callerName} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{b.incoming.callerName}</div>
              <div className="text-xs text-muted">{b.incoming.kind === "video" ? "Video call" : "Voice call"}</div>
            </div>
            <Btn tone="danger" className="px-3" onClick={() => void b.run(api.callAction({ data: { callId: b.incoming!.id, action: "decline" } })).then(() => b.refresh())}>Decline</Btn>
            <Btn className="px-3" onClick={() => void answer(b)}>Answer</Btn>
          </div>
        ) : null}
        {b.toast ? <div className="pointer-events-none absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-fg px-4 py-2 text-sm text-bg">{b.toast}</div> : null}
      </div>
    </div>
  );
}

async function answer(b: ReturnType<typeof useBanter>) {
  if (!b.incoming) return;
  const res = await b.run(api.callAction({ data: { callId: b.incoming.id, action: "accept" } }));
  if (!res) return;
  b.nav({ name: "call", callId: b.incoming.id, peerName: b.incoming.callerName, kind: b.incoming.kind === "video" ? "video" : "voice", role: "callee" });
}

function BottomNav() {
  const b = useBanter();
  const items = [
    ["inbox", "Chats", MessageIcon],
    ["stories", "Stories", CircleIcon],
    ["people", "People", Users],
    ["calls", "Calls", Phone],
    ["me", "You", UserRound],
  ] as const;
  return (
    <nav className="grid grid-cols-5 border-t border-line bg-elev pb-[max(0.4rem,env(safe-area-inset-bottom))] md:hidden">
      {items.map(([name, label, Icon]) => {
        const on = b.view.name === name;
        return (
          <button key={name} type="button" className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "text-clay" : "text-muted"}`} onClick={() => b.tab(name)}>
            <Icon className="size-5" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 17.5 4 20V7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v7A2.5 2.5 0 0 1 17.5 17H8Z" /></svg>;
}
function CircleIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>;
}

function Sidebar() {
  const b = useBanter();
  const tabs = [
    ["inbox", "Chats"],
    ["stories", "Stories"],
    ["people", "People"],
    ["calls", "Calls"],
    ["me", "You"],
  ] as const;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-4 pt-5">
        <Mark className="size-10" />
        <Wordmark />
      </div>
      <div className="flex gap-1 px-3 py-3">
        {tabs.map(([name, label]) => (
          <button key={name} type="button" className={`min-h-10 flex-1 rounded-2xl text-xs ${b.view.name === name ? "bg-clay text-on-clay" : "text-muted"}`} onClick={() => b.tab(name)}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Inbox />
      </div>
    </div>
  );
}

function StoryPane() {
  return (
    <div className="wall-clay grid h-full place-items-center px-8 text-center">
      <div>
        <Mark className="mx-auto size-16" />
        <h2 className="mt-5 font-display text-4xl">Pick up a thread.</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Messages stay between the people in the chat. Banter is not end-to-end encrypted — see Security for exactly what that means.</p>
      </div>
    </div>
  );
}

function Panel() {
  const b = useBanter();
  const v = b.view;
  if (v.name === "thread") return <ThreadView id={v.id} />;
  if (v.name === "people") return <People />;
  if (v.name === "stories") return <Stories />;
  if (v.name === "story") return <StoryViewer userId={v.id} />;
  if (v.name === "calls") return <Calls />;
  if (v.name === "call") return (
    <CallRoom
      callId={v.callId}
      kind={v.kind}
      role={v.role}
      peerName={v.peerName}
      onHangup={() => {
        void api.callAction({ data: { callId: v.callId, action: "end" } });
        b.back();
      }}
    />
  );
  if (v.name === "me") return <MeScreen />;
  if (v.name === "edit") return <EditProfile />;
  if (v.name === "user") return <PersonScreen userId={v.id} />;
  if (v.name === "settings") return <Settings />;
  if (v.name === "privacy") return <Privacy />;
  if (v.name === "security") return <Security />;
  if (v.name === "backup") return <Backup />;
  if (v.name === "notifications") return <Notices />;
  if (v.name === "admin") return <Admin />;
  if (v.name === "group") return <GroupInfo id={v.id} />;
  if (v.name === "new-group") return <NewGroup />;
  if (v.name === "search") return <SearchScreen />;
  return <Inbox mobile />;
}

function Inbox({ mobile = false }: { mobile?: boolean }) {
  const b = useBanter();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const rows = b.chats.filter((c) => c.archived === archived && (!q || `${c.title} ${c.preview}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4 md:pt-2">
        {mobile ? (
          <div className="flex items-center gap-2">
            <Mark className="size-9" />
            <span className="font-display text-2xl">Banter</span>
          </div>
        ) : <h2 className="text-sm tracking-wide text-muted uppercase">Chats</h2>}
        <div className="flex gap-1">
          <IconBtn label="Search" onClick={() => b.nav({ name: "search" })}><Search className="size-5" /></IconBtn>
          <IconBtn label="Notices" onClick={() => b.nav({ name: "notifications" })}>
            <span className="relative">
              <Bell className="size-5" />
              {b.unreadNotices > 0 ? <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-clay text-[10px] text-on-clay">{b.unreadNotices}</span> : null}
            </span>
          </IconBtn>
        </div>
      </div>
      <div className="px-4 py-3">
        <input className={inputClass} placeholder="Filter conversations" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <StoryRow />
      <div className="flex gap-2 px-4 pb-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${!archived ? "bg-clay text-on-clay" : "text-muted"}`} onClick={() => setArchived(false)}>Open</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${archived ? "bg-clay text-on-clay" : "text-muted"}`} onClick={() => setArchived(true)}>Archived</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <Empty title={archived ? "Nothing archived" : "No chats yet"} body="Find a friend and start a story." action={<Btn onClick={() => b.tab("people")}>Find people</Btn>} />
        ) : rows.map((c) => <ChatRow key={c.id} chat={c} />)}
      </div>
    </div>
  );
}

function StoryRow() {
  const b = useBanter();
  if (!b.stories.length && !b.me) return null;
  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-3">
      <button type="button" className="w-16 shrink-0 text-center" onClick={() => b.nav({ name: "stories" })}>
        <span className="mx-auto grid size-14 place-items-center rounded-full border border-dashed border-clay text-clay">+</span>
        <span className="mt-1 block text-[11px] text-muted">Story</span>
      </button>
      {b.stories.map((s) => (
        <button key={s.userId} type="button" className="w-16 shrink-0 text-center" onClick={() => b.nav({ name: "story", id: s.userId })}>
          <span className={`mx-auto grid size-14 place-items-center rounded-full ${s.unseen || s.userId === b.me?.userId ? "bg-clay" : "bg-line"} p-0.5`}>
            <span className="grid size-full place-items-center rounded-full bg-elev text-sm">{s.displayName[0]}</span>
          </span>
          <span className="mt-1 block truncate text-[11px]">{s.userId === b.me?.userId ? "You" : s.displayName.split(" ")[0]}</span>
        </button>
      ))}
    </div>
  );
}

function ChatRow({ chat }: { chat: Chat }) {
  const b = useBanter();
  const active = b.view.name === "thread" && b.view.id === chat.id;
  return (
    <button type="button" onClick={() => b.nav({ name: "thread", id: chat.id })} className={`flex w-full items-center gap-3 px-4 py-3 text-left ${active ? "bg-sunken" : ""}`}>
      <Avatar name={chat.title || "?"} url={chat.avatarUrl} online={chat.online} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">{chat.title}</span>
          <span className="shrink-0 text-[11px] text-muted tabular-nums">{when(chat.lastAt)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-sm text-muted">
          <span className="truncate">{chat.preview}</span>
          {chat.muted ? <span className="text-[10px] uppercase">Muted</span> : null}
        </span>
      </span>
      {chat.unread > 0 ? <span className="grid min-w-6 place-items-center rounded-full bg-clay px-1.5 text-xs text-on-clay tabular-nums">{chat.unread}</span> : null}
    </button>
  );
}

function ThreadView({ id }: { id: string }) {
  const b = useBanter();
  const thread = b.thread?.conversation?.id === id ? b.thread : null;
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [menu, setMenu] = useState<Msg | null>(null);
  const [recording, setRecording] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chat = b.chats.find((c) => c.id === id);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [thread?.messages.length]);

  async function send(extra?: { kind: "image" | "audio" | "file"; data: string; mime: string; name?: string; body?: string }) {
    const body = (extra?.body ?? text).trim();
    if (!extra && !body) return;
    if (editing && !extra) {
      const res = await b.run(api.messageAction({ data: { messageId: editing.id, action: "edit", body } }));
      if (res) {
        setEditing(null);
        setText("");
        await b.refresh();
      }
      return;
    }
    const res = await b.run(api.sendMessage({
      data: {
        conversationId: id,
        body,
        kind: extra?.kind ?? (thread?.conversation?.kind === "group" && body.startsWith("/announce ") ? "announce" : "text"),
        mediaData: extra?.data,
        mediaMime: extra?.mime,
        mediaName: extra?.name,
        replyToId: reply?.id ?? null,
      },
    }));
    if (!res) return;
    setText("");
    setReply(null);
    await b.refresh();
  }

  async function onPhoto(file: File) {
    try {
      const img = await compressImage(file);
      await send({ kind: "image", data: img.data, mime: img.mime, body: text.trim() });
    } catch (err) {
      b.toastMsg(err instanceof Error ? err.message : "Could not send that photo.");
    }
  }

  async function toggleRec() {
    if (recRef.current) {
      recRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recRef.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size > 680_000) {
          b.toastMsg("That voice note is too long.");
          return;
        }
        void blobToBase64(blob).then((data) => send({ kind: "audio", data, mime: (blob.type.split(";")[0] || "audio/webm") }));
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      window.setTimeout(() => { if (rec.state === "recording") rec.stop(); }, 60_000);
    } catch {
      b.toastMsg("Microphone permission was denied.");
    }
  }

  const title = thread?.conversation?.kind === "group" ? thread.conversation.title || "Group" : chat?.title || "Chat";
  const typing = thread?.typing.map((t) => t.displayName).join(", ");
  const pins = thread?.messages.filter((m) => m.pinned) ?? [];
  return (
    <div className={`flex h-full flex-col wall-${thread?.conversation?.wallpaper || chat?.wallpaper || "ink"}`}>
      <TopBar
        title={title || "Chat"}
        subtitle={typing ? `${typing} is writing` : chat?.online ? "Online" : undefined}
        onBack={b.back}
        right={
          <div className="flex">
            {chat?.kind === "direct" && chat.peerId ? (
              <>
                <IconBtn label="Voice call" onClick={() => void placeCall(b, chat.peerId!, chat.title || "Friend", "voice")}><Phone className="size-5" /></IconBtn>
                <IconBtn label="Video call" onClick={() => void placeCall(b, chat.peerId!, chat.title || "Friend", "video")}><Video className="size-5" /></IconBtn>
              </>
            ) : null}
            <IconBtn label="Details" onClick={() => b.nav({ name: "group", id })}><Users className="size-5" /></IconBtn>
          </div>
        }
      />
      {pins.length ? (
        <div className="border-b border-line bg-elev/80 px-4 py-2 text-xs text-muted">
          Pinned: {pins.map((p) => p.body || p.kind).slice(0, 3).join(" · ")}
        </div>
      ) : null}
      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {!thread ? <p className="text-center text-sm text-muted">Loading conversation…</p> : null}
        {thread?.messages.map((m) => (
          <Bubble key={m.id} msg={m} mine={m.senderId === b.me?.userId} members={thread.members} onOpen={() => setMenu(m)} />
        ))}
      </div>
      {reply ? <Banner label={`Replying to ${reply.senderName}`} body={reply.body || reply.kind} onClear={() => setReply(null)} /> : null}
      {editing ? <Banner label="Editing" body={editing.body} onClear={() => { setEditing(null); setText(""); }} /> : null}
      <div className="no-scrollbar flex gap-1 overflow-x-auto px-3 pt-2">
        {EMOJI.map((e) => (
          <button key={e} type="button" className="grid size-10 place-items-center rounded-xl text-lg" onClick={() => setText((t) => t + e)}>{e}</button>
        ))}
      </div>
      <form className="flex items-end gap-2 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="grid size-11 cursor-pointer place-items-center rounded-2xl bg-elev" aria-label="Photo">
          <ImagePlus className="size-5" />
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.target.value = ""; }} />
        </label>
        <button type="button" className="grid size-11 place-items-center rounded-2xl bg-elev" onClick={() => void toggleRec()} aria-label="Voice note">
          {recording ? <Square className="size-4 text-danger" /> : <Mic className="size-5" />}
        </button>
        <textarea
          className={`${inputClass} max-h-32 min-h-11 flex-1 resize-none py-2.5`}
          rows={1}
          placeholder="Write something true"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            void api.pulseTyping({ data: { conversationId: id, typing: e.target.value.length > 0 } });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="grid size-11 place-items-center rounded-2xl bg-clay text-on-clay" aria-label="Send"><Send className="size-5" /></button>
      </form>
      {menu ? (
        <Sheet onClose={() => setMenu(null)}>
          <div className="flex justify-center gap-2">
            {REACTIONS.map((emoji) => (
              <button key={emoji} type="button" className="grid size-11 place-items-center rounded-2xl bg-sunken text-lg" onClick={() => { void b.run(api.messageAction({ data: { messageId: menu.id, action: "react", emoji } })).then(() => b.refresh()); setMenu(null); }}>{emoji}</button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn tone="quiet" onClick={() => { setReply(menu); setMenu(null); }}>Reply</Btn>
            <Btn tone="quiet" onClick={() => { setForward(menu); setMenu(null); }}>Forward</Btn>
            {menu.senderId === b.me?.userId && (menu.kind === "text" || menu.kind === "announce") ? <Btn tone="quiet" onClick={() => { setEditing(menu); setText(menu.body); setMenu(null); }}>Edit</Btn> : null}
            {menu.senderId === b.me?.userId ? <Btn tone="danger" onClick={() => { void b.run(api.messageAction({ data: { messageId: menu.id, action: "delete" } })).then(() => b.refresh()); setMenu(null); }}>Delete</Btn> : null}
            <Btn tone="quiet" onClick={() => { void b.run(api.messageAction({ data: { messageId: menu.id, action: "hide" } })).then(() => b.refresh()); setMenu(null); }}>Hide for me</Btn>
            <Btn tone="quiet" onClick={() => { void b.run(api.messageAction({ data: { messageId: menu.id, action: "star" } })).then(() => b.refresh()); setMenu(null); }}>{menu.starred ? "Unstar" : "Star"}</Btn>
            <Btn tone="quiet" onClick={() => { void b.run(api.messageAction({ data: { messageId: menu.id, action: "pin" } })).then(() => b.refresh()); setMenu(null); }}>{menu.pinned ? "Unpin" : "Pin"}</Btn>
          </div>
        </Sheet>
      ) : null}
      <Forwarder />
    </div>
  );

  function setForward(msg: Msg) {
    const dest = b.chats.find((c) => c.id !== id);
    if (!dest) {
      b.toastMsg("Open another chat before forwarding.");
      return;
    }
    const choice = window.prompt(`Forward to which chat?\n${b.chats.filter((c) => c.id !== id).map((c, i) => `${i + 1}. ${c.title}`).join("\n")}`, "1");
    const index = Number(choice) - 1;
    const target = b.chats.filter((c) => c.id !== id)[index];
    if (!target) return;
    void b.run(api.messageAction({ data: { messageId: msg.id, action: "forward", conversationId: target.id } })).then(() => b.toastMsg(`Forwarded to ${target.title}`));
  }
}

function Bubble({ msg, mine, members, onOpen }: { msg: Msg; mine: boolean; members: { userId: string; lastReadAt: string | null }[]; onOpen: () => void }) {
  if (msg.kind === "system") return <p className="text-center text-xs text-muted">{msg.body}</p>;
  const read = mine && members.some((m) => m.userId !== msg.senderId && m.lastReadAt && new Date(m.lastReadAt) >= new Date(msg.createdAt));
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <button type="button" onClick={onOpen} className={`max-w-[82%] rounded-3xl px-3.5 py-2 text-left ${mine ? "rounded-br-md bg-clay text-on-clay" : "rounded-bl-md border border-line bg-elev text-fg"} ${msg.kind === "announce" ? "ring-1 ring-apricot" : ""}`}>
        {!mine ? <div className="text-[11px] text-apricot">{msg.senderName}</div> : null}
        {msg.forwarded ? <div className="text-[10px] uppercase opacity-70">Forwarded</div> : null}
        {msg.replyToId ? <div className="mb-1 rounded-xl bg-sunken/40 px-2 py-1 text-xs opacity-80">{msg.replyName}: {msg.replyBody || "Original removed"}</div> : null}
        {msg.deleted ? <span className="text-sm italic opacity-70">Message removed</span> : null}
        {msg.hasMedia ? <Attachment id={msg.id} kind={msg.kind} mime={msg.mime} name={msg.fileName} /> : null}
        {msg.body ? <p className="text-[15px] leading-snug whitespace-pre-wrap">{msg.body}</p> : null}
        <div className={`mt-1 flex items-center justify-end gap-2 text-[10px] tabular-nums ${mine ? "text-on-clay/70" : "text-muted"}`}>
          {msg.reactions.length ? <span>{summarize(msg.reactions)}</span> : null}
          {msg.editedAt ? <span>Edited</span> : null}
          {msg.starred ? <span>Starred</span> : null}
          <span>{when(msg.createdAt)}</span>
          {mine ? <span>{read ? "Read" : "Sent"}</span> : null}
        </div>
      </button>
    </div>
  );
}

function summarize(reactions: { emoji: string }[]) {
  const map = new Map<string, number>();
  for (const r of reactions) map.set(r.emoji, (map.get(r.emoji) ?? 0) + 1);
  return [...map.entries()].map(([e, n]) => `${e}${n > 1 ? n : ""}`).join(" ");
}

function Attachment({ id, kind, mime, name }: { id: string; kind: string; mime: string | null; name: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.getAttachment({ data: { messageId: id } }).then((res) => {
      if (!live || !res.ok) return;
      setUrl(dataUrl(res.mime, res.data));
    });
    return () => { live = false; };
  }, [id]);
  if (!url) return <div className="my-1 h-16 w-36 animate-pulse rounded-xl bg-sunken" />;
  if (kind === "audio" || mime?.startsWith("audio/")) return <audio controls src={url} className="my-1 max-w-full" />;
  if (kind === "image" || mime?.startsWith("image/")) return <img src={url} alt="" className="my-1 max-h-64 rounded-2xl object-cover" />;
  return <a className="underline" href={url} download={name || "file"}>{name || "Download file"}</a>;
}

function People() {
  const b = useBanter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Person[] | null>(null);
  return (
    <div className="flex h-full flex-col">
      <TopBar title="People" onBack={b.back} right={<Btn className="px-3" onClick={() => b.nav({ name: "new-group" })}>New group</Btn>} />
      <div className="space-y-3 overflow-y-auto px-4 py-3">
        <form onSubmit={(e) => {
          e.preventDefault();
          void b.run(api.searchPeople({ data: { q } })).then((res) => { if (res && "people" in res) setHits(res.people); });
        }}>
          <input className={inputClass} placeholder="Search a Banter ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <Btn tone="ghost" className="w-full" onClick={() => void inviteFriend(b)}>Invite someone who isn't here yet</Btn>
        {hits ? (
          <Section title="Results">
            {hits.length === 0 ? <p className="text-sm text-muted">No public Banter ID matches. Phone numbers are never searched.</p> : hits.map((p) => <PersonRow key={p.userId} person={p} />)}
          </Section>
        ) : null}
        <Section title="Requests">
          {b.people?.requests.length ? b.people.requests.map((r) => (
            <div key={r.id} className="flex items-center gap-2 border-b border-line py-2">
              <div className="min-w-0 flex-1"><PersonRow person={r.person} /></div>
              {r.direction === "in" ? (
                <div className="flex shrink-0 gap-1">
                  <Btn className="px-3" onClick={() => void b.run(api.friendAction({ data: { userId: r.person.userId, action: "accept" } })).then(async (res) => { if (res) { await Promise.all([b.refresh(), b.refreshPeople()]); b.toastMsg("Friend added. Open their profile and tap Message to start chatting."); } })}>Accept</Btn>
                  <Btn tone="ghost" className="px-3" onClick={() => void b.run(api.friendAction({ data: { userId: r.person.userId, action: "reject" } })).then((res) => { if (res) void b.refresh(); })}>Decline</Btn>
                </div>
              ) : <Btn tone="quiet" className="px-3" onClick={() => void b.run(api.friendAction({ data: { userId: r.person.userId, action: "cancel" } })).then((res) => { if (res) void b.refresh(); })}>Cancel</Btn>}
            </div>
          )) : <p className="text-sm text-muted">No open requests.</p>}
        </Section>
        <Section title="Friends">
          {b.people?.friends.length ? b.people.friends.map((p) => <PersonRow key={p.userId} person={p} />) : <p className="text-sm text-muted">Friends you add will show up here.</p>}
        </Section>
        <Section title="Similar interests">
          {b.people?.suggestions.length ? b.people.suggestions.map((p) => <PersonRow key={p.userId} person={p} />) : <p className="text-sm text-muted">Add interests to your profile to see people who share them.</p>}
        </Section>
      </div>
    </div>
  );
}

function PersonRow({ person }: { person: Person }) {
  const b = useBanter();
  return (
    <button type="button" className="flex w-full items-center gap-3 py-2 text-left" onClick={() => b.nav({ name: "user", id: person.userId })}>
      <Avatar name={person.displayName} url={person.avatarUrl} online={person.online} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{person.displayName}</span>
        <span className="block truncate text-sm text-muted">{person.username ? `@${person.username}` : "No ID yet"}{person.sharedInterests.length ? ` · ${person.sharedInterests.slice(0, 2).join(", ")}` : ""}</span>
      </span>
    </button>
  );
}

function PersonScreen({ userId }: { userId: string }) {
  const b = useBanter();
  const [person, setPerson] = useState<(Person & { blockedByMe?: boolean }) | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    void api.getProfile({ data: { userId } }).then((res) => {
      if (!res.ok) setMissing(res.error ?? "Could not load this profile.");
      else if (res.self) b.tab("me");
      else setPerson(res.person);
    });
  }, [userId]);
  if (missing) return <div className="p-6"><TopBar title="Profile" onBack={b.back} /><p className="mt-6 text-sm text-muted">{missing}</p></div>;
  if (!person) return <div className="p-6 text-sm text-muted">Loading profile…</div>;
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title={person.username ? `@${person.username}` : "Profile"} onBack={b.back} />
      <div className="wall-clay px-5 py-8">
        <Avatar name={person.displayName} url={person.avatarUrl} className="size-20 text-2xl" online={person.online} />
        <h1 className="mt-4 font-display text-4xl">{person.displayName}</h1>
        <p className="mt-2 text-sm text-muted">{person.bio || "No bio yet."}</p>
      </div>
      <div className="space-y-3 px-5 py-4">
        {person.about ? <p className="text-sm">{person.about}</p> : null}
        {person.location ? <p className="text-sm text-muted">{person.location}</p> : null}
        {person.interests.length ? <p className="text-sm text-apricot">{person.interests.join(" · ")}</p> : null}
        <div className="grid grid-cols-2 gap-2 pt-2">
          {person.relationship === "none" ? <Btn onClick={() => void act("request")}>Add friend</Btn> : null}
          {person.relationship === "pending-out" ? <Btn tone="quiet" onClick={() => void act("cancel")}>Cancel request</Btn> : null}
          {person.relationship === "pending-in" ? <Btn onClick={() => void act("accept")}>Accept</Btn> : null}
          {person.relationship === "pending-in" ? <Btn tone="ghost" onClick={() => void act("reject")}>Decline</Btn> : null}
          {person.canMessage ? <Btn onClick={() => void message()}>Message</Btn> : null}
          {person.relationship === "friends" ? <Btn tone="ghost" onClick={() => void act("remove")}>Remove</Btn> : null}
          {person.blockedByMe ? <Btn onClick={() => void act("unblock")}>Unblock</Btn> : <Btn tone="danger" onClick={() => void act("block")}>Block</Btn>}
          <Btn tone="ghost" onClick={() => void report(person.userId)}>Report</Btn>
        </div>
        {person.lastSeenAt ? <p className="text-xs text-muted">Last seen {when(person.lastSeenAt)}</p> : null}
      </div>
    </div>
  );
  async function act(action: "request" | "accept" | "reject" | "cancel" | "remove" | "block" | "unblock") {
    const res = await b.run(api.friendAction({ data: { userId, action } }));
    if (!res) return;
    const next = await api.getProfile({ data: { userId } });
    if (next.ok && !next.self) setPerson(next.person);
    await Promise.all([b.refresh(), b.refreshPeople()]);
  }
  async function message() {
    const res = await b.run(api.openDirect({ data: { userId } }));
    if (res && "conversationId" in res) b.nav({ name: "thread", id: res.conversationId });
  }
}

function Stories() {
  const b = useBanter();
  const [body, setBody] = useState("");
  const [bg, setBg] = useState<"clay" | "ink" | "sage" | "dusk" | "apricot">("clay");
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Stories" subtitle="Visible to friends for 24 hours" onBack={b.back} />
      <div className="space-y-3 overflow-y-auto px-4 py-4">
        <div className={`story-${bg} min-h-40 rounded-3xl p-5`}>
          <p className="font-display text-3xl">{body || "A line from your day"}</p>
        </div>
        <textarea className={inputClass} maxLength={240} placeholder="What's the story?" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex gap-2">
          {(["clay", "ink", "sage", "dusk", "apricot"] as const).map((c) => (
            <button key={c} type="button" className={`story-${c} size-9 rounded-full ring-2 ${bg === c ? "ring-fg" : "ring-transparent"}`} onClick={() => setBg(c)} aria-label={c} />
          ))}
        </div>
        <Btn onClick={() => void b.run(api.postStory({ data: { kind: "text", body, bg } })).then((res) => { if (res) { setBody(""); void b.refresh(); } })}>Share with friends</Btn>
        <label className="block">
          <span className="mb-2 block text-sm text-muted">Add a photo or video (up to 50 MB)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file || !b.me) return;
            const kind = file.type.startsWith("video/") ? "video" : "image";
            void uploadUserMedia("banter-story-media", b.me.userId, file, 50 * 1024 * 1024)
              .then((mediaPath) => b.run(api.postStory({ data: { kind, body, bg, mediaPath, mediaMime: file.type } })))
              .then((res) => { if (res) { setBody(""); void b.refresh(); } })
              .catch((err) => b.toastMsg(err instanceof Error ? err.message : "Could not post that story."));
            e.target.value = "";
          }} />
        </label>
        <Section title="From friends">
          {b.stories.map((s) => (
            <button key={s.userId} type="button" className="flex w-full items-center gap-3 py-2 text-left" onClick={() => b.nav({ name: "story", id: s.userId })}>
              <Avatar name={s.displayName} />
              <span><span className="block font-medium">{s.displayName}</span><span className="text-xs text-muted">{s.unseen ? "New" : "Seen"}</span></span>
            </button>
          ))}
        </Section>
      </div>
    </div>
  );
}

function StoryViewer({ userId }: { userId: string }) {
  const b = useBanter();
  const [items, setItems] = useState<{ id: string; kind: string; body: string; bg: string; hasMedia: boolean; mediaMime?: string | null; createdAt: string | null; views: number }[]>([]);
  const [index, setIndex] = useState(0);
  const [media, setMedia] = useState<{ url: string; mime: string } | null>(null);
  useEffect(() => {
    void api.storiesFor({ data: { userId } }).then((res) => { if (res.ok) setItems(res.stories); else b.toastMsg(res.error ?? "Could not load stories."); });
  }, [userId]);
  const item = items[index];
  useEffect(() => {
    if (!item?.hasMedia) { setMedia(null); return; }
    void api.storyMedia({ data: { storyId: item.id } }).then((res) => {
      if (!res.ok) { b.toastMsg(res.error ?? "Could not load story media."); return; }
      setMedia(res.url ? { url: res.url, mime: res.mime ?? item.mediaMime ?? "" } : { url: dataUrl(item.mediaMime ?? "image/jpeg", res.data), mime: item.mediaMime ?? "image/jpeg" });
    });
  }, [item?.id, item?.hasMedia]);
  if (!item) return <div className="p-6"><TopBar title="Story" onBack={b.back} /><p className="mt-4 text-sm text-muted">Nothing live right now.</p></div>;
  return (
    <div className={`story-${item.bg} flex h-full flex-col`}>
      <TopBar title="Story" subtitle={when(item.createdAt)} onBack={b.back} />
      <div className="flex flex-1 flex-col justify-end p-5">
        {media ? (media.mime.startsWith("video/") ? <video src={media.url} controls playsInline className="mb-4 max-h-[50vh] w-full rounded-3xl object-contain" /> : <img src={media.url} alt="" className="mb-4 max-h-[50vh] rounded-3xl object-cover" />) : null}
        <p className="font-display text-4xl">{item.body}</p>
        {userId === b.me?.userId ? <p className="mt-3 text-sm opacity-80">{item.views} views</p> : null}
        <div className="mt-4 flex gap-2">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className="grid size-11 place-items-center rounded-full bg-black/20" onClick={() => void api.reactStory({ data: { storyId: item.id, emoji } })}>{emoji}</button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          {index > 0 ? <Btn tone="ghost" onClick={() => setIndex(index - 1)}>Previous</Btn> : null}
          {index < items.length - 1 ? <Btn tone="ghost" onClick={() => setIndex(index + 1)}>Next</Btn> : null}
          {userId === b.me?.userId ? <Btn tone="danger" onClick={() => void b.run(api.deleteStory({ data: { storyId: item.id } })).then(() => b.back())}>Delete</Btn> : null}
        </div>
      </div>
    </div>
  );
}

function Calls() {
  const b = useBanter();
  const [rows, setRows] = useState<{ id: string; peerId: string; peerName: string; kind: string; status: string; direction: "in" | "out"; createdAt: string | null }[]>([]);
  useEffect(() => { void api.callLog().then((res) => { if (res.ok) setRows(res.calls); }); }, []);
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Calls" onBack={b.back} />
      <div className="space-y-3 overflow-y-auto px-4 py-4">
        <p className="text-sm text-muted">One-to-one voice and video use a direct browser connection. Group calls are not in this version — there is no media relay, and a fake button would be worse than an honest limit.</p>
        {rows.length === 0 ? <Empty title="No calls yet" body="Open a friend and start a voice or video call while you're both online." /> : null}
        {rows.map((c) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-line py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{c.peerName}</div>
              <div className="text-xs text-muted">{c.direction === "out" ? "Outgoing" : "Incoming"} · {c.kind} · {c.status} · {when(c.createdAt)}</div>
            </div>
            <IconBtn label="Call back" onClick={() => void placeCall(b, c.peerId, c.peerName, c.kind === "video" ? "video" : "voice")}><Phone className="size-5" /></IconBtn>
          </div>
        ))}
      </div>
    </div>
  );
}

async function placeCall(b: ReturnType<typeof useBanter>, userId: string, name: string, kind: "voice" | "video") {
  const res = await b.run(api.startCall({ data: { userId, kind } }));
  if (res && "callId" in res) b.nav({ name: "call", callId: res.callId, peerName: name, kind, role: "caller" });
}

function MeScreen() {
  const b = useBanter();
  const me = b.me!;
  return (
    <div className="h-full overflow-y-auto">
      <div className="wall-dusk px-5 pt-8 pb-6">
        <Avatar name={me.displayName} url={me.avatarUrl} className="size-20 text-2xl" />
        <h1 className="mt-4 font-display text-4xl">{me.displayName}</h1>
        <p className="text-sm text-apricot">{me.username ? `@${me.username}` : "Choose an ID"}</p>
        <p className="mt-2 max-w-sm text-sm text-muted">{me.bio}</p>
      </div>
      <div className="space-y-2 px-4 py-4">
        {me.username ? <QrCard username={me.username} /> : null}
        <Row label="Edit profile" onClick={() => b.nav({ name: "edit" })} />
        <Row label="Settings" onClick={() => b.nav({ name: "settings" })} />
        <Row label="Privacy" onClick={() => b.nav({ name: "privacy" })} />
        <Row label="Security" onClick={() => b.nav({ name: "security" })} />
        <Row label="Backups" onClick={() => b.nav({ name: "backup" })} />
        {me.role === "admin" ? <Row label="Moderation" onClick={() => b.nav({ name: "admin" })} /> : null}
        <p className="pt-2 text-xs text-muted">Joined {when(me.createdAt)}. Interests: {me.interests.join(", ") || "none yet"}.</p>
      </div>
    </div>
  );
}

function QrCard({ username }: { username: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/u/${username}`;
  useEffect(() => {
    let live = true;
    void import("qrcode").then(async (mod) => {
      const qr = mod as { toDataURL?: (text: string, opts: object) => Promise<string>; default?: { toDataURL: (text: string, opts: object) => Promise<string> } };
      const toDataURL = qr.toDataURL ?? qr.default?.toDataURL;
      if (!toDataURL) return;
      const data = await toDataURL(url, { margin: 1, width: 280, color: { dark: "#1C1614", light: "#FFFDFB" } });
      if (live) setSrc(data);
    });
    return () => { live = false; };
  }, [url]);
  return (
    <div className="rounded-3xl bg-elev p-4">
      <div className="flex items-center gap-4">
        {src ? <img src={src} alt={`QR code for @${username}`} className="size-28 rounded-2xl" /> : <div className="size-28 rounded-2xl bg-sunken" />}
        <div>
          <div className="font-medium">Your Banter ID</div>
          <div className="text-sm text-apricot">@{username}</div>
          <div className="mt-2 flex gap-2">
            <Btn tone="quiet" className="px-3" onClick={() => void navigator.clipboard.writeText(`@${username}`)}>Copy ID</Btn>
            <Btn tone="quiet" className="px-3" onClick={() => void shareLink(url, `@${username}`)}>Share</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditProfile() {
  const b = useBanter();
  const me = b.me!;
  const [form, setForm] = useState({
    displayName: me.displayName,
    username: me.username ?? "",
    bio: me.bio,
    about: me.about,
    hobbies: me.hobbies,
    location: me.location,
    birthday: me.birthday ?? "",
    interests: me.interests,
  });
  const [available, setAvailable] = useState<boolean | null>(null);
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title="Edit profile" onBack={b.back} />
      <form className="space-y-3 px-4 py-4" onSubmit={(e) => {
        e.preventDefault();
        void b.run(api.updateProfile({ data: { ...form, birthday: form.birthday || null } })).then(async (res) => {
          if (res && "me" in res) {
            await b.refresh();
            b.back();
          }
        });
      }}>
        <Field label="Photo">
          <input type="file" accept="image/*" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (!b.me) return;
            void uploadUserMedia("banter-avatars", b.me.userId, file, 5 * 1024 * 1024)
              .then((path) => requireSupabase().storage.from("banter-avatars").getPublicUrl(path).data.publicUrl)
              .then((avatarUrl) => b.run(api.updateProfile({ data: { avatarUrl } })))
              .then((res) => { if (res) void b.refresh(); })
              .catch((err) => b.toastMsg(err instanceof Error ? err.message : "Could not use that photo."));
          }} />
        </Field>
        <Field label="Name"><input className={inputClass} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
        <Field label="Banter ID">
          <input className={inputClass} value={form.username} onChange={(e) => { setForm({ ...form, username: e.target.value }); setAvailable(null); }} />
        </Field>
        <Btn type="button" tone="quiet" onClick={() => void api.checkUsername({ data: { username: form.username } }).then((res) => setAvailable(res.available))}>Check availability</Btn>
        {available != null ? <p className="text-sm text-muted">{available ? "Available." : "Not available."}</p> : null}
        <Field label="Bio"><textarea className={inputClass} maxLength={160} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
        <Field label="About"><textarea className={inputClass} maxLength={600} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} /></Field>
        <Field label="Hobbies"><input className={inputClass} value={form.hobbies} onChange={(e) => setForm({ ...form, hobbies: e.target.value })} /></Field>
        <Field label="Location"><input className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
        <Field label="Birthday"><input className={inputClass} placeholder="1998-04-12" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((interest) => {
            const on = form.interests.includes(interest);
            return <button type="button" key={interest} className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-clay text-on-clay" : "bg-sunken text-muted"}`} onClick={() => setForm({ ...form, interests: on ? form.interests.filter((i) => i !== interest) : [...form.interests, interest].slice(0, 8) })}>{interest}</button>;
          })}
        </div>
        <Field label="Social link label"><input className={inputClass} id="soc-label" placeholder="Portfolio" /></Field>
        <Field label="https link"><input className={inputClass} id="soc-url" placeholder="https://" /></Field>
        <Btn type="button" tone="quiet" onClick={() => {
          const label = (document.getElementById("soc-label") as HTMLInputElement | null)?.value ?? "";
          const url = (document.getElementById("soc-url") as HTMLInputElement | null)?.value ?? "";
          void b.run(api.updateProfile({ data: { socials: [...me.socials, { label, url }].slice(0, 3) } }));
        }}>Save social link</Btn>
        <Btn type="submit" className="w-full">Save profile</Btn>
      </form>
    </div>
  );
}

function Settings() {
  const b = useBanter();
  const me = b.me!;
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title="Settings" onBack={b.back} />
      <div className="space-y-2 px-4 py-4">
        <div className="rounded-3xl bg-elev p-3"><UserButton /></div>
        <Row label={me.theme === "light" ? "Use dark theme" : "Use light theme"} onClick={() => void b.run(api.updateProfile({ data: { theme: me.theme === "light" ? "dark" : "light" } })).then(() => b.refresh())} />
        <Row label="Notification controls" onClick={() => b.nav({ name: "notifications" })} />
        <Row label="Privacy" onClick={() => b.nav({ name: "privacy" })} />
        <Row label="Security" onClick={() => b.nav({ name: "security" })} />
        <Row label="Backups" onClick={() => b.nav({ name: "backup" })} />
        <Row label="Deactivate account" onClick={() => void b.run(api.setAccountStatus({ data: { status: "deactivated" } })).then(() => b.refresh())} />
        <Btn tone="danger" className="w-full" onClick={() => {
          if (window.confirm("Delete your Banter profile, friends, and message contents? Your Google, X, or email sign-in remains. Signing in again can start a new profile.")) {
            void b.run(api.deleteAccount()).then(() => signOut("/"));
          }
        }}>Delete Banter account</Btn>
        <p className="text-xs text-muted">Sign-in email: {me.email || "Managed by your provider"}. Banter does not add a second unverified address.</p>
      </div>
    </div>
  );
}

function Privacy() {
  const b = useBanter();
  const me = b.me!;
  const choice = ["everyone", "friends", "nobody"] as const;
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title="Privacy" onBack={b.back} />
      <div className="space-y-4 px-4 py-4 text-sm">
        <p className="text-muted">Your sign-in email is never shown on your profile. Banter does not collect phone numbers, so nobody can be found that way.</p>
        <Field label="Who can find your Banter ID">
          <select className={inputClass} value={me.discoverability} onChange={(e) => void b.run(api.updateProfile({ data: { discoverability: e.target.value as typeof choice[number] } })).then(() => b.refresh())}>
            {choice.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Last seen">
          <select className={inputClass} value={me.lastSeenVisibility} onChange={(e) => void b.run(api.updateProfile({ data: { lastSeenVisibility: e.target.value as typeof choice[number] } })).then(() => b.refresh())}>
            {choice.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Toggle label="Show online" on={me.showOnline} onChange={(showOnline) => void b.run(api.updateProfile({ data: { showOnline } })).then(() => b.refresh())} />
        <Toggle label="Send read receipts" on={me.readReceipts} onChange={(readReceipts) => void b.run(api.updateProfile({ data: { readReceipts } })).then(() => b.refresh())} />
      </div>
    </div>
  );
}

function Notices() {
  const b = useBanter();
  const me = b.me!;
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title="Notices" onBack={b.back} right={<button type="button" className="text-sm text-apricot" onClick={() => void b.run(api.markNotices({ data: {} })).then(() => b.refresh())}>Mark read</button>} />
      <div className="space-y-3 px-4 py-3">
        <Toggle label="Message notices" on={me.notifyMessages} onChange={(notifyMessages) => void b.run(api.updateProfile({ data: { notifyMessages } })).then(() => b.refresh())} />
        <Toggle label="Friend notices" on={me.notifyFriends} onChange={(notifyFriends) => void b.run(api.updateProfile({ data: { notifyFriends } })).then(() => b.refresh())} />
        <Toggle label="Story notices" on={me.notifyStories} onChange={(notifyStories) => void b.run(api.updateProfile({ data: { notifyStories } })).then(() => b.refresh())} />
        <p className="text-xs text-muted">These are in-app notices. Banter does not send phone push notifications in this version.</p>
        {b.notices.map((n) => (
          <button key={n.id} type="button" className="block w-full rounded-2xl bg-elev px-3 py-3 text-left" onClick={() => {
            void api.markNotices({ data: { id: n.id } });
            openHref(b, n.href);
          }}>
            <div className="font-medium">{n.title}</div>
            <div className="text-sm text-muted">{n.body}</div>
            <div className="text-[11px] text-muted">{when(n.createdAt)}{n.read ? "" : " · New"}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Security() {
  const b = useBanter();
  const [sessions, setSessions] = useState<{ id: string; userAgent: string | null; ip: string | null; updatedAt: string | null }[]>([]);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  useEffect(() => { void api.listSessions().then((res) => { if (res.ok) setSessions(res.sessions); }); }, []);
  return (
    <div className="h-full overflow-y-auto px-4 py-2">
      <TopBar title="Security" onBack={b.back} />
      <div className="space-y-3 py-4 text-sm leading-relaxed text-muted">
        <p className="flex items-start gap-2 text-fg"><Shield className="mt-0.5 size-4 text-clay" /> Chats are private to members. They travel over HTTPS and are stored so Banter can deliver them.</p>
        <p>They are <span className="text-fg">not end-to-end encrypted</span>. Banter does not pretend otherwise. A sealed archive you download is encrypted on this device with AES-256-GCM — that lock does not cover live chats.</p>
        <p>Passwords, if you use email sign-in, are stored by the account system as a hash, never as plain text. Google and X sign-in never gives Banter your password.</p>
        <h2 className="pt-2 font-medium text-fg">Devices</h2>
        {sessions.map((s) => <p key={s.id} className="rounded-2xl bg-elev px-3 py-2 text-xs">{s.userAgent || "Device"} · {s.ip || "IP hidden"} · {when(s.updatedAt)}</p>)}
        <Btn tone="danger" onClick={() => void b.run(api.signOutAll()).then(() => signOut("/"))}>Sign out of all devices</Btn>
        <h2 className="pt-2 font-medium text-fg">Change email password</h2>
        <input className={inputClass} type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className={inputClass} type="password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} />
        <Btn tone="quiet" onClick={() => void import("@/lib/auth/client").then(async ({ authClient }) => {
          const res = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
          b.toastMsg(res.error ? res.error.message || "Could not change password." : "Password updated.");
        })}>Update password</Btn>
      </div>
    </div>
  );
}

function Backup() {
  const b = useBanter();
  const [pass, setPass] = useState("");
  const [includeMedia, setIncludeMedia] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title="Backups" onBack={b.back} />
      <div className="space-y-3 px-4 py-4 text-sm text-muted">
        <p>Google Drive is not connected to Banter. Nothing has been written to your Drive. When a Drive connection exists, Banter would ask you to sign in with Google and request only permission to files it creates — never your Google password — then make BANTER/Chat Backups, Media Backups, Profile Backups, and Exported Conversations.</p>
        <p>Until then, download an archive and put it in Drive yourself if you want it there.</p>
        <Toggle label="Include up to 20 recent photos or voice notes" on={includeMedia} onChange={setIncludeMedia} />
        <Field label="Archive passphrase"><input className={inputClass} type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></Field>
        <Btn onClick={() => void (async () => {
          const res = await b.run(api.exportArchive({ data: { includeMedia } }));
          if (!res || !("archive" in res)) return;
          try {
            const blob = await encryptArchive(JSON.stringify(res.archive), pass);
            downloadBlob(blob, `banter-backup-${new Date().toISOString().slice(0, 10)}.banter`);
            b.toastMsg("Encrypted archive downloaded. Banter never saw this passphrase.");
          } catch (err) {
            b.toastMsg(err instanceof Error ? err.message : "Could not encrypt.");
          }
        })()}>Download encrypted archive</Btn>
        <Btn tone="quiet" onClick={() => void b.run(api.exportArchive({ data: { includeMedia: false } })).then((res) => {
          if (!res || !("archive" in res)) return;
          downloadBlob(new Blob([JSON.stringify(res.archive, null, 2)], { type: "application/json" }), "banter-export.json");
        })}>Download plain text export</Btn>
        <Field label="Restore an encrypted archive">
          <input type="file" accept=".banter,application/octet-stream" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file.arrayBuffer().then((buf) => decryptArchive(buf, pass)).then((text) => {
              const parsed = JSON.parse(text) as { messages?: unknown[] };
              setPreview(`Unlocked ${parsed.messages?.length ?? 0} messages on this device. They were not uploaded back to Banter.`);
            }).catch((err) => b.toastMsg(err instanceof Error ? err.message : "Could not unlock."));
          }} />
        </Field>
        {preview ? <p className="text-fg">{preview}</p> : null}
        <p>The download is encrypted here with AES-256-GCM and PBKDF2. The plain export is not encrypted. Live chats on the server are not end-to-end encrypted.</p>
      </div>
    </div>
  );
}

function Admin() {
  const b = useBanter();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminOverview>> | null>(null);
  async function load() {
    const res = await api.adminOverview();
    setData(res);
  }
  useEffect(() => { void load(); }, []);
  if (!data) return <p className="p-6 text-sm text-muted">Loading moderation…</p>;
  if (!data.ok) return <div className="p-6"><TopBar title="Moderation" onBack={b.back} /><p className="mt-4 text-sm">{data.error}</p></div>;
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title="Moderation" subtitle="No message contents" onBack={b.back} />
      <div className="grid grid-cols-2 gap-2 px-4 py-4 text-sm">
        <Stat label="People" value={data.stats.people} />
        <Stat label="Messages today" value={data.stats.messagesDay} />
        <Stat label="Active today" value={data.stats.activeDay} />
        <Stat label="Open reports" value={data.stats.openReports} />
      </div>
      <div className="space-y-3 px-4 pb-8">
        <Section title="Reports">
          {data.reports.map((r) => (
            <div key={r.id} className="rounded-2xl bg-elev p-3 text-sm">
              <div>{r.reason} · @{r.target || "unknown"}</div>
              <p className="text-muted">{r.details}</p>
              <p className="text-xs text-muted">From @{r.reporter} · {r.status}</p>
              {r.status === "open" ? <Btn tone="quiet" className="mt-2" onClick={() => void b.run(api.adminAct({ data: { action: "dismiss-report", reportId: r.id } })).then(load)}>Dismiss</Btn> : null}
            </div>
          ))}
        </Section>
        <Section title="Accounts">
          {data.users.map((u) => (
            <div key={u.userId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>@{u.username || "…"} · {u.status}</span>
              {u.role !== "admin" && u.userId !== b.me?.userId ? (
                <Btn tone={u.status === "suspended" ? "quiet" : "danger"} className="px-3" onClick={() => void b.run(api.adminAct({ data: { action: u.status === "suspended" ? "restore" : "suspend", userId: u.userId } })).then(load)}>
                  {u.status === "suspended" ? "Restore" : "Suspend"}
                </Btn>
              ) : null}
            </div>
          ))}
        </Section>
        <Section title="Appeals">
          {data.appeals.map((a) => (
            <div key={a.id} className="rounded-2xl bg-elev p-3 text-sm">
              <div>@{a.username}</div>
              <p>{a.body}</p>
              <Btn tone="quiet" className="mt-2" onClick={() => void b.run(api.adminAct({ data: { action: "close-appeal", appealId: a.id } })).then(load)}>Close</Btn>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}

function GroupInfo({ id }: { id: string }) {
  const b = useBanter();
  const thread = b.thread?.conversation?.id === id ? b.thread : null;
  const chat = b.chats.find((c) => c.id === id);
  const [title, setTitle] = useState(thread?.conversation?.title || chat?.title || "");
  if (!thread?.conversation && !chat) return <p className="p-6 text-sm text-muted">Loading…</p>;
  const conv = thread?.conversation;
  const media = thread?.messages.filter((m) => m.hasMedia && !m.deleted) ?? [];
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title={conv?.kind === "group" ? "Group" : "Conversation"} onBack={b.back} />
      <div className="space-y-3 px-4 py-4">
        {conv?.kind === "group" ? (
          <>
            <Field label="Name"><input className={inputClass} value={title || ""} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Btn onClick={() => void b.run(api.groupAction({ data: { conversationId: id, action: "rename", title } })).then(() => b.refresh())}>Save name</Btn>
            <Btn tone="quiet" onClick={() => void inviteFriend(b, id)}>Invite link</Btn>
          </>
        ) : null}
        <Field label="Wallpaper">
          <div className="flex gap-2">
            {["ink", "paper", "clay", "sage", "dusk"].map((w) => (
              <button key={w} type="button" className={`wall-${w} size-10 rounded-full ring-1 ring-line`} onClick={() => void b.run(api.groupAction({ data: { conversationId: id, action: "wallpaper", wallpaper: w as "ink" } })).then(() => b.refresh())} aria-label={w} />
            ))}
          </div>
        </Field>
        <Field label="Disappearing messages">
          <select className={inputClass} value={String(conv?.disappearingSeconds ?? "")} onChange={(e) => {
            const seconds = e.target.value === "" ? null : Number(e.target.value);
            void b.run(api.groupAction({ data: { conversationId: id, action: "disappearing", seconds } })).then(() => b.refresh());
          }}>
            <option value="">Off</option>
            <option value="3600">1 hour</option>
            <option value="86400">1 day</option>
            <option value="604800">7 days</option>
          </select>
        </Field>
        <Btn tone="quiet" onClick={() => void b.run(api.groupAction({ data: { conversationId: id, action: "mute", muted: !chat?.muted } })).then(() => b.refresh())}>{chat?.muted ? "Unmute" : "Mute"}</Btn>
        <Btn tone="quiet" onClick={() => void b.run(api.groupAction({ data: { conversationId: id, action: "archive", archived: !chat?.archived } })).then(() => { b.back(); return b.refresh(); })}>
          <Archive className="size-4" /> {chat?.archived ? "Unarchive" : "Archive"}
        </Btn>
        <Section title="People">
          {thread?.members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between py-1 text-sm">
              <button type="button" onClick={() => b.nav({ name: "user", id: m.userId })}>{m.displayName} {m.role === "admin" ? "· admin" : ""}</button>
              {conv?.myRole === "admin" && m.userId !== b.me?.userId ? (
                <button type="button" className="text-danger" onClick={() => void b.run(api.groupAction({ data: { conversationId: id, action: "remove", userId: m.userId } })).then(() => b.refresh())}>Remove</button>
              ) : null}
            </div>
          ))}
        </Section>
        <Section title="Media">
          <div className="grid grid-cols-3 gap-2">
            {media.map((m) => <Attachment key={m.id} id={m.id} kind={m.kind} mime={m.mime} name={m.fileName} />)}
          </div>
          {media.length === 0 ? <p className="text-sm text-muted">No photos or notes yet.</p> : null}
        </Section>
        <Section title="Starred here">
          {(thread?.messages.filter((m) => m.starred) ?? []).map((m) => <p key={m.id} className="text-sm">{m.body || m.kind}</p>)}
        </Section>
        <Btn tone="ghost" onClick={() => void report(undefined, id)}>Report</Btn>
        <Btn tone="danger" onClick={() => void b.run(api.groupAction({ data: { conversationId: id, action: "leave" } })).then(() => { b.tab("inbox"); return b.refresh(); })}>Leave</Btn>
      </div>
    </div>
  );
}

function NewGroup() {
  const b = useBanter();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <div className="h-full overflow-y-auto">
      <TopBar title="New group" onBack={b.back} />
      <div className="space-y-3 px-4 py-4">
        <Field label="Group name"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {(b.people?.friends ?? []).map((p) => (
          <label key={p.userId} className="flex items-center gap-3 py-1">
            <input type="checkbox" checked={picked.includes(p.userId)} onChange={() => setPicked((ids) => ids.includes(p.userId) ? ids.filter((id) => id !== p.userId) : [...ids, p.userId])} />
            <span>{p.displayName}</span>
          </label>
        ))}
        <Btn onClick={() => void b.run(api.createGroup({ data: { title, memberIds: picked } })).then((res) => {
          if (res && "conversationId" in res) b.nav({ name: "thread", id: res.conversationId });
        })}>Create group</Btn>
      </div>
    </div>
  );
}

function SearchScreen() {
  const b = useBanter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; conversationId: string; body: string; createdAt: string | null }[]>([]);
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Search messages" onBack={b.back} />
      <form className="px-4 py-3" onSubmit={(e) => {
        e.preventDefault();
        void b.run(api.searchMessages({ data: { q } })).then((res) => { if (res && "hits" in res) setHits(res.hits); });
      }}>
        <input className={inputClass} placeholder="At least 2 letters" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <div className="overflow-y-auto px-4">
        {hits.map((h) => (
          <button key={h.id} type="button" className="block w-full border-b border-line py-3 text-left" onClick={() => b.nav({ name: "thread", id: h.conversationId })}>
            <div className="text-sm">{h.body}</div>
            <div className="text-xs text-muted">{when(h.createdAt)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Onboarding({ me }: { me: Me }) {
  const b = useBanter();
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(me.displayName === "New member" ? "" : me.displayName);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [about, setAbout] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col bg-bg px-5 py-8 text-fg">
      <Mark />
      <p className="mt-6 text-xs tracking-wide text-apricot uppercase">Step {step + 1} of 3</p>
      {step === 0 ? (
        <div className="mt-3 space-y-3">
          <h1 className="font-display text-4xl">What should people call you?</h1>
          <Field label="Name"><input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
          <Field label="Banter ID"><input className={inputClass} placeholder="arjun25" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <p className="text-sm text-muted">This is public, like @name. Your email stays private. You can change it later, once every 14 days.</p>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="mt-3 space-y-3">
          <h1 className="font-display text-4xl">A little context.</h1>
          <Field label="Bio"><textarea className={inputClass} maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
          <Field label="About"><textarea className={inputClass} maxLength={600} value={about} onChange={(e) => setAbout(e.target.value)} /></Field>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="mt-3">
          <h1 className="font-display text-4xl">What do you care about?</h1>
          <div className="mt-4 flex flex-wrap gap-2">
            {INTERESTS.map((interest) => {
              const on = interests.includes(interest);
              return <button type="button" key={interest} className={`rounded-full px-3 py-2 text-sm ${on ? "bg-clay text-on-clay" : "bg-elev text-muted"}`} onClick={() => setInterests((list) => on ? list.filter((i) => i !== interest) : [...list, interest].slice(0, 8))}>{interest}</button>;
            })}
          </div>
        </div>
      ) : null}
      {note ? <p className="mt-3 text-sm text-danger">{note}</p> : null}
      <div className="mt-auto flex gap-2 pt-8">
        {step > 0 ? <Btn tone="ghost" onClick={() => setStep(step - 1)}>Back</Btn> : null}
        <Btn className="flex-1" onClick={() => void next()}>{step === 2 ? "Enter Banter" : "Continue"}</Btn>
      </div>
    </main>
  );
  async function next() {
    setNote(null);
    if (step === 0) {
      const check = await api.checkUsername({ data: { username } });
      if (!check.username || !check.available) {
        setNote("Pick a Banter ID that's free: 3–20 letters, numbers, or underscores.");
        return;
      }
      if (!displayName.trim()) { setNote("Add your name."); return; }
      setStep(1);
      return;
    }
    if (step === 1) { setStep(2); return; }
    const res = await b.run(api.completeOnboarding({ data: { displayName, username, bio, about, interests } }));
    if (res) await b.refresh();
  }
}

function Suspended() {
  const b = useBanter();
  const [body, setBody] = useState("");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-4xl">This account is suspended.</h1>
      <p className="text-sm text-muted">You can appeal. Moderators do not read your private messages from this screen.</p>
      <textarea className={inputClass} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should we know?" />
      <Btn onClick={() => void b.run(api.appeal({ data: { body } })).then((res) => { if (res) b.toastMsg("Appeal sent."); })}>Send appeal</Btn>
      <Btn tone="ghost" onClick={() => void signOut("/")}>Sign out</Btn>
    </main>
  );
}

function Deactivated() {
  const b = useBanter();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-4xl">Banter is paused.</h1>
      <p className="text-sm text-muted">Your profile is hidden. Reactivate whenever you want the conversations back.</p>
      <Btn onClick={() => void b.run(api.setAccountStatus({ data: { status: "active" } })).then(() => b.refresh())}>Reactivate</Btn>
    </main>
  );
}

function Tombstone() {
  const b = useBanter();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-4xl">This Banter profile was deleted.</h1>
      <p className="text-sm text-muted">Your sign-in still exists. Starting over creates a new profile. Old chats are not restored.</p>
      <Btn onClick={() => void b.run(api.startOver()).then(() => b.refresh())}>Start a new profile</Btn>
      <Btn tone="ghost" onClick={() => void signOut("/")}>Sign out</Btn>
    </main>
  );
}

function Row({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="flex min-h-12 w-full items-center justify-between rounded-2xl bg-elev px-4 text-left" onClick={onClick}><span>{label}</span><span className="text-muted">›</span></button>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2 className="mb-1 text-xs tracking-wide text-muted uppercase">{title}</h2>{children}</section>;
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="flex min-h-12 w-full items-center justify-between rounded-2xl bg-elev px-4" onClick={() => onChange(!on)}>
      <span className="text-sm">{label}</span>
      <span className={`h-6 w-11 rounded-full p-0.5 ${on ? "bg-clay" : "bg-sunken"}`}><span className={`block size-5 rounded-full bg-elev transition ${on ? "translate-x-5" : ""}`} /></span>
    </button>
  );
}

function IconBtn({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return <button type="button" aria-label={label} className="grid size-11 place-items-center rounded-2xl" onClick={onClick}>{children}</button>;
}

function Banner({ label, body, onClear }: { label: string; body: string; onClear: () => void }) {
  return (
    <div className="mx-3 flex items-center justify-between rounded-2xl bg-elev px-3 py-2 text-sm">
      <span className="truncate"><span className="text-apricot">{label}.</span> {body}</span>
      <button type="button" onClick={onClear} aria-label="Clear">×</button>
    </div>
  );
}

function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-elev p-4 pb-8" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-elev p-3"><div className="font-display text-3xl tabular-nums">{value}</div><div className="text-xs text-muted">{label}</div></div>;
}

function openHref(b: ReturnType<typeof useBanter>, href: string) {
  const [kind, id] = href.split(":");
  if (kind === "thread" && id) b.nav({ name: "thread", id });
  else if (kind === "user" && id) b.nav({ name: "user", id });
  else if (kind === "story" && id) b.nav({ name: "story", id });
  else b.tab("calls");
}

async function inviteFriend(b: ReturnType<typeof useBanter>, conversationId?: string) {
  const res = await b.run(api.createInvite({ data: { conversationId } }));
  if (!res || !("code" in res)) return;
  const url = `${window.location.origin}/join/${res.code}`;
  await shareLink(url, "Join me on Banter");
  b.toastMsg("Invite link ready. It expires in 7 days.");
}

async function shareLink(url: string, title: string) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
  }
  await navigator.clipboard.writeText(url);
}

async function report(userId?: string, conversationId?: string) {
  const reason = window.prompt("Why are you reporting this? Spam, abuse, or something else.");
  if (!reason) return;
  const { reportPerson } = await import("@/lib/banter/api");
  const res = await reportPerson({ data: { userId, conversationId, reason } });
  if (!res.ok) window.alert(res.error);
}

function Forwarder() { return null; }
