# BANTER Supabase migration status

This file tracks the migration from the original TanStack Start + Better Auth server API to Supabase Auth, Postgres/RLS, Storage, Realtime, and Edge Functions.

## Current verified state

- Supabase project: `lldfnrowwomejmxwfdqf` (Mumbai region).
- Public schema: 24 application tables.
- RLS policies exist on the application tables.
- Edge Function `banter-api` is deployed with JWT verification enabled.
- The deployed Edge Function source is stored at `supabase/functions/banter-api/index.ts`.
- The Edge Function currently implements: `get_me`, `check_username`, `complete_onboarding`, `update_profile`.
- The original app still has 41 `createServerFn` operations. The 4 above are only partial equivalents; the other 37 operations below still need migration and parity testing.
- The current Android workflow is only a remote-URL wrapper and is not a standalone app bundle. Do not use it as the release APK workflow.

## Remaining server operations

- [ ] `setAccountStatus`
- [ ] `deleteAccount`
- [ ] `startOver`
- [ ] `appeal`
- [ ] `searchPeople`
- [ ] `loadPeople`
- [ ] `getProfile`
- [ ] `friendAction`
- [ ] `reportPerson`
- [ ] `createInvite`
- [ ] `redeemInvite`
- [ ] `revokeInvite`
- [ ] `openDirect`
- [ ] `createGroup`
- [ ] `groupAction`
- [ ] `sendMessage`
- [ ] `messageAction`
- [ ] `pulseTyping`
- [ ] `getAttachment`
- [ ] `searchMessages`
- [ ] `sync`
- [ ] `markNotices`
- [ ] `postStory`
- [ ] `storiesFor`
- [ ] `storyMedia`
- [ ] `reactStory`
- [ ] `deleteStory`
- [ ] `startCall`
- [ ] `callAction`
- [ ] `pollCall`
- [ ] `postSignal`
- [ ] `callLog`
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
