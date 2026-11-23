export function Mark({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="BANTER">
      <defs>
        <linearGradient id="banter-mark-gradient" x1="7" y1="8" x2="57" y2="57" gradientUnits="userSpaceOnUse"><stop stopColor="#9a8cff"/><stop offset=".52" stopColor="#7777ff"/><stop offset="1" stopColor="#62e6d0"/></linearGradient>
        <linearGradient id="banter-mark-glow" x1="12" y1="9" x2="54" y2="57" gradientUnits="userSpaceOnUse"><stop stopColor="#fff" stopOpacity=".24"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="20" fill="#11182b" stroke="#ffffff" strokeOpacity=".12" strokeWidth="2"/>
      <path d="M12 27.5c0-9 7.3-16.2 16.3-16.2h10.1c8.6 0 15.4 6.3 15.4 14.3s-6.8 14.3-15.4 14.3h-6.1l-11.1 9.4v-10C15.5 37.3 12 33.5 12 27.5Z" fill="url(#banter-mark-gradient)"/>
      <path d="M12 27.5c0-9 7.3-16.2 16.3-16.2h10.1c8.6 0 15.4 6.3 15.4 14.3" fill="none" stroke="url(#banter-mark-glow)" strokeWidth="2"/>
      <circle cx="25" cy="27.5" r="2.5" fill="#11182b"/><circle cx="33" cy="27.5" r="2.5" fill="#11182b"/><circle cx="41" cy="27.5" r="2.5" fill="#11182b"/>
    </svg>
  );
}
export function Wordmark({ subtitle = true }: { subtitle?: boolean }) {
  return <div className="min-w-0"><div className="font-display text-2xl leading-none tracking-tight text-fg">BANTER</div>{subtitle ? <p className="mt-1 text-sm text-muted">Every conversation has a story.</p> : null}</div>;
}