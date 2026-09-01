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
  /** Preset for the desktop-audio checkbox on a mid-share source switch, where
   * the live state must win. Undefined on a fresh share, so the picker falls
   * back to the remembered `screenShareAudio` setting. */
  initialAudio: boolean | undefined;
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
  initialAudio: undefined,
  _resolve: null,
  requestPick: (sources, opts) =>
    new Promise<PickResult | null>((resolve) => {
      get()._resolve?.(null); // resolve any prior pending pick as cancelled
      set({ open: true, sources, initialAudio: opts?.initialAudio, _resolve: resolve });
    }),
  confirm: (r) => {
    get()._resolve?.(r);
    set({ open: false, sources: [], initialAudio: undefined, _resolve: null });
  },
  cancel: () => {
    get()._resolve?.(null);
    set({ open: false, sources: [], initialAudio: undefined, _resolve: null });
  },
}));
