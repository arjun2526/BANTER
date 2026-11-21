/**
 * BANTER's independent, self-hosted Better Auth server.
 *
 * Authentication runs on this application's own /api/auth/* endpoint.
 * Production deployments must set BETTER_AUTH_SECRET, BETTER_AUTH_URL and
 * DATABASE_URL. Local development can use the embedded PGLite fallback.
 *
 * Never import this module from browser code.
 */
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { pgliteDialect } from "./pglite-dialect";

void ensureDbReady();

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value || undefined;
};

const globalAuthRef = globalThis as typeof globalThis & {
  __banterAuthDevSecret__?: string;
};

function developmentSecret(): string {
  globalAuthRef.__banterAuthDevSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__banterAuthDevSecret__;
}

const databaseUrl = env("DATABASE_URL");
const configuredSecret = env("BETTER_AUTH_SECRET");
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !configuredSecret) {
  console.error("[BANTER] Missing BETTER_AUTH_SECRET. Set a stable secret before accepting production traffic.");
}
if (isProduction && !databaseUrl) {
  console.error("[BANTER] Missing DATABASE_URL. The in-memory development database is not suitable for production.");
}

const vercelUrl = env("VERCEL_URL");
const baseURL =
  env("BETTER_AUTH_URL") ??
  (vercelUrl ? `https://${vercelUrl}` : "http://localhost:8080");

const trustedOrigins = [
  baseURL,
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

const secureCookies = true;

export const SESSION_TOKEN_COOKIE = "__Host-banter.session_token";

export const auth = betterAuth({
  baseURL,
  secret: configuredSecret ?? developmentSecret(),
  database,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  session: {
    cookieCache: { enabled: true, maxAge: 300 },
  },
  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: {
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "__Host-banter.session_data" },
      account_data: { name: "__Host-banter.account_data" },
      dont_remember: { name: "__Host-banter.dont_remember" },
    },
  },
  plugins: [tanstackStartCookies()],
});
