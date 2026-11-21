# BANTER

**Every conversation has a story.**

BANTER is an independent full-stack messaging application built with React, TypeScript, TanStack Start, Better Auth and PostgreSQL.

## Hosting overview

- **GitHub repository:** source code and version control (public, as selected).
- **GitHub Pages:** publishes the static project preview from `docs/` only.
- **Real application:** requires a server-capable host for TanStack Start server routes, authentication and PostgreSQL access.
- **Database:** PostgreSQL. Never connect to it directly from browser code.
- **Google Drive:** not integrated.

GitHub Pages is static hosting. It cannot run this app's server-side authentication, API routes or database code. GitHub also states Pages is not intended to host a SaaS service. Do not treat the Pages preview as the live messaging service.

## Phone deployment guide

See [PHONE-DEPLOY-GUIDE.md](./PHONE-DEPLOY-GUIDE.md) for Android/Termux upload steps and GitHub Pages setup.

## Full-stack application setup

Requirements:
- Node.js 20 or newer
- npm
- PostgreSQL for persistent deployment
- A deployment provider that supports the TanStack Start server output

Local development:

```bash
npm install
cp .env.example .env
npm run dev
```

Production environment variables:

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_URL` | Canonical public origin of the full-stack app |
| `BETTER_AUTH_SECRET` | Unique secret for Better Auth |
| `DATABASE_URL` | Persistent PostgreSQL connection string |

Never commit `.env`, database credentials or authentication secrets.

The current sign-in screen uses email/password. Mobile-number OTP authentication is not configured in this source package.

## Project commands

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

A successful static preview deployment does not prove that the full-stack authentication, messaging, media uploads or calls work. Test each feature against the actual server deployment before using real accounts or messages.
