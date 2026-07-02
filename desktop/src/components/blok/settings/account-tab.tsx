import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { nameplateStyle, avatarFrameStyle, bannerBackground, bannerClass } from "@/lib/economy";
import { InventorySection } from "../economy-view";
import { SectionHeader } from "./section-header";
import { AvatarFrameSVG } from "../avatar-frame-svg";

/** Profile form (avatar, names, bio) + equipped-cosmetics inventory. */
export function AccountTab({ onClose }: { onClose: () => void }) {
  const { user, updateUser, logout } = useAuthStore();
  const { t } = useI18n();

  const [formData, setFormData] = useState({
    displayName: user?.displayName || "",
    username: user?.username || "",
    email: user?.email || "",
    bio: user?.bio || "",
    pronouns: user?.pronouns || "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Equipped cosmetics preview — same renderers used everywhere else in the app.
  const frame = avatarFrameStyle(user);
  const { style: npStyle, className: npClassName } = nameplateStyle(user);
  const banner = bannerBackground(user);
  const bannerAnimClass = bannerClass(user);

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

    try {
      // Avatars go to the Storage bucket; the profile row only carries the URL.
      // Fall back to inline base64 if the upload fails (e.g. bucket not deployed
      // yet) — the lazy self-migration on next login will move it to Storage.
      let avatarUrl: string | undefined;
      if (avatarBase64 && user) {
        const { uploadAvatar } = await import("@/lib/avatar");
        avatarUrl = (await uploadAvatar(user.id, avatarBase64, user.avatarUrl)) ?? avatarBase64;
      }
      await updateUser({
        displayName: formData.displayName,
        username: formData.username,
        email: formData.email,
        bio: formData.bio,
        pronouns: formData.pronouns,
        ...(avatarUrl ? { avatarUrl } : {}),
      });
      setMessage({ type: "success", text: t("settings.account.savedSuccess") });
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: "error", text: t("settings.account.saveError") });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl animate-fade-in">
      <div className="mb-6">
        <SectionHeader title={t("settings.account.title")} subtitle={t("settings.account.subtitle")} />
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Avatar Section — banner strip (equipped cosmetic) behind the avatar row */}
        <div className="bg-[var(--bg-surface)] border border-dashed border-[var(--border)] overflow-hidden">
          <div
            className={cn("h-14", bannerAnimClass)}
            style={{ background: banner ?? "var(--bg-elevated)" }}
          />
          <div className="p-5 pt-0 flex items-center gap-5">
            <div
              className="relative group flex-shrink-0 -mt-8 w-20 h-20 rounded-full"
              style={
                frame?.ring && !frame?.shape
                  ? { boxShadow: frame.effect ? `0 0 0 2px ${frame.ring}, 0 0 10px ${frame.ring}` : `0 0 0 2px ${frame.ring}` }
                  : undefined
              }
            >
              {/* Image is clipped to the circle; the outer div stays overflow-visible
                  so SVG frame shapes (orbit/hex/crystal) can render past the edge. */}
              <div className="w-full h-full rounded-full flex items-center justify-center text-2xl font-bold border-2 border-[var(--bg-surface)] overflow-hidden bg-[var(--accent-red)]">
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
              {frame?.shape && (
                <AvatarFrameSVG shape={frame.shape} color={frame.color ?? "#888"} color2={frame.color2} />
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Camera className="w-5 h-5 text-white" />
              </button>
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <p className={cn("text-sm font-bold", npClassName)} style={npStyle}>@{user?.username}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{user?.email}</p>
              {avatarPreview && (
                <p className="text-xs text-[var(--online-text)] mt-1 font-mono">[✓] {t("settings.account.newAvatarHint")}</p>
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
                onChange={(e) => setFormData((d) => ({ ...d, displayName: e.target.value }))}
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
                  onChange={(e) => setFormData((d) => ({ ...d, username: e.target.value }))}
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
              readOnly
              disabled
              aria-label="Your login email is managed by your account and can't be changed here."
              className="input-terminal opacity-60 cursor-not-allowed"
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
              onChange={(e) => setFormData((d) => ({ ...d, pronouns: e.target.value }))}
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
              onChange={(e) => setFormData((d) => ({ ...d, bio: e.target.value }))}
              rows={4}
              className="w-full bg-transparent border-b border-[var(--border)] focus:border-[var(--text-primary)] focus:outline-none text-sm text-[var(--text-primary)] font-mono py-2 resize-none transition-colors placeholder:text-[var(--text-muted)]"
              placeholder={t("settings.account.aboutMePlaceholder")}
            />
          </div>
        </div>

        {message && (
          <p className={cn(
            "text-sm font-mono animate-fade-in",
            message.type === "success" ? "text-[var(--online-text)]" : "text-[var(--accent-red-text)]",
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
            className="text-sm font-mono text-[var(--accent-red-text)] hover:text-[var(--text-primary)] transition-colors"
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

      <div className="mt-8 pt-6 border-t border-dashed border-[var(--border)] space-y-4">
        <SectionHeader title={t("settings.cosmetics.title")} subtitle={t("settings.cosmetics.subtitle")} />
        <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)]">
          <InventorySection />
        </div>
      </div>
    </div>
  );
}
