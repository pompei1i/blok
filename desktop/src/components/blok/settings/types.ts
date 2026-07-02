import type { CameraQuality, Language, ThemeMode, ScreenShareFps } from "@/lib/store/ui-settings-store";

/**
 * Working copy of the UI settings edited across the settings tabs. Committed
 * to the store only when the user hits Apply (see AccountEditModal).
 */
export type SettingsDraft = {
  previewVideo: boolean;
  mirrorCamera: boolean;
  cameraQuality: CameraQuality;
  screenShareFps: ScreenShareFps;
  cameraDevice: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  inputVolume: number;
  noiseGateThreshold: number;
  pushToTalk: boolean;
  inputDevice: string;
  outputDevice: string;
  compactMode: boolean;
  showMemberList: boolean;
  themeMode: ThemeMode;
  uiScale: number;
  language: Language;
  customCss: string;
  chatBackground: string;
};

/** Props for tabs that edit the shared settings draft. */
export interface DraftTabProps {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
}
