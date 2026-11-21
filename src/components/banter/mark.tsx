export function Mark({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="18" className="fill-clay" />
      <path
        d="M16 34.5c0-7.6 6.2-13.5 14.2-13.5h7.2c6.2 0 10.6 3.8 10.6 9.1 0 5.6-4.8 9.4-11 9.4h-5.2l-7.6 6.6v-6.4c-4.6-.9-8.2-3.4-8.2-5.2Z"
        className="fill-bg"
      />
      <circle cx="28" cy="30.5" r="2.1" className="fill-clay" />
      <circle cx="36" cy="30.5" r="2.1" className="fill-clay" />
      <circle cx="44" cy="30.5" r="2.1" className="fill-clay" />
    </svg>
  );
}

export function Wordmark({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-display text-2xl leading-none tracking-tight text-fg">Banter</div>
      {subtitle ? <p className="mt-1 text-sm text-muted">Every conversation has a story.</p> : null}
    </div>
  );
}
