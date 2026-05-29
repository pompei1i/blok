export function FishHookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="19" cy="6" r="2" />
      <path d="M17 6 L9 6 C4 6 2 10 2 14 C2 18 5 22 10 22 C14 22 17 19 17 15 L17 12" />
      <line x1="17" y1="12" x2="14" y2="15" />
    </svg>
  );
}
