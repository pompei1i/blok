import { useEffect, useRef, useState } from "react";
import { X, Camera, Save, User, Video, Mic, Keyboard, Layout, Palette, Globe, LogOut, CheckCircle, XCircle, AlertCircle, ExternalLink, Monitor } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils";
import { useUiSettingsStore, type CameraQuality, type Language, type ThemeMode, type ScreenShareFps, type ScreenShareResolution, type ScreenShareQuality } from "@/lib/store/ui-settings-store";
import { SCREEN_SHARE_FPS_OPTIONS } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";

interface AccountEditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = "account" | "video" | "audio" | "hotkeys" | "view" | "theme" | "language" | "system";
type SettingsDraft = {
  previewVideo: boolean;
  mirrorCamera: boolean;
  cameraQuality: CameraQuality;
  screenShareFps: ScreenShareFps;
  screenShareResolution: ScreenShareResolution;
  screenShareQuality: ScreenShareQuality;
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
};

const TAB_IDS = [
  { id: "account", labelKey: "settings.tab.account" as const, icon: User },
  { id: "video",   labelKey: "settings.tab.video"   as const, icon: Video },
  { id: "audio",   labelKey: "settings.tab.audio"   as const, icon: Mic },
  { id: "hotkeys", labelKey: "settings.tab.hotkeys" as const, icon: Keyboard },
  { id: "view",    labelKey: "settings.tab.view"    as const, icon: Layout },
  { id: "theme",   labelKey: "settings.tab.theme"   as const, icon: Palette },
  { id: "language", labelKey: "settings.tab.language" as const, icon: Globe },
  { id: "system",   labelKey: "settings.tab.system"   as const, icon: Monitor },
] as const;

