import { FishHookIcon } from "./fish-hook-icon";
import { useServerStore } from "@/lib/store/server-store";
import { useBaitStore } from "@/lib/store/bait-store";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";

const QUICK_COMMANDS: { key: TranslationKey; prompt: string }[] = [
  { key: "bait.cmd.summarize",    prompt: "Summarize the recent messages in the current channel for me." },
  { key: "bait.cmd.createServer", prompt: "Create a new server for me. Ask me for the name." },
  { key: "bait.cmd.translate",    prompt: "I want to translate a message. Ask me what text to translate and into which language." },
  { key: "bait.cmd.poll",         prompt: "Create a poll in the current channel. Ask me for the question and answer options." },
  { key: "bait.cmd.announce",     prompt: "Send an announcement to the current channel. Ask me what the announcement should say." },
  { key: "bait.cmd.channel",      prompt: "Create a new channel in the current server. Ask me for the channel name and type (text or voice)." },
];

export function BaitSidebar() {
  const { t } = useI18n();
  const { activeServerId, activeChannelId, servers, channels } = useServerStore();
  const { sendMessage, messagesByServer } = useBaitStore();
  const messages = messagesByServer[activeServerId ?? "_global"] ?? [];

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
              <span className="mr-1 text-[var(--text-muted)] opacity-60">$</span>{t("bait.context")}
            </p>
            <div className="border border-dashed border-[var(--border)] px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-mono">
                <span>@</span>
                <span className="text-[var(--text-primary)] truncate">{activeServer.name}</span>
              </div>
              {activeChannel && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-mono">
                  <span>{activeChannel.type === "voice" ? "♪" : "#"}</span>
                  <span className="truncate">{activeChannel.name}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <p className="px-1 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono font-medium">
            <span className="mr-1 text-[var(--text-muted)] opacity-60">$</span>{t("bait.quickCommands")}
          </p>
          <div className="space-y-1">
            {QUICK_COMMANDS.map(({ key, prompt }) => (
              <button
                key={key}
                onClick={() => sendMessage(prompt)}
                className="w-full text-left px-2 py-1.5 text-xs font-mono text-[var(--text-muted)] transition-all duration-150 border border-dashed border-[var(--border)] hover:border-solid hover:border-white/30 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <span className="text-[var(--accent-red)] mr-1">$</span>{t(key)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="px-1 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono font-medium">
            <span className="mr-1 text-[var(--text-muted)] opacity-60">$</span>{t("bait.history")}
          </p>
          <div className="px-2 py-2">
            <p className="text-[10px] text-[var(--text-muted)] font-mono">
              {messages.length > 0 ? `${messages.length} messages` : t("bait.noHistory")}
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
