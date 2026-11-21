-- Banter application schema. Identity lives in 0001_auth.sql.

create table if not exists profiles (
  user_id text primary key references "user" ("id") on delete cascade,
  username text,
  display_name text not null,
  bio text not null default '',
  about text not null default '',
  avatar_url text,
  birthday text,
  location text not null default '',
  interests text not null default '[]',
  hobbies text not null default '',
  socials text not null default '[]',
  discoverability text not null default 'everyone',
  last_seen_visibility text not null default 'everyone',
  show_online boolean not null default true,
  read_receipts boolean not null default true,
  theme text not null default 'dark',
  status text not null default 'active',
  role text not null default 'user',
  onboarding_complete boolean not null default false,
  notify_messages boolean not null default true,
  notify_friends boolean not null default true,
  notify_stories boolean not null default true,
  last_seen_at timestamptz not null default now(),
  username_changed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_idx on profiles (username);

create table if not exists account_tombstones (
  user_id text primary key,
  created_at timestamptz not null default now()
);

create table if not exists friend_requests (
  id text primary key,
  from_user_id text not null,
  to_user_id text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists friend_requests_pair_idx
  on friend_requests (from_user_id, to_user_id);

create index if not exists friend_requests_to_idx
  on friend_requests (to_user_id, status);

create table if not exists friendships (
  user_a text not null,
  user_b text not null,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b)
);

create table if not exists blocks (
  blocker_id text not null,
  blocked_id text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists conversations (
  id text primary key,
  kind text not null,
  title text,
  description text not null default '',
  created_by text not null,
  disappearing_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversation_members (
  conversation_id text not null references conversations (id) on delete cascade,
  user_id text not null,
  role text not null default 'member',
  muted boolean not null default false,
  archived boolean not null default false,
  wallpaper text not null default 'ink',
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on conversation_members (user_id);

create table if not exists direct_pairs (
  user_a text not null,
  user_b text not null,
  conversation_id text not null unique,
  primary key (user_a, user_b)
);

create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations (id) on delete cascade,
  sender_id text not null,
  body text not null default '',
  kind text not null default 'text',
  media_data text,
  media_mime text,
  media_name text,
  reply_to_id text,
  forwarded boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists messages_conv_created_idx
  on messages (conversation_id, created_at desc);

create table if not exists message_reactions (
  message_id text not null references messages (id) on delete cascade,
  user_id text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists message_stars (
  message_id text not null references messages (id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists message_hides (
  message_id text not null references messages (id) on delete cascade,
  user_id text not null,
  primary key (message_id, user_id)
);

create table if not exists typing (
  conversation_id text not null,
  user_id text not null,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists stories (
  id text primary key,
  user_id text not null,
  kind text not null,
  body text not null default '',
  media_data text,
  bg text not null default 'clay',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists stories_user_idx on stories (user_id, expires_at);

create table if not exists story_views (
  story_id text not null references stories (id) on delete cascade,
  viewer_id text not null,
  created_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create table if not exists story_reactions (
  story_id text not null references stories (id) on delete cascade,
  user_id text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create table if not exists invites (
  code text primary key,
  created_by text not null,
  conversation_id text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses integer not null default 20,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  user_id text not null,
  kind text not null,
  title text not null,
  body text not null default '',
  href text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on notifications (user_id, created_at desc);

create table if not exists reports (
  id text primary key,
  reporter_id text not null,
  target_user_id text,
  target_conversation_id text,
  reason text not null,
  details text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists appeals (
  id text primary key,
  user_id text not null,
  body text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists calls (
  id text primary key,
  conversation_id text,
  caller_id text not null,
  callee_id text not null,
  kind text not null,
  status text not null default 'ringing',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists calls_callee_idx on calls (callee_id, status);
create index if not exists calls_caller_idx on calls (caller_id, created_at desc);

create table if not exists call_signals (
  id bigserial primary key,
  call_id text not null,
  from_user_id text not null,
  payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists call_signals_call_idx on call_signals (call_id, id);

create table if not exists rate_events (
  user_id text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_events_idx on rate_events (user_id, action, created_at desc);

create table if not exists backup_records (
  id text primary key,
  user_id text not null,
  kind text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
