import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth/client";
import { Mark, Wordmark } from "@/components/banter/mark";
import { Btn, Field, inputClass } from "@/components/banter/ui";

export function BootScreen({ label = "Opening Banter" }: { label?: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
      <div className="rise flex flex-col items-center gap-4 text-center">
        <Mark className="size-16" />
        <Wordmark />
        <p className="text-sm text-muted">{label}</p>
      </div>
    </main>
  );
}

export function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes("@") || password.length < 8) {
      setError("Use a real email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    const result =
      mode === "up"
        ? await authClient.signUp.email({
            email: email.trim(),
            password,
            name: email.split("@")[0] || "New member",
            callbackURL: "/",
          })
        : await authClient.signIn.email({
            email: email.trim(),
            password,
            callbackURL: "/",
          });
    setBusy(false);
    if (result.error) setError(result.error.message || "Could not sign in.");
  }

  return (
    <main className="grid min-h-dvh bg-bg text-fg md:grid-cols-2">
      <section className="wall-clay flex flex-col justify-between px-6 py-8 md:px-12">
        <div className="flex items-center gap-3">
          <Mark />
          <Wordmark subtitle={false} />
        </div>
        <div className="py-10">
          <p className="font-display text-4xl leading-tight text-fg md:text-6xl">
            Every conversation has a story.
          </p>
          <p className="mt-4 max-w-sm text-sm text-muted">
            Banter is a private place for friends — not a feed, not a broadcast. Say something worth keeping.
          </p>
        </div>
        <p className="text-xs text-muted">Your BANTER account is yours. Sign in securely with your email and password.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="font-display text-3xl">{mode === "up" ? "Create your place" : "Welcome back"}</h1>
          <form className="space-y-3" onSubmit={submit}>
            <Field label="Email">
              <input className={inputClass} autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <input className={inputClass} type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Btn type="submit" className="w-full" disabled={busy}>
              {busy ? "Working…" : mode === "up" ? "Create account" : "Sign in"}
            </Btn>
          </form>
          <button type="button" className="text-sm text-apricot" onClick={() => { setMode(mode === "up" ? "in" : "up"); setError(null); }}>
            {mode === "up" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </div>
      </section>
    </main>
  );
}
