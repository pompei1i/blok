import { useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export const ACTIVITY_PRESETS = [
  { emoji: "🎮", label: "Gaming" },
  { emoji: "🎵", label: "Listening" },
  { emoji: "📚", label: "Studying" },
  { emoji: "💻", label: "Working" },
  { emoji: "📺", label: "Watching" },
  { emoji: "😴", label: "AFK" },
];

interface Props {
  current: string | null;
  anchorRect: DOMRect;
  onSelect: (activity: string | null) => void;
  onClose: () => void;
}

export function ActivityPicker({ current, anchorRect, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const top = anchorRect.top - 8;
  const left = anchorRect.left;

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl p-1.5 w-44"
      style={{ bottom: window.innerHeight - top, left }}
    >
      <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-wider px-2 py-1 font-medium">Set activity</p>
      <div className="grid grid-cols-2 gap-0.5">
        {ACTIVITY_PRESETS.map(({ emoji, label }) => {
          const value = `${emoji} ${label}`;
          const active = current === value;
          return (
            <button
              key={label}
              onClick={() => { onSelect(active ? null : value); onClose(); }}
              className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded transition-colors text-left ${
                active
                  ? "bg-[var(--accent-red)]/20 text-[var(--accent-red)]"
                  : "hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
              }`}
            >
              <span>{emoji}</span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      {current && (
        <>
          <div className="border-t border-[var(--border)] my-1" />
          <button
            onClick={() => { onSelect(null); onClose(); }}
            className="w-full text-left px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--destructive)] hover:bg-[var(--bg-hover)] transition-colors rounded"
          >
            Clear activity
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
