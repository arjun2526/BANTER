# BANTER Supabase migration status

This file tracks the migration from the original TanStack Start + Better Auth server API to Supabase Auth, Postgres/RLS, Storage, Realtime, and Edge Functions.

## Current verified state

- Supabase project: `lldfnrowwomejmxwfdqf` (Mumbai region).
- 24 application tables have RLS enabled; security advisor currently reports no findings.
- Edge Function `banter-api` is deployed at version 16 with JWT verification enabled.
- The Edge Function implements 39 action handlers covering the former server API operations.
- `src/lib/banter/api.ts` now exposes all 41 original API exports without `createServerFn`; 39 call the Edge Function and the two session operations use Supabase Auth directly.
- The API module no longer imports the old SQL/Better Auth server stack; the obsolete `/api/auth/*` route has been deleted.
- Vite is now configured for TanStack Start SPA mode, with a configurable base path for GitHub Pages and local Capacitor assets. The old Vercel Nitro preset and local PGlite bootstrap were removed from the Vite config.
- GitHub Pages now builds the app source instead of publishing the old `docs` preview. The Android workflow now builds from local web assets and no longer sets `server.url`.
- Database-only security-definer routines are in the non-exposed `private` schema, called through authenticated invoker wrappers in `public`.
- Important parity limitations remain: session listing currently shows only this device (not every active session); cross-user notifications now use a protected database helper for core friend, message, story, and call events; reverse-block checks use a protected database helper; group-admin pinning of another member's message is not yet supported; and media still needs migration from base64 message fields to the configured Storage buckets.
- The migration has not passed end-to-end multi-user tests. A deployed action is not automatically considered feature-complete until it is tested.

## Remaining original server operations

- None are still exported as TanStack `createServerFn` calls. The old Better Auth route/server files and static-hosting configuration still need cleanup.

## Required release gates

1. Run a successful production build and resolve any generated route-tree or static-prerender issues.
2. Verify sign-up confirmation, sign-in, session restore, and global sign-out with real Supabase test accounts.
3. Test all Edge Function actions against at least two users, including blocked-user and group-membership cases.
4. Complete feature parity for cross-user notifications, reverse-block checks, group-admin message pinning, media Storage uploads, and full session listing.
5. Verify all table and Storage RLS policies against multi-user scenarios.
6. Confirm GitHub Pages serves the built app and all deep links correctly.
7. Build a debug APK with GitHub Actions from bundled local assets, then install and test it on Android before calling it ready.
