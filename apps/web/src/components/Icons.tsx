// Icons from the prototype (Lucide-style strokes).
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconVoice = () => (
  <svg {...base}><path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.4 18.4a9 9 0 0 0 0-12.8" /></svg>
);
export const IconBot = () => (
  <svg {...base}><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>
);
export const IconGear = () => (
  <svg {...base}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
);

/** Round-result icons (12×12 grid), white strokes inside colored cells. */
export const ReasonIcon = ({ reason }: { reason: 'elimination' | 'bomb' | 'defuse' | 'time' }) => {
  switch (reason) {
    case 'bomb': return <svg viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="7" r="3" /><path d="M8 4l1.5-1.5" /></svg>;
    case 'defuse': return <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.5l2.3 2.3L9.5 3.8" /></svg>;
    case 'time': return <svg viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="4" /><path d="M6 3.8V6l1.6 1" /></svg>;
    default: return <svg viewBox="0 0 12 12" aria-hidden><path d="M3 3l6 6M9 3L3 9" /></svg>;
  }
};

/** The csbot mark (tools/brand/icon.svg without its tile): a gold diamond with a cut-out centre. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="96 96 320 320" aria-hidden="true">
      <defs>
        <linearGradient id="csbot-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd98a" />
          <stop offset="1" stopColor="#e3a01f" />
        </linearGradient>
      </defs>
      <rect x="140" y="140" width="232" height="232" rx="34" fill="url(#csbot-gold)" transform="rotate(45 256 256)" />
      <rect x="206" y="206" width="100" height="100" rx="14" fill="var(--bg)" transform="rotate(45 256 256)" />
      <rect x="238" y="238" width="36" height="36" rx="6" fill="url(#csbot-gold)" transform="rotate(45 256 256)" />
    </svg>
  );
}
