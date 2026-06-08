import { useEffect, useRef, useState } from "react";
import { FishHookIcon } from "./fish-hook-icon";
import { useI18n } from "@/lib/i18n";
import { useBaitStore } from "@/lib/store/bait-store";
import { useServerStore } from "@/lib/store/server-store";
import { cn } from "@/lib/utils";

export function BaitView() {
  const { t } = useI18n();
  const { messagesByServer, isLoading, sendMessage, clearHistory } = useBaitStore();
  const { activeServerId } = useServerStore();
  const messages = messagesByServer[activeServerId ?? "_global"] ?? [];

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 bg-[var(--bg-base)] flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center gap-2 flex-shrink-0">
        <FishHookIcon className="w-4 h-4 text-[var(--accent-red)]" />
        <span className="text-sm font-mono font-semibold text-[var(--text-primary)] tracking-wider">
          <span className="text-[var(--text-muted)] font-normal">$ </span>b.ai.t
        </span>
        <span className="text-xs text-[var(--text-muted)] font-mono">{t("bait.description")}</span>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="ml-auto text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors border border-dashed border-[var(--border)] hover:border-solid hover:border-white/30 px-2 py-0.5"
          >
            clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-start justify-end h-full pb-2">
            <div className="border-l-2 border-[var(--border)] pl-4 space-y-1">
              <p className="text-[10px] text-[var(--text-muted)] font-mono">~/blok/b.ai.t</p>
              <p className="text-sm font-mono font-semibold text-[var(--text-muted)] opacity-40">
                <span className="font-normal">$ </span>{t("bait.placeholder")}
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={cn("flex flex-col gap-1", msg.role === "user" ? "items-end" : "items-start")}>
              {msg.toolResults && msg.toolResults.map((r, i) => (
                <span key={i} className="text-[10px] font-mono text-[var(--accent-red)] opacity-70">[✓] {r}</span>
              ))}
              {msg.content && (
                <div
                  className={cn(
                    "max-w-[85%] px-3 py-2 text-sm font-mono border",
                    msg.role === "user"
                      ? "border-[var(--text-muted)]/40 text-[var(--text-primary)] text-right"
                      : "border-dashed border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  )}
                >
                  {msg.role === "user" ? (
                    <><span className="text-[var(--text-muted)] mr-1">&gt;</span>{msg.content}</>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex items-start">
            <div className="bg-[var(--bg-surface)] border border-dashed border-[var(--border)] px-3 py-2 font-mono text-xs text-[var(--text-muted)]">
              $ <span className="cursor-blink">_</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="px-6 py-4 border-t border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-3 border-b border-[var(--border)] focus-within:border-white transition-colors pb-1">
          <span className="text-[var(--text-muted)] font-mono text-sm flex-shrink-0">&gt;</span>
          <input
            disabled={isLoading}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("bait.placeholder")}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[#444] font-mono disabled:cursor-not-allowed py-1"
          />
          <button
            disabled={isLoading || !input.trim()}
            onClick={handleSend}
            className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            [send]
          </button>
        </div>
      </div>
    </div>
  );
}
