import { useRef } from "react";
import type { ThemeMode } from "@/lib/store/ui-settings-store";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SectionHeader } from "./section-header";
import type { DraftTabProps } from "./types";

/** Base theme, chat background image, custom CSS. */
export function ThemeTab({ draft, setDraft }: DraftTabProps) {
  const { t } = useI18n();
  const chatBgInputRef = useRef<HTMLInputElement>(null);

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
      setDraft((prev) => ({ ...prev, chatBackground: canvas.toDataURL("image/jpeg", 0.82) }));
    };
    img.src = objectUrl;
  };

  return (
    <div className="max-w-2xl animate-fade-in space-y-5">
      <SectionHeader title={t("settings.theme.title")} subtitle={t("settings.theme.subtitle")} />

      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-4">
        <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          <span className="mr-1">&gt;</span>{t("settings.theme.baseTheme")}
        </span>
        <div className="flex gap-2">
          {(["dark", "light", "custom"] as ThemeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, themeMode: mode }))}
              className={cn(
                "px-4 py-2 border text-xs font-mono capitalize transition-all duration-150",
                draft.themeMode === mode
                  ? "border-[var(--text-primary)] text-[var(--text-primary)] bg-[var(--bg-elevated)]"
                  : "border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-solid hover:border-[var(--text-primary)]/30 hover:text-[var(--text-primary)]",
              )}
            >
              {draft.themeMode === mode ? "[✓] " : "> "}{mode}
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
            style={draft.chatBackground ? { backgroundImage: `url("${draft.chatBackground}")` } : undefined}
          />
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => chatBgInputRef.current?.click()} className="btn-terminal text-xs px-3 py-1">
              {t("settings.theme.chatBackgroundUpload")}
            </button>
            {draft.chatBackground && (
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, chatBackground: "" }))}
                className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--accent-red-text)] transition-colors text-left"
              >
                [rm]
              </button>
            )}
          </div>
          <input ref={chatBgInputRef} type="file" accept="image/*" className="hidden" onChange={handleChatBgChange} />
        </div>
        <input
          type="text"
          value={draft.chatBackground.startsWith("data:") ? "" : draft.chatBackground}
          onChange={(e) => setDraft((prev) => ({ ...prev, chatBackground: e.target.value }))}
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
          value={draft.customCss}
          onChange={(e) => setDraft((prev) => ({ ...prev, customCss: e.target.value }))}
          rows={12}
          spellCheck={false}
          placeholder={`/* Example: change accent color */\n:root {\n  --accent-red: #0ac000;\n}\n\n/* Hide scrollbars */\n* { scrollbar-width: none; }`}
          className="w-full bg-transparent border border-dashed border-[var(--border)] focus:border-solid focus:border-[var(--text-primary)] focus:outline-none px-3 py-2 text-sm text-[var(--text-primary)] font-mono resize-none transition-colors placeholder:text-[var(--text-muted)]"
        />
      </div>
    </div>
  );
}
