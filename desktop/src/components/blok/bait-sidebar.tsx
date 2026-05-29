import { Zap, History, Hash, Volume2 } from "lucide-react";
import { FishHookIcon } from "./fish-hook-icon";
import { useServerStore } from "@/lib/store/server-store";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n";

const QUICK_COMMAND_KEYS: TranslationKey[] = [
  "bait.cmd.createServer",
  "bait.cmd.translate",
  "bait.cmd.poll",
  "bait.cmd.announce",
  "bait.cmd.channel",
];

export function BaitSidebar() {
  const { t } = useI18n();
  const { activeServerId, activeChannelId, servers, channels } = useServerStore();

  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeChannel = activeServerId
    ? (channels[activeServerId] ?? []).find((c) => c.id === activeChannelId)
    : null;

  return (
    <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col flex-shrink-0">
      <div className="px-3 py-3 border-b border-[var(--border)] flex items-center gap-2">
        <FishHookIcon className="w-4 h-4 text-[var(--accent-red)]" />
        <span className="text-sm font-mono font-medium text-[var(--text-primary)]">$Bait</span>
        <span className="cursor-blink inline-block w-1 h-3.5 bg-[var(--text-primary)] ml-0.5" />
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">

        {activeServer && (
          <div>
            <p className="px-1 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono font-medium">
              {t("bait.context")}
            </p>
            <div className="bg-[var(--bg-elevated)] rounded-lg px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span className="font-mono">@</span>
                <span className="text-[var(--text-primary)] truncate">{activeServer.name}</span>
              </div>
              {activeChannel && (
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  {activeChannel.type === "voice" ? (
                    <Volume2 className="w-3 h-3 shrink-0" />
                  ) : (
                    <Hash className="w-3 h-3 shrink-0" />
                  )}
                  <span className="truncate">{activeChannel.name}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <p className="px-1 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono font-medium flex items-center gap-1">
            <Zap className="w-3 h-3" /> {t("bait.quickCommands")}
          </p>
          <div className="space-y-0.5">
            {QUICK_COMMAND_KEYS.map((key) => (
              <button
                key={key}
                disabled
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-md text-xs font-mono text-[var(--text-muted)]",
                  "cursor-not-allowed opacity-60",
                )}
              >
                <span className="text-[var(--accent-red)] mr-1">$</span>{t(key)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="px-1 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono font-medium flex items-center gap-1">
            <History className="w-3 h-3" /> {t("bait.history")}
          </p>
          <div className="px-2 py-3 text-center">
            <p className="text-[10px] text-[var(--text-muted)] font-mono">{t("bait.noHistory")}</p>
          </div>
        </div>

      </div>
    </div>
  );
}
