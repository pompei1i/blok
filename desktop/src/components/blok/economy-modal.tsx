import { useEffect } from "react";
import { createPortal } from "react-dom";
import { EconomyView } from "./economy-view";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function EconomyModal({ isOpen, onClose }: Props) {
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
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] w-[420px] h-[600px] max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <EconomyView onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
