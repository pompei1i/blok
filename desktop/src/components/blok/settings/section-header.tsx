/** Terminal-style "$ TITLE" header used at the top of every settings tab. */
export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
        <span className="text-[var(--text-muted)] font-normal">$ </span>
        {title}
      </h3>
      {subtitle && <p className="text-[var(--text-muted)] text-xs mt-1">{subtitle}</p>}
    </div>
  );
}
