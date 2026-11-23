export function Mark({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="BANTER">
      <rect width="64" height="64" fill="#100e0d" />
      <rect x="8" y="8" width="48" height="48" rx="13" fill="#f36f35" />
      <path d="M16 31.8c0-7.1 6.1-12.5 14.1-12.5h7.8c7.8 0 13.1 4.7 13.1 11.1 0 6.5-5.4 11.2-13.2 11.2h-5.2l-7.4 6.5v-7c-5.5-1.5-9.2-4.7-9.2-9.3Z" fill="#100e0d" />
      <circle cx="28" cy="30.4" r="2.15" fill="#f36f35" />
      <circle cx="36" cy="30.4" r="2.15" fill="#f36f35" />
      <circle cx="44" cy="30.4" r="2.15" fill="#f36f35" />
    </svg>
  );
}

export function Wordmark({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-display text-2xl leading-none tracking-tight text-fg">BANTER</div>
      {subtitle ? <p className="mt-1 text-sm text-muted">Every conversation has a story.</p> : null}
    </div>
  );
}
