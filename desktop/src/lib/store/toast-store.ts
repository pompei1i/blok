import { create } from "zustand";
import type { ComponentType } from "react";

export interface Toast {
  id: string;
  /** Monochrome Lucide-style icon (preferred). Rendered in the accent color. */
  icon?: ComponentType<{ className?: string }>;
  /** Legacy color emoji — kept for any callers that still pass one. */
  emoji?: string;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: Toast[];
  showToast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  showToast: (t) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => get().dismiss(id), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
