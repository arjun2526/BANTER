export function Mark({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="BANTER">
      <defs><linearGradient id="banter-mark-gradient" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stopColor="#8b83ff"/><stop offset="1" stopColor="#62dfcb"/></linearGradient></defs>
      <rect width="64" height="64" rx="19" fill="#121a2d"/>
      <path d="M13 28.5c0-9 7.3-16.2 16.3-16.2h8.5c8.5 0 15.2 6.2 15.2 14.2s-6.7 14.2-15.2 14.2h-6.2l-10.3 9v-10C16.3 37.3 13 33.5 13 28.5Z" fill="url(#banter-mark-gradient)"/>
      <circle cx="26" cy="28.5" r="2.4" fill="#10172a"/><circle cx="34" cy="28.5" r="2.4" fill="#10172a"/><circle cx="42" cy="28.5" r="2.4" fill="#10172a"/>
    </svg>
  );
}
export function Wordmark({ subtitle = true }: { subtitle?: boolean }) {
  return <div className="min-w-0"><div className="font-display text-2xl leading-none tracking-tight text-fg">BANTER</div>{subtitle ? <p className="mt-1 text-sm text-muted">Every conversation has a story.</p> : null}</div>;
}
