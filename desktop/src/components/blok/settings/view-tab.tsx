import { useI18n } from "@/lib/i18n";
import { SectionHeader } from "./section-header";
import type { DraftTabProps } from "./types";

/** Layout options: compact mode, member list, UI scale. */
export function ViewTab({ draft, setDraft }: DraftTabProps) {
  const { t } = useI18n();

  return (
    <div className="max-w-2xl animate-fade-in space-y-5">
      <SectionHeader title={t("settings.view.title")} subtitle={t("settings.view.subtitle")} />
      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
        <label className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.view.compactMode")}</span>
          <input
            type="checkbox"
            checked={draft.compactMode}
            onChange={(e) => setDraft((prev) => ({ ...prev, compactMode: e.target.checked }))}
          />
        </label>
        <label className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.view.showMemberList")}</span>
          <input
            type="checkbox"
            checked={draft.showMemberList}
            onChange={(e) => setDraft((prev) => ({ ...prev, showMemberList: e.target.checked }))}
          />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.view.uiScale")}: {draft.uiScale}%
          </span>
          <input
            type="range"
            min={80}
            max={120}
            value={draft.uiScale}
            onChange={(e) => setDraft((prev) => ({ ...prev, uiScale: Number(e.target.value) }))}
            className="w-full"
          />
        </label>
      </div>
    </div>
  );
}
