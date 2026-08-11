import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useUiSettingsStore } from "@/lib/store/ui-settings-store";
import { useI18n } from "@/lib/i18n";
import type { SettingsDraft } from "./settings/types";
import { AccountTab } from "./settings/account-tab";
import { SecurityTab } from "./settings/security-tab";
import { VideoTab } from "./settings/video-tab";
import { AudioTab } from "./settings/audio-tab";
import { HotkeysTab } from "./settings/hotkeys-tab";
import { ViewTab } from "./settings/view-tab";
import { ThemeTab } from "./settings/theme-tab";
import { SystemTab } from "./settings/system-tab";
import { LanguageTab } from "./settings/language-tab";

interface AccountEditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = "account" | "security" | "video" | "audio" | "hotkeys" | "view" | "theme" | "language" | "system";

const TAB_IDS = [
  { id: "account", labelKey: "settings.tab.account" as const },
  { id: "security", labelKey: "settings.tab.security" as const },
  { id: "video", labelKey: "settings.tab.video" as const },
  { id: "audio", labelKey: "settings.tab.audio" as const },
  { id: "hotkeys", labelKey: "settings.tab.hotkeys" as const },
  { id: "view", labelKey: "settings.tab.view" as const },
  { id: "theme", labelKey: "settings.tab.theme" as const },
  { id: "language", labelKey: "settings.tab.language" as const },
  { id: "system", labelKey: "settings.tab.system" as const },
] as const;

// Tabs with their own submit flow — the shared Apply bar is hidden for these.
const SELF_SUBMIT_TABS: TabId[] = ["account", "security"];

/**
 * Settings shell: sidebar navigation, the shared settings draft (committed to
 * the store on Apply) and the Apply bar. Each tab's content and tab-local
 * state/effects live in ./settings/<tab>-tab.tsx — tabs mount only while
 * active, so device enumeration / previews run on mount without activeTab
 * guards.
 */
export function AccountEditModal({ isOpen, onClose }: AccountEditModalProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>("account");
  const {
    previewVideo,
    mirrorCamera,
    cameraQuality,
    screenShareFps,
    screenShareResolution,
    screenShareQuality,
    cameraDevice,
    noiseSuppression,
    echoCancellation,
    inputVolume,
    noiseGateThreshold,
    pushToTalk,
    inputDevice,
    outputDevice,
    compactMode,
    showMemberList,
    themeMode,
    uiScale,
    language,
    autoTranslate,
    customCss,
    chatBackground,
    setSetting,
  } = useUiSettingsStore();

  const storeSnapshot: SettingsDraft = {
    previewVideo,
    mirrorCamera,
    cameraQuality,
    screenShareFps,
    screenShareResolution,
    screenShareQuality,
    cameraDevice,
    noiseSuppression,
    echoCancellation,
    inputVolume,
    noiseGateThreshold,
    pushToTalk,
    inputDevice,
    outputDevice,
    compactMode,
    showMemberList,
    themeMode,
    uiScale,
    language,
    autoTranslate,
    customCss,
    chatBackground,
  };

  const [draft, setDraft] = useState<SettingsDraft>(storeSnapshot);
  const [settingsMessage, setSettingsMessage] = useState(false);
  const [isApplyingSettings, setIsApplyingSettings] = useState(false);

  // Re-seed the draft from the store whenever the modal opens (or the store
  // changes underneath it, e.g. hotkey toggles while the modal is open).
  useEffect(() => {
    if (!isOpen) return;
    setDraft(storeSnapshot);
    setSettingsMessage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    previewVideo,
    mirrorCamera,
    cameraQuality,
    screenShareFps,
    screenShareResolution,
    screenShareQuality,
    cameraDevice,
    noiseSuppression,
    echoCancellation,
    inputVolume,
    pushToTalk,
    inputDevice,
    outputDevice,
    compactMode,
    showMemberList,
    themeMode,
    uiScale,
    language,
    autoTranslate,
    customCss,
    chatBackground,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleApplySettings = async () => {
    setIsApplyingSettings(true);
    setSettingsMessage(false);
    (
      Object.entries(draft) as Array<[keyof SettingsDraft, SettingsDraft[keyof SettingsDraft]]>
    ).forEach(([key, value]) => {
      setSetting(key, value);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    setSettingsMessage(true);
    setIsApplyingSettings(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        className="relative w-full max-w-4xl h-[80vh] bg-[var(--bg-base)] border border-[var(--border)] shadow-2xl animate-fade-in flex overflow-hidden"
      >
        {/* Settings Sidebar */}
        <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col p-4">
          <div className="mb-5 px-1">
            <p className="text-[10px] text-[var(--text-muted)] mb-0.5">~/blok</p>
            <h2 className="text-sm font-bold text-[var(--text-primary)] font-mono tracking-wider uppercase">
              <span className="text-[var(--text-muted)] font-normal">$ </span>
              {t("settings.title")}
            </h2>
          </div>

          <nav className="space-y-1">
            {TAB_IDS.map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabId)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-2 text-xs font-mono transition-all duration-150 text-left border",
                    isActive
                      ? "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_2px_0_0_var(--accent-red)]"
                      : "border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-solid hover:border-[var(--text-primary)]/30 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <span className={cn("flex-shrink-0", isActive ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]")}>
                    {isActive ? "[✓]" : ">"}
                  </span>
                  <span className="uppercase tracking-wide">{t(tab.labelKey)}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col bg-[var(--bg-base)] overflow-hidden relative">
          <div className="absolute right-4 top-4 z-10">
            <button
              onClick={onClose}
              className="font-mono text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-2 py-1 border border-dashed border-[var(--border)] hover:border-solid hover:border-[var(--text-primary)]/30"
            >
              [×]
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8 lg:p-10">
            {activeTab === "account" && <AccountTab onClose={onClose} />}
            {activeTab === "security" && <SecurityTab />}
            {activeTab === "video" && <VideoTab draft={draft} setDraft={setDraft} />}
            {activeTab === "audio" && <AudioTab draft={draft} setDraft={setDraft} />}
            {activeTab === "hotkeys" && <HotkeysTab draft={draft} setDraft={setDraft} />}
            {activeTab === "view" && <ViewTab draft={draft} setDraft={setDraft} />}
            {activeTab === "theme" && <ThemeTab draft={draft} setDraft={setDraft} />}
            {activeTab === "language" && <LanguageTab draft={draft} setDraft={setDraft} />}
            {activeTab === "system" && <SystemTab />}
          </div>

          {!SELF_SUBMIT_TABS.includes(activeTab) && (
            <div className="border-t border-[var(--border)] px-8 lg:px-10 py-3 bg-[var(--bg-surface)] flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--text-muted)] font-mono">
                {t("settings.applyHint")}
              </span>
              <div className="flex items-center gap-3">
                {settingsMessage && (
                  <span className="text-xs text-[var(--online-text)] font-mono">[✓] {t("settings.applied")}</span>
                )}
                <button
                  type="button"
                  onClick={handleApplySettings}
                  disabled={isApplyingSettings}
                  className="btn-terminal prefix-dollar px-4 py-2 text-xs font-semibold uppercase tracking-widest disabled:opacity-50"
                >
                  {isApplyingSettings ? t("settings.applying") : t("settings.apply")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
