import type { ButtonHTMLAttributes, ReactNode } from "react";

export function when(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function Avatar({
  name,
  url,
  online,
  className = "size-11",
}: {
  name: string;
  url?: string | null;
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={`relative grid ${className} shrink-0 place-items-center overflow-hidden rounded-2xl bg-sunken font-medium text-clay`}>
      {url ? <img src={url} alt="" className="size-full object-cover" /> : (name.trim()[0] || "?").toUpperCase()}
      {online ? <span className="absolute right-0.5 bottom-0.5 size-2.5 rounded-full bg-sage ring-2 ring-elev" /> : null}
    </span>
  );
}

export function Btn({
  tone = "clay",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "clay" | "ghost" | "quiet" | "danger" }) {
  const toneClass =
    tone === "clay"
      ? "bg-clay text-on-clay"
      : tone === "danger"
        ? "bg-danger text-on-clay"
        : tone === "quiet"
          ? "bg-sunken text-fg"
          : "border border-line bg-transparent text-fg";
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium transition active:scale-[0.98] disabled:opacity-50 ${toneClass} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-line bg-sunken px-3.5 py-3 text-base text-fg outline-none placeholder:text-muted focus:border-clay";

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rise flex flex-1 flex-col items-center justify-center px-8 text-center">
      <h2 className="font-display text-3xl text-fg">{title}</h2>
      <p className="mt-2 max-w-xs text-sm text-muted">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
      {onBack ? (
        <button type="button" onClick={onBack} className="grid size-11 place-items-center rounded-2xl text-fg" aria-label="Back">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {subtitle ? <div className="truncate text-xs text-muted">{subtitle}</div> : null}
      </div>
      {right}
    </header>
  );
}
