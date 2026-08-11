import type { Language } from "@/lib/store/ui-settings-store";
import { useI18n } from "@/lib/i18n";
import { SectionHeader } from "./section-header";
import type { DraftTabProps } from "./types";

/** UI language selection. */
export function LanguageTab({ draft, setDraft }: DraftTabProps) {
  const { t } = useI18n();

  return (
    <div className="max-w-2xl animate-fade-in space-y-5">
      <SectionHeader title={t("settings.language.title")} subtitle={t("settings.language.subtitle")} />
      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)]">
        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.language.label")}
          </span>
          <select
            value={draft.language}
            onChange={(e) => setDraft((prev) => ({ ...prev, language: e.target.value as Language }))}
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

      <SectionHeader title={t("settings.translation.title")} subtitle={t("settings.translation.subtitle")} />
      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-3">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm text-[var(--text-primary)] font-mono">
            {t("settings.translation.autoTranslate")}
          </span>
          <input
            type="checkbox"
            checked={draft.autoTranslate}
            onChange={(e) => setDraft((prev) => ({ ...prev, autoTranslate: e.target.checked }))}
          />
        </label>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {t("settings.translation.hint")}
        </p>
      </div>
    </div>
  );
}
