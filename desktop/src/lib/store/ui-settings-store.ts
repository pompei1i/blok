import { create } from "zustand";
import { persist } from "zustand/middleware";
import { NOISE_GATE_DEFAULT, type ScreenShareFps, type ScreenShareResolution, type ScreenShareQuality } from "../constants";

export type ThemeMode = "dark" | "light" | "custom";
export type Language = "English" | "Polish" | "German" | "Spanish" | "Ukrainian" | "Russian";
export type CameraQuality = "720p" | "1080p" | "1440p";
export type { ScreenShareFps, ScreenShareResolution, ScreenShareQuality };

interface UiSettingsState {
  previewVideo: boolean;
  mirrorCamera: boolean;
  cameraQuality: CameraQuality;
  screenShareFps: ScreenShareFps;
  screenShareResolution: ScreenShareResolution;
  screenShareQuality: ScreenShareQuality;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  inputVolume: number;
  noiseGateThreshold: number; // 0 = off, 1–100
  pushToTalk: boolean;
  inputDevice: string; // empty = system default
  outputDevice: string; // empty = system default
  cameraDevice: string; // empty = system default
  compactMode: boolean;
  showMemberList: boolean;
  themeMode: ThemeMode;
  uiScale: number;
  language: Language;
  customCss: string;
  /** Custom chat background — data URL or image URL. Empty = no background. */
  chatBackground: string;
  setSetting: <K extends keyof Omit<UiSettingsState, "setSetting">>(
    key: K,
    value: UiSettingsState[K],
  ) => void;
}

export const useUiSettingsStore = create<UiSettingsState>()(
  persist(
    (set) => ({
      previewVideo: true,
      mirrorCamera: true,
      cameraQuality: "1080p",
      screenShareFps: 5,
      screenShareResolution: "720p",
      screenShareQuality: "medium",
      noiseSuppression: true,
      echoCancellation: true,
      inputVolume: 70,
      noiseGateThreshold: NOISE_GATE_DEFAULT,
      pushToTalk: false,
      inputDevice: "",
      outputDevice: "",
      cameraDevice: "",
      compactMode: false,
      showMemberList: true,
      themeMode: "dark",
      uiScale: 100,
      language: "English",
      customCss: "",
      chatBackground: "",
      setSetting: (key, value) => set({ [key]: value } as Partial<UiSettingsState>),
    }),
    {
      name: "blok-ui-settings",
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        let state = persistedState as Partial<UiSettingsState>;
        if (version < 1) {
          // v0→v1: disable browser-level EC/NS that caused Windows communications endpoint switching
          state = { ...state, echoCancellation: false, noiseSuppression: false };
        }
        if (version < 2) {
          // v1→v2: enable native Rust NS/EC — no device switching, works transparently
          state = { ...state, noiseSuppression: true, echoCancellation: true };
        }
        return state as UiSettingsState;
      },
    },
  ),
);

