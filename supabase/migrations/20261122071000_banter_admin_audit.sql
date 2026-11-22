create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id text not null,
  target_user_id text,
  action text not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated, public;
grant all on public.admin_audit_log to service_role;
