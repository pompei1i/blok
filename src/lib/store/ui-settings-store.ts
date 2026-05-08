import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light";
export type Language = "English" | "Polish" | "German" | "Spanish" | "Ukrainian";
export type CameraQuality = "720p" | "1080p" | "1440p";

interface UiSettingsState {
  previewVideo: boolean;
  mirrorCamera: boolean;
  cameraQuality: CameraQuality;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  inputVolume: number;
  pushToTalk: boolean;
  compactMode: boolean;
  showMemberList: boolean;
  themeMode: ThemeMode;
  uiScale: number;
  language: Language;
  customCss: string;
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
      noiseSuppression: true,
      echoCancellation: true,
      inputVolume: 70,
      pushToTalk: false,
      compactMode: false,
      showMemberList: true,
      themeMode: "dark",
      uiScale: 100,
      language: "English",
      customCss: "",
      setSetting: (key, value) => set({ [key]: value } as Partial<UiSettingsState>),
    }),
    {
      name: "blok-ui-settings",
    },
  ),
);

