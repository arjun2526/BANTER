# BANTER Supabase migration status

This file tracks the migration from the original TanStack Start + Better Auth server API to Supabase Auth, Postgres/RLS, Storage, Realtime, and Edge Functions.

## Current verified state

- Supabase project: `lldfnrowwomejmxwfdqf` (Mumbai region).
- 24 application tables have RLS enabled; security advisor currently reports no findings.
- Edge Function `banter-api` is deployed at version 14 with JWT verification enabled.
- The Edge Function implements 39 action handlers covering the former server API operations.
- `src/lib/banter/api.ts` now exposes all 41 original API exports without `createServerFn`; 39 call the Edge Function and the two session operations use Supabase Auth directly.
- The API module no longer imports the old SQL/Better Auth server stack.
- Database-only security-definer routines are in the non-exposed `private` schema, called through authenticated invoker wrappers in `public`.
- Important parity limitations remain: session listing currently shows only this device (not every active session); cross-user notifications are not yet delivered by the new Edge Function; reverse-block visibility needs a secure helper; group-admin pinning of another member's message is not yet supported; and media still needs migration from base64 message fields to the configured Storage buckets.
- The migration has not passed end-to-end multi-user tests. A deployed action is not automatically considered feature-complete until it is tested.

## Remaining original server operations

- None are still exported as TanStack `createServerFn` calls. The old Better Auth route/server files and static-hosting configuration still need cleanup.

## Required release gates

1. Migrate and test every operation, preserving authorization, validation, rate limits, and response shapes.
2. Replace Better Auth with Supabase Auth throughout sign-in, sign-up, session restore, and sign-out.
3. Verify all table and Storage RLS policies against multi-user scenarios.
4. Remove server-only imports and build a static web bundle for GitHub Pages.
5. Configure Capacitor to bundle the generated local assets (no `server.url`).
6. Build a debug APK with GitHub Actions and install/test it on Android before calling it ready.
