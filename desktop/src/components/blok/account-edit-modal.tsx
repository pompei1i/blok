import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle, XCircle, AlertCircle, ExternalLink } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils";
import { useUiSettingsStore, type CameraQuality, type Language, type ThemeMode } from "@/lib/store/ui-settings-store";
import { useI18n } from "@/lib/i18n";
import { useUpdater } from "@/hooks/useUpdater";

interface AccountEditModalProps {
 isOpen: boolean;
 onClose: () => void;
}

type TabId = "account" | "video" | "audio" | "hotkeys" | "view" | "theme" | "language" | "system";
type SettingsDraft = {
 previewVideo: boolean;
 mirrorCamera: boolean;
 cameraQuality: CameraQuality;
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

const TAB_IDS = [
 { id: "account", labelKey: "settings.tab.account" as const },
 { id: "video", labelKey: "settings.tab.video" as const },
 { id: "audio", labelKey: "settings.tab.audio" as const },
 { id: "hotkeys", labelKey: "settings.tab.hotkeys" as const },
 { id: "view", labelKey: "settings.tab.view" as const },
 { id: "theme", labelKey: "settings.tab.theme" as const },
 { id: "language", labelKey: "settings.tab.language" as const },
 { id: "system", labelKey: "settings.tab.system" as const },
] as const;

export function AccountEditModal({ isOpen, onClose }: AccountEditModalProps) {
 const { user, updateUser, logout } = useAuthStore();
 const { t } = useI18n();
 const [activeTab, setActiveTab] = useState<TabId>("account");
 const {
 previewVideo,
 mirrorCamera,
 cameraQuality,
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
 customCss,
 chatBackground,
 setSetting,
 } = useUiSettingsStore();
 const [draftSettings, setDraftSettings] = useState<SettingsDraft>({
 previewVideo,
 mirrorCamera,
 cameraQuality,
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
 customCss,
 chatBackground,
 });
 const [inputDevices, setInputDevices] = useState<string[]>([]);
 const [outputDevices, setOutputDevices] = useState<string[]>([]);
 const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
 const previewVideoRef = useRef<HTMLVideoElement>(null);
 const previewStreamRef = useRef<MediaStream | null>(null);
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
 const chatBgInputRef = useRef<HTMLInputElement>(null);
 const [message, setMessage] = useState<{
 type: "success" | "error";
 text: string;
 } | null>(null);
 const [settingsMessage, setSettingsMessage] = useState(false);
 const [isApplyingSettings, setIsApplyingSettings] = useState(false);
 const { available: updateAvailable, version: updateVersion, installing: updateInstalling, installUpdate } = useUpdater();
 const [appVersion, setAppVersion] = useState<string | null>(null);
 useEffect(() => {
 if (!("__TAURI_INTERNALS__" in window)) return;
 import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setAppVersion)).catch(() => {});
 }, []);

 useEffect(() => {
 if (!isOpen) return;
 setDraftSettings({
 previewVideo,
 mirrorCamera,
 cameraQuality,
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
 customCss,
 chatBackground,
 });
 setSettingsMessage(false);
 }, [
 isOpen,
 previewVideo,
 mirrorCamera,
 cameraQuality,
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
 customCss,
 chatBackground,
 ]);

 useEffect(() => {
 if (!isOpen || activeTab !== "video") return;
 navigator.mediaDevices.enumerateDevices().then((devices) => {
 setCameraDevices(devices.filter((d) => d.kind === "videoinput"));
 }).catch(() => {});
 }, [isOpen, activeTab]);

 useEffect(() => {
 if (!isOpen || activeTab !== "video" || !draftSettings.previewVideo) {
 previewStreamRef.current?.getTracks().forEach((t) => t.stop());
 previewStreamRef.current = null;
 if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
 return;
 }
 const qualityMap: Record<string, { width: number; height: number }> = {
 "720p": { width: 1280, height: 720 },
 "1080p": { width: 1920, height: 1080 },
 "1440p": { width: 2560, height: 1440 },
 };
 const dims = qualityMap[draftSettings.cameraQuality] ?? qualityMap["1080p"];
 const constraints: MediaTrackConstraints = {
 width: { ideal: dims.width },
 height: { ideal: dims.height },
 ...(draftSettings.cameraDevice ? { deviceId: { exact: draftSettings.cameraDevice } } : {}),
 };
 navigator.mediaDevices.getUserMedia({ video: constraints, audio: false }).then((stream) => {
 previewStreamRef.current?.getTracks().forEach((t) => t.stop());
 previewStreamRef.current = stream;
 if (previewVideoRef.current) previewVideoRef.current.srcObject = stream;
 }).catch(() => {});
 return () => {
 previewStreamRef.current?.getTracks().forEach((t) => t.stop());
 previewStreamRef.current = null;
 };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [isOpen, activeTab, draftSettings.previewVideo, draftSettings.cameraDevice, draftSettings.cameraQuality]);

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

 useEffect(() => {
 if (!isOpen) return;
 const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
 document.addEventListener("keydown", onKey);
 return () => document.removeEventListener("keydown", onKey);
 }, [isOpen, onClose]);

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

 const handleChatBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 if (!file) return;
 e.target.value = "";
 const img = new Image();
 const objectUrl = URL.createObjectURL(file);
 img.onload = () => {
 const MAX = 1280;
 const scale = Math.min(1, MAX / Math.max(img.width, img.height));
 const canvas = document.createElement("canvas");
 canvas.width = Math.round(img.width * scale);
 canvas.height = Math.round(img.height * scale);
 canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
 URL.revokeObjectURL(objectUrl);
 setDraftSettings((prev) => ({ ...prev, chatBackground: canvas.toDataURL("image/jpeg", 0.82) }));
 };
 img.src = objectUrl;
 };

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setIsSaving(true);
 setMessage(null);

 try {
  await updateUser({
   displayName: formData.displayName,
   username: formData.username,
   email: formData.email,
   bio: formData.bio,
   pronouns: formData.pronouns,
   ...(avatarBase64 ? { avatarUrl: avatarBase64 } : {}),
  });
  setMessage({ type: "success", text: t("settings.account.savedSuccess") });
  setTimeout(() => setMessage(null), 3000);
 } catch {
  setMessage({ type: "error", text: t("settings.account.saveError") });
 } finally {
  setIsSaving(false);
 }
 };

 const handleApplySettings = async () => {
 setIsApplyingSettings(true);
 setSettingsMessage(false);
 (
 Object.entries(draftSettings) as Array<
 [keyof SettingsDraft, SettingsDraft[keyof SettingsDraft]]
 >
 ).forEach(([key, value]) => {
 setSetting(key, value);
 });
 await new Promise((resolve) => setTimeout(resolve, 150));
 setSettingsMessage(true);
 setIsApplyingSettings(false);
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center">
 <div
 className="absolute inset-0 bg-black/70"
 onClick={onClose}
 />

 <div
 role="dialog"
 aria-modal="true"
 aria-label={t("settings.title")}
 className="relative w-full max-w-4xl h-[80vh] bg-[var(--bg-base)] border border-[var(--border)] shadow-2xl animate-fade-in flex overflow-hidden">

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

 {activeTab === "account" && (
 <div className="max-w-2xl animate-fade-in">
 <div className="mb-6">
 <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
 <span className="text-[var(--text-muted)] font-normal">$ </span>
 {t("settings.account.title")}
 </h3>
 <p className="text-[var(--text-muted)] text-xs mt-1">{t("settings.account.subtitle")}</p>
 </div>

 <form onSubmit={handleSubmit} className="space-y-5">
 {/* Avatar Section */}
 <div className="p-5 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] flex items-center gap-5">
 <div className="relative group flex-shrink-0">
 <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold border-2 border-[var(--border)] overflow-hidden bg-[var(--accent-red)]">
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
 className="absolute inset-0 rounded-full flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
 >
 <Camera className="w-5 h-5 text-white" />
 </button>
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-mono text-[var(--text-primary)]">@{user?.username}</p>
 <p className="text-xs text-[var(--text-muted)] mt-0.5">{user?.email}</p>
 {avatarPreview && (
 <p className="text-xs text-[var(--online)] mt-1 font-mono">[✓] {t("settings.account.newAvatarHint")}</p>
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
 <div className="p-5 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
 <div className="grid grid-cols-2 gap-5">
 <div>
 <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.account.displayName")}
 </label>
 <input
 type="text"
 value={formData.displayName}
 onChange={(e) =>
 setFormData((d) => ({ ...d, displayName: e.target.value }))
 }
 className="input-terminal"
 placeholder={t("settings.account.displayNamePlaceholder")}
 />
 </div>
 <div>
 <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.account.username")}
 </label>
 <div className="flex items-end gap-1">
 <span className="text-[var(--text-muted)] font-mono text-sm pb-1 flex-shrink-0">@</span>
 <input
 type="text"
 value={formData.username}
 onChange={(e) =>
 setFormData((d) => ({ ...d, username: e.target.value }))
 }
 className="input-terminal flex-1"
 placeholder="username"
 />
 </div>
 </div>
 </div>

 <div>
 <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.account.email")}
 </label>
 <input
 type="email"
 value={formData.email}
 onChange={(e) =>
 setFormData((d) => ({ ...d, email: e.target.value }))
 }
 className="input-terminal"
 placeholder="your@email.com"
 />
 </div>

 <div>
 <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.account.pronouns")}
 </label>
 <input
 type="text"
 value={formData.pronouns}
 onChange={(e) =>
 setFormData((d) => ({ ...d, pronouns: e.target.value }))
 }
 className="input-terminal"
 placeholder={t("settings.account.pronounsPlaceholder")}
 />
 </div>

 <div>
 <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.account.aboutMe")}
 </label>
 <textarea
 value={formData.bio}
 onChange={(e) =>
 setFormData((d) => ({ ...d, bio: e.target.value }))
 }
 rows={4}
 className="w-full bg-transparent border-b border-[var(--border)] focus:border-[var(--text-primary)] focus:outline-none text-sm text-[var(--text-primary)] font-mono py-2 resize-none transition-colors placeholder:text-[var(--text-muted)]"
 placeholder={t("settings.account.aboutMePlaceholder")}
 />
 </div>
 </div>

 {message && (
 <p className={cn(
 "text-sm font-mono animate-fade-in",
 message.type === "success" ? "text-[var(--online)]" : "text-[var(--destructive)]",
 )}>
 {message.type === "success" ? "[✓] " : "[!] "}{message.text}
 </p>
 )}

 <div className="flex justify-between items-center pt-2">
 <button
 type="button"
 onClick={() => {
 logout();
 onClose();
 }}
 className="text-sm font-mono text-[var(--destructive)] hover:text-[var(--text-primary)] transition-colors"
 >
 [!] {t("settings.account.logOut")}
 </button>
 <button
 type="submit"
 disabled={isSaving}
 className="btn-terminal prefix-dollar px-5 py-2 text-xs font-semibold uppercase tracking-widest disabled:opacity-50"
 >
 {isSaving ? t("settings.account.saving") : t("settings.account.saveChanges")}
 </button>
 </div>
 </form>
 </div>
 )}

 {activeTab === "video" && (
 <div className="max-w-2xl animate-fade-in space-y-5">
 <div>
 <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
 <span className="text-[var(--text-muted)] font-normal">$ </span>
 {t("settings.video.title")}
 </h3>
 <p className="text-[var(--text-muted)] text-xs mt-1">{t("settings.video.subtitle")}</p>
 </div>

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-3">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.video.cameraAccess")}
 </span>
 <div className="flex items-center justify-between gap-4">
 <div className="flex items-center gap-2 text-xs font-mono">
 {cameraDevices.length > 0
 ? <><CheckCircle className="w-3.5 h-3.5 text-[var(--online)]" /><span className="text-[var(--online)]">{t("settings.device.accessGranted")}</span></>
 : <><AlertCircle className="w-3.5 h-3.5 text-[var(--afk)]" /><span className="text-[var(--afk)]">{t("settings.video.noCameraDetected")}</span></>
 }
 </div>
 {cameraDevices.length === 0 && (
 <button
 type="button"
 onClick={() => {
 navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
 s.getTracks().forEach((t) => t.stop());
 navigator.mediaDevices.enumerateDevices().then((devs) => {
 setCameraDevices(devs.filter((d) => d.kind === "videoinput"));
 }).catch(() => {});
 }).catch(() => {});
 }}
 className="btn-terminal text-xs px-3 py-1"
 >
 {t("settings.device.grantAccess")}
 </button>
 )}
 </div>
 </div>

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
 <label className="block">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.video.cameraDevice")}
 </span>
 <select
 value={draftSettings.cameraDevice}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, cameraDevice: e.target.value }))}
 className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
 >
 <option value="">{t("settings.device.systemDefault")}</option>
 {cameraDevices.map((d) => (
 <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 8)}`}</option>
 ))}
 </select>
 </label>

 <label className="block">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.video.cameraQuality")}
 </span>
 <select
 value={draftSettings.cameraQuality}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, cameraQuality: e.target.value as CameraQuality }))}
 className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
 >
 <option>720p</option>
 <option>1080p</option>
 <option>1440p</option>
 </select>
 </label>

 <label className="flex items-center justify-between">
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.video.mirrorCamera")}</span>
 <input
 type="checkbox"
 checked={draftSettings.mirrorCamera}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, mirrorCamera: e.target.checked }))}
 />
 </label>

 <label className="flex items-center justify-between">
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.video.enablePreview")}</span>
 <input
 type="checkbox"
 checked={draftSettings.previewVideo}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, previewVideo: e.target.checked }))}
 />
 </label>
 </div>

 {draftSettings.previewVideo && (
 <div className="overflow-hidden bg-black aspect-video relative border border-[var(--border)]">
 <video
 ref={previewVideoRef}
 autoPlay
 playsInline
 muted
 className={cn("w-full h-full object-cover", draftSettings.mirrorCamera && "scale-x-[-1]")}
 />
 <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/60 text-[10px] font-mono text-[var(--text-muted)]">
 {t("settings.video.preview")}
 </span>
 </div>
 )}
 </div>
 )}

 {activeTab === "audio" && (
 <div className="max-w-2xl animate-fade-in space-y-5">
 <div>
 <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
 <span className="text-[var(--text-muted)] font-normal">$ </span>
 {t("settings.audio.title")}
 </h3>
 <p className="text-[var(--text-muted)] text-xs mt-1">{t("settings.audio.subtitle")}</p>
 </div>

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-3">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.audio.microphoneAccess")}
 </span>
 <div className="flex items-center justify-between gap-4">
 <div className="flex items-center gap-2 text-xs font-mono">
 {micPermission === "granted" && <><CheckCircle className="w-3.5 h-3.5 text-[var(--online)]" /><span className="text-[var(--online)]">{t("settings.device.accessGranted")}</span></>}
 {micPermission === "denied" && <><XCircle className="w-3.5 h-3.5 text-[var(--destructive)]" /><span className="text-[var(--destructive)]">{t("settings.device.accessDenied")}</span></>}
 {micPermission === "prompt" && <><AlertCircle className="w-3.5 h-3.5 text-[var(--afk)]" /><span className="text-[var(--afk)]">{t("settings.device.notYetRequested")}</span></>}
 {micPermission === "checking" && <><AlertCircle className="w-3.5 h-3.5 text-[var(--text-muted)]" /><span className="text-[var(--text-muted)]">{t("settings.device.checking")}</span></>}
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
 className="btn-terminal flex items-center gap-1.5 text-xs px-3 py-1"
 >
 <ExternalLink className="w-3 h-3" />
 {t("settings.device.openSystemSettings")}
 </button>
 ) : (
 <button
 type="button"
 onClick={requestMicPermission}
 className="btn-terminal text-xs px-3 py-1"
 >
 {t("settings.device.requestAccess")}
 </button>
 )}
 </div>
 )}
 </div>
 {micPermission === "denied" && (
 <p className="text-xs text-[var(--text-muted)] font-mono">
 {t("settings.audio.micPermHint")}
 </p>
 )}
 </div>

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
 <label className="block">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.audio.inputDevice")}
 </span>
 <select
 value={draftSettings.inputDevice}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, inputDevice: e.target.value }))}
 className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
 >
 <option value="">{t("settings.device.systemDefault")}</option>
 {inputDevices.map((d) => (
 <option key={d} value={d}>{d}</option>
 ))}
 </select>
 </label>
 <label className="block">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.audio.outputDevice")}
 </span>
 <select
 value={draftSettings.outputDevice}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, outputDevice: e.target.value }))}
 className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
 >
 <option value="">{t("settings.device.systemDefault")}</option>
 {outputDevices.map((d) => (
 <option key={d} value={d}>{d}</option>
 ))}
 </select>
 </label>
 </div>

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
 <label className="flex items-center justify-between">
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.audio.noiseSuppression")}</span>
 <input
 type="checkbox"
 checked={draftSettings.noiseSuppression}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, noiseSuppression: e.target.checked }))}
 />
 </label>
 <label className="flex items-center justify-between">
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.audio.echoCancellation")}</span>
 <input
 type="checkbox"
 checked={draftSettings.echoCancellation}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, echoCancellation: e.target.checked }))}
 />
 </label>
 <label className="block">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.audio.inputVolume")}: {draftSettings.inputVolume}%
 </span>
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
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.audio.noiseGate")}: {draftSettings.noiseGateThreshold === 0 ? t("settings.audio.noiseGateOff") : `${draftSettings.noiseGateThreshold}%`}
 </span>
 <p className="text-xs text-[var(--text-muted)] mb-2 font-mono">{t("settings.audio.noiseGateHint")}</p>
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
 <div className="max-w-2xl animate-fade-in space-y-5">
 <div>
 <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
 <span className="text-[var(--text-muted)] font-normal">$ </span>
 {t("settings.hotkeys.title")}
 </h3>
 <p className="text-[var(--text-muted)] text-xs mt-1">{t("settings.hotkeys.subtitle")}</p>
 </div>
 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-4">
 <label className="flex items-center justify-between">
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.hotkeys.pushToTalk")}</span>
 <input
 type="checkbox"
 checked={draftSettings.pushToTalk}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, pushToTalk: e.target.checked }))}
 />
 </label>
 <div className="grid grid-cols-2 gap-3 text-xs font-mono">
 <div className="bg-[var(--bg-base)] border border-dashed border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">{t("settings.hotkeys.muteUnmute")}</div>
 <div className="bg-[var(--bg-base)] border border-[var(--border)] px-3 py-2 text-[var(--text-primary)]">Ctrl + Shift + M</div>
 <div className="bg-[var(--bg-base)] border border-dashed border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">{t("settings.hotkeys.toggleOverlay")}</div>
 <div className="bg-[var(--bg-base)] border border-[var(--border)] px-3 py-2 text-[var(--text-primary)]">Ctrl + Shift + O</div>
 </div>
 </div>
 </div>
 )}

 {activeTab === "view" && (
 <div className="max-w-2xl animate-fade-in space-y-5">
 <div>
 <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
 <span className="text-[var(--text-muted)] font-normal">$ </span>
 {t("settings.view.title")}
 </h3>
 <p className="text-[var(--text-muted)] text-xs mt-1">{t("settings.view.subtitle")}</p>
 </div>
 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
 <label className="flex items-center justify-between">
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.view.compactMode")}</span>
 <input
 type="checkbox"
 checked={draftSettings.compactMode}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, compactMode: e.target.checked }))}
 />
 </label>
 <label className="flex items-center justify-between">
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.view.showMemberList")}</span>
 <input
 type="checkbox"
 checked={draftSettings.showMemberList}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, showMemberList: e.target.checked }))}
 />
 </label>
 <label className="block">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.view.uiScale")}: {draftSettings.uiScale}%
 </span>
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
 <div className="max-w-2xl animate-fade-in space-y-5">
 <div>
 <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
 <span className="text-[var(--text-muted)] font-normal">$ </span>
 {t("settings.theme.title")}
 </h3>
 <p className="text-[var(--text-muted)] text-xs mt-1">{t("settings.theme.subtitle")}</p>
 </div>

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-4">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.theme.baseTheme")}
 </span>
 <div className="flex gap-2">
 {(["dark", "light", "custom"] as ThemeMode[]).map((mode) => (
 <button
 key={mode}
 type="button"
 onClick={() => setDraftSettings((prev) => ({ ...prev, themeMode: mode }))}
 className={cn(
 "px-4 py-2 border text-xs font-mono capitalize transition-all duration-150",
 draftSettings.themeMode === mode
 ? "border-[var(--text-primary)] text-[var(--text-primary)] bg-[var(--bg-elevated)]"
 : "border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-solid hover:border-[var(--text-primary)]/30 hover:text-[var(--text-primary)]",
 )}
 >
 {draftSettings.themeMode === mode ? "[✓] " : "> "}{mode}
 </button>
 ))}
 </div>
 </div>

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-3">
 <div>
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
 <span className="mr-1">&gt;</span>{t("settings.theme.chatBackground")}
 </span>
 <p className="text-xs text-[var(--text-muted)] font-mono">{t("settings.theme.chatBackgroundHint")}</p>
 </div>
 <div className="flex items-center gap-3">
 <div
 className="w-28 h-16 flex-shrink-0 border border-[var(--border)] bg-[var(--bg-base)] bg-center bg-cover bg-no-repeat overflow-hidden"
 style={draftSettings.chatBackground ? { backgroundImage: `url("${draftSettings.chatBackground}")` } : undefined}
 />
 <div className="flex flex-col gap-2">
 <button type="button" onClick={() => chatBgInputRef.current?.click()} className="btn-terminal text-xs px-3 py-1">
 {t("settings.theme.chatBackgroundUpload")}
 </button>
 {draftSettings.chatBackground && (
 <button
 type="button"
 onClick={() => setDraftSettings((prev) => ({ ...prev, chatBackground: "" }))}
 className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors text-left"
 >
 [rm]
 </button>
 )}
 </div>
 <input ref={chatBgInputRef} type="file" accept="image/*" className="hidden" onChange={handleChatBgChange} />
 </div>
 <input
 type="text"
 value={draftSettings.chatBackground.startsWith("data:") ? "" : draftSettings.chatBackground}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, chatBackground: e.target.value }))}
 placeholder="https://…"
 className="input-terminal text-sm"
 />
 </div>

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-3">
 <div>
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
 <span className="mr-1">&gt;</span>{t("settings.theme.customCss")}
 </span>
 <p className="text-xs text-[var(--text-muted)] font-mono">
 {t("settings.theme.customCssHint")}
 </p>
 </div>
 <textarea
 value={draftSettings.customCss}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, customCss: e.target.value }))}
 rows={12}
 spellCheck={false}
 placeholder={`/* Example: change accent color */\n:root {\n --accent-red: #0ac000;\n}\n\n/* Hide scrollbars */\n* { scrollbar-width: none; }`}
 className="w-full bg-transparent border border-dashed border-[var(--border)] focus:border-solid focus:border-[var(--text-primary)] focus:outline-none px-3 py-2 text-sm text-[var(--text-primary)] font-mono resize-none transition-colors placeholder:text-[var(--text-muted)]"
 />
 </div>
 </div>
 )}

 {activeTab === "system" && (
 <div className="max-w-2xl animate-fade-in space-y-5">
 <div>
 <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
 <span className="text-[var(--text-muted)] font-normal">$ </span>
 {t("settings.system.title")}
 </h3>
 <p className="text-[var(--text-muted)] text-xs mt-1">{t("settings.system.subtitle")}</p>
 </div>
 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
 <label className="flex items-center justify-between gap-6">
 <div>
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.system.launchOnStartup")}</span>
 <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">{t("settings.system.launchOnStartupHint")}</p>
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

 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-4">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.system.updates")}
 </span>
 <div className="flex items-center justify-between gap-4">
 <div>
 <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.system.currentVersion")}</span>
 <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
 {appVersion ? `v${appVersion}` : "—"}
 </p>
 </div>
 {updateAvailable ? (
 <button
 onClick={installUpdate}
 disabled={updateInstalling}
 className="btn-terminal prefix-dollar text-xs px-3 py-1.5 font-semibold disabled:opacity-50"
 >
 {updateInstalling ? t("settings.system.installingUpdate") : `${t("settings.system.installUpdate")} v${updateVersion}`}
 </button>
 ) : (
 <span className="text-xs text-[var(--online)] font-mono">[✓] {t("settings.system.upToDate")}</span>
 )}
 </div>
 </div>
 </div>
 )}

 {activeTab === "language" && (
 <div className="max-w-2xl animate-fade-in space-y-5">
 <div>
 <h3 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-wider">
 <span className="text-[var(--text-muted)] font-normal">$ </span>
 {t("settings.language.title")}
 </h3>
 <p className="text-[var(--text-muted)] text-xs mt-1">{t("settings.language.subtitle")}</p>
 </div>
 <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)]">
 <label className="block">
 <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
 <span className="mr-1">&gt;</span>{t("settings.language.label")}
 </span>
 <select
 value={draftSettings.language}
 onChange={(e) => setDraftSettings((prev) => ({ ...prev, language: e.target.value as Language }))}
 className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
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
 <div className="border-t border-[var(--border)] px-8 lg:px-10 py-3 bg-[var(--bg-surface)] flex items-center justify-between gap-3">
 <span className="text-xs text-[var(--text-muted)] font-mono">
 {t("settings.applyHint")}
 </span>
 <div className="flex items-center gap-3">
 {settingsMessage && (
 <span className="text-xs text-[var(--online)] font-mono">[✓] {t("settings.applied")}</span>
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
