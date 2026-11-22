# BANTER Supabase migration status

This file tracks the migration from the original TanStack Start + Better Auth server API to Supabase Auth, Postgres/RLS, Storage, Realtime, and Edge Functions.

## Current verified state

- Supabase project: `lldfnrowwomejmxwfdqf` (Mumbai region).
- Public schema: 24 application tables.
- RLS policies exist on the application tables.
- Edge Function `banter-api` is deployed with JWT verification enabled.
- The deployed Edge Function source is stored at `supabase/functions/banter-api/index.ts`.
- The deployed Edge Function is at version 4 with JWT verification enabled.
- Implemented Edge Function actions: `get_me`, `check_username`, `complete_onboarding`, `update_profile`, `set_account_status`, `appeal`, `search_people`, `get_profile`, `load_people`, `friend_action`, `report_person`, `mark_notices`, `pulse_typing`, `post_story`, `stories_for`, `story_media`, `react_story`, `delete_story`, `start_call`, `call_action`, `poll_call`, `post_signal`, `call_log`.
- The matching browser API exports now invoke the Supabase Edge Function for those 23 operations.
- This is a migration-in-progress, not release-ready: multi-user authorization, edge cases, rate limits, notifications, and response parity still need verification. In particular, block visibility and cross-user notification delivery need a secure database-side implementation.
- 18 original server operations remain on the old server path and are listed below.
- The current Android workflow is only a remote-URL wrapper and is not a standalone app bundle. Do not use it as the release APK workflow.

## Remaining server operations

- [ ] `deleteAccount`
- [ ] `startOver`
- [ ] `createInvite`
- [ ] `redeemInvite`
- [ ] `revokeInvite`
- [ ] `openDirect`
- [ ] `createGroup`
- [ ] `groupAction`
- [ ] `sendMessage`
- [ ] `messageAction`
- [ ] `getAttachment`
- [ ] `searchMessages`
- [ ] `sync`
- [ ] `listSessions`
- [ ] `signOutAll`
- [ ] `exportArchive`
- [ ] `adminOverview`
- [ ] `adminAct`

## Required release gates

1. Migrate and test every operation, preserving authorization, validation, rate limits, and response shapes.
2. Replace Better Auth with Supabase Auth throughout sign-in, sign-up, session restore, and sign-out.
3. Verify all table and Storage RLS policies against multi-user scenarios.
4. Remove server-only imports and build a static web bundle for GitHub Pages.
5. Configure Capacitor to bundle the generated local assets (no `server.url`).
6. Build a debug APK with GitHub Actions and install/test it on Android before calling it ready.
