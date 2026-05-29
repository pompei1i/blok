import { Send } from "lucide-react";
import { FishHookIcon } from "./fish-hook-icon";
import { useI18n } from "@/lib/i18n";

export function BaitView() {
  const { t } = useI18n();
  return (
    <div className="flex-1 bg-[var(--bg-base)] flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center gap-2">
        <FishHookIcon className="w-4 h-4 text-[var(--accent-red)]" />
        <span className="text-sm font-medium text-[var(--text-primary)]">bait</span>
        <span className="text-xs text-[var(--text-muted)] font-mono">{t("bait.description")}</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-3 mt-[1px]">
        <span className="text-2xl font-mono font-semibold text-[var(--text-muted)] opacity-20">$bait</span>
        <p className="text-xs text-[var(--text-muted)] font-mono">{t("bait.comingSoon")}</p>
      </div>

      <div className="px-6 py-5 border-t border-[var(--border)]">
        <div className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 opacity-50">
          <input
            disabled
            placeholder={t("bait.placeholder")}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] cursor-not-allowed py-[2px]"
          />
          <Send className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
      </div>
    </div>
  );
}
