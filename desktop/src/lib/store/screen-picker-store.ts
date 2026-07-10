import { create } from "zustand";

/** Mirrors the Rust `CaptureSource` struct from the `list_capture_sources` command. */
export interface CaptureSource {
  id: string;
  name: string;
  kind: "screen" | "window";
}

export interface PickResult {
  sourceId: string;
  withAudio: boolean;
}

interface ScreenPickerState {
  open: boolean;
  sources: CaptureSource[];
  /** Initial state of the desktop-audio checkbox (e.g. current state on source switch). */
  initialAudio: boolean;
  _resolve: ((r: PickResult | null) => void) | null;
  /**
   * Open the picker and await the user's choice. Resolves with the chosen source
   * (+ desktop-audio flag), or `null` if the user cancels. Any previously pending
   * pick is cancelled first.
   */
  requestPick: (sources: CaptureSource[], opts?: { initialAudio?: boolean }) => Promise<PickResult | null>;
  confirm: (r: PickResult) => void;
  cancel: () => void;
}

export const useScreenPickerStore = create<ScreenPickerState>((set, get) => ({
  open: false,
  sources: [],
  initialAudio: false,
  _resolve: null,
  requestPick: (sources, opts) =>
    new Promise<PickResult | null>((resolve) => {
      get()._resolve?.(null); // resolve any prior pending pick as cancelled
      set({ open: true, sources, initialAudio: opts?.initialAudio ?? false, _resolve: resolve });
    }),
  confirm: (r) => {
    get()._resolve?.(r);
    set({ open: false, sources: [], initialAudio: false, _resolve: null });
  },
  cancel: () => {
    get()._resolve?.(null);
    set({ open: false, sources: [], initialAudio: false, _resolve: null });
  },
}));
