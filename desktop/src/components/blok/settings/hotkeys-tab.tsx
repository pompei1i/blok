import { useI18n } from "@/lib/i18n";
import { SectionHeader } from "./section-header";
import type { DraftTabProps } from "./types";

/** Push-to-talk toggle + read-only shortcut reference. */
export function HotkeysTab({ draft, setDraft }: DraftTabProps) {
  const { t } = useI18n();

  return (
    <div className="max-w-2xl animate-fade-in space-y-5">
      <SectionHeader title={t("settings.hotkeys.title")} subtitle={t("settings.hotkeys.subtitle")} />
      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-4">
        <label className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.hotkeys.pushToTalk")}</span>
          <input
            type="checkbox"
            checked={draft.pushToTalk}
            onChange={(e) => setDraft((prev) => ({ ...prev, pushToTalk: e.target.checked }))}
          />
        </label>
        <div className="grid grid-cols-2 gap-3 text-xs font-mono">
          <div className="bg-[var(--bg-base)] border border-dashed border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">{t("settings.hotkeys.muteUnmute")}</div>
          <div className="bg-[var(--bg-base)] border border-[var(--border)] px-3 py-2 text-[var(--text-primary)]">Ctrl + Shift + M</div>
          <div className="bg-[var(--bg-base)] border border-dashed border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">{t("settings.hotkeys.deafenUndeafen")}</div>
          <div className="bg-[var(--bg-base)] border border-[var(--border)] px-3 py-2 text-[var(--text-primary)]">Ctrl + Shift + D</div>
          <div className="bg-[var(--bg-base)] border border-dashed border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">{t("settings.hotkeys.toggleOverlay")}</div>
          <div className="bg-[var(--bg-base)] border border-[var(--border)] px-3 py-2 text-[var(--text-primary)]">Ctrl + Shift + O</div>
        </div>
      </div>
    </div>
  );
}
