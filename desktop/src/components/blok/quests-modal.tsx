import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { QuestsView } from "./right-sidebar";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function QuestsModal({ isOpen, onClose }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] w-[420px] max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-end px-2 py-1 border-b border-[var(--border)]">
          <button
            onClick={onClose}
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <QuestsView />
        </div>
      </div>
    </div>,
    document.body,
  );
}
