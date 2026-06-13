import { createPortal } from "react-dom";
import { useToastStore } from "@/lib/store/toast-store";

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto flex items-center gap-3 w-72 px-3 py-2.5 bg-[var(--bg-elevated)] border border-[var(--accent-red)]/50 shadow-2xl animate-fade-in text-left hover:bg-[var(--bg-hover)] transition-colors"
        >
          {t.emoji && <span className="text-xl leading-none shrink-0">{t.emoji}</span>}
          <div className="min-w-0">
            <p className="text-xs font-bold text-[var(--text-primary)] truncate">{t.title}</p>
            {t.message && (
              <p className="text-[12px] text-[var(--text-muted)] truncate">{t.message}</p>
            )}
          </div>
        </button>
      ))}
    </div>,
    document.body,
  );
}