export function AccountEditModal({ isOpen, onClose }: AccountEditModalProps) {
  const { user, updateUser, logout } = useAuthStore();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>("account");
  const {
    previewVideo,
    mirrorCamera,
    cameraQuality,
    screenShareFps,
    screenShareResolution,
    screenShareQuality,
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
    customCss,
    setSetting,
  } = useUiSettingsStore();
  const [draftSettings, setDraftSettings] = useState<SettingsDraft>({
    previewVideo,
    mirrorCamera,
    cameraQuality,
    screenShareFps,
    screenShareResolution,
    screenShareQuality,
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
    customCss,
  });
  const [inputDevices, setInputDevices] = useState<string[]>([]);
  const [outputDevices, setOutputDevices] = useState<string[]>([]);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  
  const [formData, setFormData] = useState({
    displayName: user?.displayName || "",
    username: user?.username || "",
    email: user?.email || "",
    bio: user?.bio || "",
    pronouns: user?.pronouns || "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [micPermission, setMicPermission] = useState<"granted" | "denied" | "prompt" | "checking">("checking");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [isApplyingSettings, setIsApplyingSettings] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraftSettings({
      previewVideo,
      mirrorCamera,
      cameraQuality,
      screenShareFps,
      screenShareResolution,
      screenShareQuality,
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
      customCss,
    });
    setSettingsMessage(null);
  }, [
    isOpen,
    previewVideo,
    mirrorCamera,
    cameraQuality,
    screenShareFps,
    screenShareResolution,
    screenShareQuality,
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
    customCss,
  ]);

  useEffect(() => {
    if (!isOpen || activeTab !== "audio") return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string[]>("audio_list_input_devices").then(setInputDevices).catch(() => {});
      invoke<string[]>("audio_list_output_devices").then(setOutputDevices).catch(() => {});
    });
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen || activeTab !== "system") return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<boolean>("autostart_is_enabled").then(setLaunchOnStartup).catch(() => {});
    });
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen) return;
    if (!navigator.permissions) { setMicPermission("prompt"); return; }
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        setMicPermission(result.state as "granted" | "denied" | "prompt");
        result.onchange = () => setMicPermission(result.state as "granted" | "denied" | "prompt");
      })
      .catch(() => setMicPermission("prompt"));
  }, [isOpen]);

  if (!isOpen) return null;

  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
    } catch {
      setMicPermission("denied");
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 256;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressed = canvas.toDataURL("image/jpeg", 0.8);
      URL.revokeObjectURL(objectUrl);
      setAvatarPreview(compressed);
      setAvatarBase64(compressed);
    };
    img.src = objectUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    await new Promise((resolve) => setTimeout(resolve, 500));

    updateUser({
      displayName: formData.displayName,
      username: formData.username,
      email: formData.email,
      bio: formData.bio,
      pronouns: formData.pronouns,
      ...(avatarBase64 ? { avatarUrl: avatarBase64 } : {}),
    });

    setMessage({ type: "success", text: t("settings.account.savedSuccess") });
    setIsSaving(false);

    setTimeout(() => {
      setMessage(null);
    }, 3000);
  };

  const handleApplySettings = async () => {
    setIsApplyingSettings(true);
    setSettingsMessage(null);
    (
      Object.entries(draftSettings) as Array<
        [keyof SettingsDraft, SettingsDraft[keyof SettingsDraft]]
      >
    ).forEach(([key, value]) => {
      setSetting(key, value);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    setSettingsMessage(t("settings.applied"));
    setIsApplyingSettings(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-4xl h-[80vh] bg-[var(--bg-base)] border border-[var(--border)] rounded-2xl shadow-2xl animate-fade-in flex overflow-hidden">
        
        {/* Settings Sidebar */}
        <div className="w-64 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col p-4">
          <div className="mb-6 px-2">
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{t("settings.title")}</h2>
          </div>
          
          <nav className="space-y-1">
            {TAB_IDS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabId)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative overflow-hidden",
                    isActive
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <span className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors"><Icon className="w-4 h-4" /></span>
                  <span>{t(tab.labelKey)}</span>
                  
                  {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--accent-red)] rounded-r-full shadow-[0_0_10px_var(--accent-red)]" />
                  )}
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
              className="p-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border)] rounded-full transition-colors text-[var(--text-muted)] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8 lg:p-12">
            
            {activeTab === "account" && (
              <div className="max-w-2xl animate-fade-in">
                <div className="mb-8">
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t("settings.account.title")}</h3>
                  <p className="text-[var(--text-muted)] mt-1">{t("settings.account.subtitle")}</p>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Avatar Section */}
                  <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl flex items-center gap-6">
                    <div className="relative group">
                      <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-bold border-2 border-[var(--border)] overflow-hidden shadow-lg bg-[var(--accent-red)]">
                        {(avatarPreview || user?.avatarUrl) ? (
                          <img
                            src={avatarPreview ?? user!.avatarUrl!}
                            alt="Avatar"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-white">
                            {formData.displayName?.[0]?.toUpperCase() || "U"}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl backdrop-blur-sm"
                      >
                        <Camera className="w-6 h-6 text-white" />
                      </button>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)]">@{user?.username}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{user?.email}</p>
                      {avatarPreview && (
                        <p className="text-xs text-[var(--online)] mt-1">new avatar selected — save to apply</p>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarChange}
                    />
                  </div>

                  {/* Form Fields */}
                  <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-5">
                    <div className="grid grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                          {t("settings.account.displayName")}
                        </label>
                        <input
                          type="text"
                          value={formData.displayName}
                          onChange={(e) =>
                            setFormData((d) => ({ ...d, displayName: e.target.value }))
                          }
                          className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)] transition-colors"
                          placeholder={t("settings.account.displayNamePlaceholder")}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                          {t("settings.account.username")}
                        </label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-mono">
                            @
                          </span>
                          <input
                            type="text"
                            value={formData.username}
                            onChange={(e) =>
                              setFormData((d) => ({ ...d, username: e.target.value }))
                            }
                            className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)] transition-colors font-mono"
                            placeholder="username"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                        {t("settings.account.email")}
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) =>
                          setFormData((d) => ({ ...d, email: e.target.value }))
                        }
                        className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)] transition-colors"
                        placeholder="your@email.com"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                        {t("settings.account.pronouns")}
                      </label>
                      <input
                        type="text"
                        value={formData.pronouns}
                        onChange={(e) =>
                          setFormData((d) => ({ ...d, pronouns: e.target.value }))
                        }
                        className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)] transition-colors"
                        placeholder={t("settings.account.pronounsPlaceholder")}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                        {t("settings.account.aboutMe")}
                      </label>
                      <textarea
                        value={formData.bio}
                        onChange={(e) =>
                          setFormData((d) => ({ ...d, bio: e.target.value }))
                        }
                        rows={4}
                        className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)] transition-colors resize-none"
                        placeholder={t("settings.account.aboutMePlaceholder")}
                      />
                    </div>
                  </div>

                  {message && (
                    <div
                      className={cn(
                        "p-4 rounded-xl text-sm font-medium animate-fade-in flex items-center gap-2",
                        message.type === "success"
                          ? "bg-[var(--online)]/10 text-[var(--online)] border border-[var(--online)]/20"
                          : "bg-[var(--destructive)]/10 text-[var(--destructive)] border border-[var(--destructive)]/20",
                      )}
                    >
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        message.type === "success" ? "bg-[var(--online)]" : "bg-[var(--destructive)]"
                      )} />
                      {message.text}
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        logout();
                        onClose();
                      }}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)]/10 rounded-xl transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {t("settings.account.logOut")}
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-[var(--text-primary)] text-[var(--bg-base)] rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      {isSaving ? t("settings.account.saving") : t("settings.account.saveChanges")}
                    </button>
                  </div>
                </form>
              </div>
            )}
            
            {activeTab === "video" && (
              <div className="max-w-2xl animate-fade-in space-y-6">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t("settings.video.title")}</h3>
                  <p className="text-[var(--text-muted)] mt-1">{t("settings.video.subtitle")}</p>
                </div>
                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-5">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-primary)]">{t("settings.video.enablePreview")}</span>
                    <input
                      type="checkbox"
                      checked={draftSettings.previewVideo}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, previewVideo: e.target.checked }))}
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-primary)]">{t("settings.video.mirrorCamera")}</span>
                    <input
                      type="checkbox"
                      checked={draftSettings.mirrorCamera}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, mirrorCamera: e.target.checked }))}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">{t("settings.video.cameraQuality")}</span>
                    <select
                      value={draftSettings.cameraQuality}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, cameraQuality: e.target.value as CameraQuality }))}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)]"
                    >
                      <option>720p</option>
                      <option>1080p</option>
                      <option>1440p</option>
                    </select>
                  </label>
                </div>

                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-5">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{t("settings.video.screenShare")}</span>
                  <label className="block">
                    <span className="block text-xs text-[var(--text-muted)] mb-2">{t("settings.video.screenShareFps")}</span>
                    <select
                      value={draftSettings.screenShareFps}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, screenShareFps: Number(e.target.value) as ScreenShareFps }))}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)]"
                    >
                      {SCREEN_SHARE_FPS_OPTIONS.map((fps) => (
                        <option key={fps} value={fps}>{fps} fps</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-xs text-[var(--text-muted)] mb-2">{t("settings.video.screenShareResolution")}</span>
                    <select
                      value={draftSettings.screenShareResolution}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, screenShareResolution: e.target.value as ScreenShareResolution }))}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)]"
                    >
                      <option value="720p">720p (1280px)</option>
                      <option value="1080p">1080p (1920px)</option>
                      <option value="1440p">1440p (2560px)</option>
                      <option value="native">{t("settings.video.screenShareNative")}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-xs text-[var(--text-muted)] mb-2">{t("settings.video.screenShareQuality")}</span>
                    <select
                      value={draftSettings.screenShareQuality}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, screenShareQuality: e.target.value as ScreenShareQuality }))}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)]"
                    >
                      <option value="low">{t("settings.video.qualityLow")}</option>
                      <option value="medium">{t("settings.video.qualityMedium")}</option>
                      <option value="high">{t("settings.video.qualityHigh")}</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "audio" && (
              <div className="max-w-2xl animate-fade-in space-y-6">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t("settings.audio.title")}</h3>
                  <p className="text-[var(--text-muted)] mt-1">{t("settings.audio.subtitle")}</p>
                </div>

                {/* Microphone Permission */}
                <div className="p-5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-3">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Microphone Access</span>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-sm">
                      {micPermission === "granted" && <><CheckCircle className="w-4 h-4 text-[var(--online)]" /><span className="text-[var(--online)]">Access granted</span></>}
                      {micPermission === "denied" && <><XCircle className="w-4 h-4 text-[var(--destructive)]" /><span className="text-[var(--destructive)]">Access denied</span></>}
                      {micPermission === "prompt" && <><AlertCircle className="w-4 h-4 text-[var(--afk)]" /><span className="text-[var(--afk)]">Not yet requested</span></>}
                      {micPermission === "checking" && <><AlertCircle className="w-4 h-4 text-[var(--text-muted)]" /><span className="text-[var(--text-muted)]">Checking...</span></>}
                    </div>
                    {micPermission !== "granted" && (
                      <div className="flex gap-2">
                        {micPermission === "denied" ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const { openUrl } = await import("@tauri-apps/plugin-opener");
                                await openUrl("ms-settings:privacy-microphone");
                              } catch { /* not in Tauri or failed */ }
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg hover:border-[var(--text-muted)] transition-colors text-[var(--text-primary)]"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open System Settings
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={requestMicPermission}
                            className="px-3 py-1.5 text-xs bg-[var(--online)]/20 text-[var(--online)] border border-[var(--online)]/30 rounded-lg hover:bg-[var(--online)]/30 transition-colors"
                          >
                            Request Access
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {micPermission === "denied" && (
                    <p className="text-xs text-[var(--text-muted)]">
                      Open Windows Settings → Privacy → Microphone and allow access for this app.
                    </p>
                  )}
                </div>

                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-5">
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">Input Device (Microphone)</span>
                    <select
                      value={draftSettings.inputDevice}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, inputDevice: e.target.value }))}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)]"
                    >
                      <option value="">System Default</option>
                      {inputDevices.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">Output Device (Speakers)</span>
                    <select
                      value={draftSettings.outputDevice}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, outputDevice: e.target.value }))}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)]"
                    >
                      <option value="">System Default</option>
                      {outputDevices.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-5">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-primary)]">{t("settings.audio.noiseSuppression")}</span>
                    <input
                      type="checkbox"
                      checked={draftSettings.noiseSuppression}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, noiseSuppression: e.target.checked }))}
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-primary)]">{t("settings.audio.echoCancellation")}</span>
                    <input
                      type="checkbox"
                      checked={draftSettings.echoCancellation}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, echoCancellation: e.target.checked }))}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">{t("settings.audio.inputVolume")}: {draftSettings.inputVolume}%</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={draftSettings.inputVolume}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, inputVolume: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
                      Noise Gate: {draftSettings.noiseGateThreshold === 0 ? "off" : `${draftSettings.noiseGateThreshold}%`}
                    </span>
                    <p className="text-xs text-[var(--text-muted)] mb-2">Cuts audio below this volume threshold. Higher = more aggressive noise removal.</p>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={draftSettings.noiseGateThreshold}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, noiseGateThreshold: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </label>
                </div>
              </div>
            )}

            {activeTab === "hotkeys" && (
              <div className="max-w-2xl animate-fade-in space-y-6">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t("settings.hotkeys.title")}</h3>
                  <p className="text-[var(--text-muted)] mt-1">{t("settings.hotkeys.subtitle")}</p>
                </div>
                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-4">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-primary)]">{t("settings.hotkeys.pushToTalk")}</span>
                    <input
                      type="checkbox"
                      checked={draftSettings.pushToTalk}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, pushToTalk: e.target.checked }))}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-muted)]">{t("settings.hotkeys.muteUnmute")}</div>
                    <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)]">Ctrl + Shift + M</div>
                    <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-muted)]">{t("settings.hotkeys.toggleOverlay")}</div>
                    <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)]">Ctrl + Shift + O</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "view" && (
              <div className="max-w-2xl animate-fade-in space-y-6">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t("settings.view.title")}</h3>
                  <p className="text-[var(--text-muted)] mt-1">{t("settings.view.subtitle")}</p>
                </div>
                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-5">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-primary)]">{t("settings.view.compactMode")}</span>
                    <input
                      type="checkbox"
                      checked={draftSettings.compactMode}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, compactMode: e.target.checked }))}
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-primary)]">{t("settings.view.showMemberList")}</span>
                    <input
                      type="checkbox"
                      checked={draftSettings.showMemberList}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, showMemberList: e.target.checked }))}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">{t("settings.view.uiScale")}: {draftSettings.uiScale}%</span>
                    <input
                      type="range"
                      min={80}
                      max={120}
                      value={draftSettings.uiScale}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, uiScale: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </label>
                </div>
              </div>
            )}

            {activeTab === "theme" && (
              <div className="max-w-2xl animate-fade-in space-y-6">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t("settings.theme.title")}</h3>
                  <p className="text-[var(--text-muted)] mt-1">{t("settings.theme.subtitle")}</p>
                </div>

                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-4">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Base theme</span>
                  <div className="flex gap-2">
                    {(["dark", "light"] as ThemeMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setDraftSettings((prev) => ({ ...prev, themeMode: mode }))}
                        className={cn(
                          "px-4 py-2 rounded-lg border text-sm capitalize transition-colors",
                          draftSettings.themeMode === mode
                            ? "bg-[var(--bg-elevated)] border-[var(--text-primary)] text-[var(--text-primary)]"
                            : "bg-[var(--bg-base)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                        )}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-3">
                  <div>
                    <span className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">Custom CSS</span>
                    <p className="text-xs text-[var(--text-muted)]">
                      Inject your own CSS to fully customize the UI. Applied instantly after saving.
                    </p>
                  </div>
                  <textarea
                    value={draftSettings.customCss}
                    onChange={(e) => setDraftSettings((prev) => ({ ...prev, customCss: e.target.value }))}
                    rows={12}
                    spellCheck={false}
                    placeholder={`/* Example: change accent color */\n:root {\n  --accent-red: #0ac000;\n}\n\n/* Hide scrollbars */\n* { scrollbar-width: none; }`}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--accent-red)] transition-colors resize-none placeholder:text-[var(--text-muted)]/50"
                  />
                </div>
              </div>
            )}

            {activeTab === "system" && (
              <div className="max-w-2xl animate-fade-in space-y-6">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t("settings.system.title")}</h3>
                  <p className="text-[var(--text-muted)] mt-1">{t("settings.system.subtitle")}</p>
                </div>
                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl space-y-5">
                  <label className="flex items-center justify-between gap-6">
                    <div>
                      <span className="text-sm text-[var(--text-primary)]">{t("settings.system.launchOnStartup")}</span>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{t("settings.system.launchOnStartupHint")}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={launchOnStartup}
                      disabled={!("__TAURI_INTERNALS__" in window)}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setLaunchOnStartup(next);
                        import("@tauri-apps/api/core").then(({ invoke }) => {
                          invoke("autostart_set", { enabled: next }).catch(() => {
                            setLaunchOnStartup(!next);
                          });
                        });
                      }}
                    />
                  </label>
                </div>
              </div>
            )}

            {activeTab === "language" && (
              <div className="max-w-2xl animate-fade-in space-y-6">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t("settings.language.title")}</h3>
                  <p className="text-[var(--text-muted)] mt-1">{t("settings.language.subtitle")}</p>
                </div>
                <div className="p-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl">
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">{t("settings.language.label")}</span>
                    <select
                      value={draftSettings.language}
                      onChange={(e) => setDraftSettings((prev) => ({ ...prev, language: e.target.value as Language }))}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)]"
                    >
                      <option>English</option>
                      <option>Polish</option>
                      <option>German</option>
                      <option>Spanish</option>
                      <option>Ukrainian</option>
                      <option>Russian</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

          </div>
          {activeTab !== "account" && (
            <div className="border-t border-[var(--border)] px-8 lg:px-12 py-4 bg-[var(--bg-surface)] flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--text-muted)]">
                {t("settings.applyHint")}
              </span>
              <div className="flex items-center gap-3">
                {settingsMessage && (
                  <span className="text-xs text-[var(--online)]">{settingsMessage}</span>
                )}
                <button
                  type="button"
                  onClick={handleApplySettings}
                  disabled={isApplyingSettings}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[var(--text-primary)] text-[var(--bg-base)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
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

