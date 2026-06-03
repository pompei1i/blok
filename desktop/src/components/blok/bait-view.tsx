import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { FishHookIcon } from "./fish-hook-icon";
import { useI18n } from "@/lib/i18n";
import { useBaitStore } from "@/lib/store/bait-store";
import { cn } from "@/lib/utils";

export function BaitView() {
  const { t } = useI18n();
  const { messages, isLoading, sendMessage, clearHistory } = useBaitStore();

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
        <span className="text-sm font-medium text-[var(--text-primary)]">b.ai.t</span>
        <span className="text-xs text-[var(--text-muted)] font-mono">{t("bait.description")}</span>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="ml-auto text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="text-2xl font-mono font-semibold text-[var(--text-muted)] opacity-20">$b.ai.t</span>
            <p className="text-xs text-[var(--text-muted)] font-mono">{t("bait.placeholder")}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={cn("flex flex-col gap-1", msg.role === "user" ? "items-end" : "items-start")}>
              {msg.toolResults && msg.toolResults.map((r, i) => (
                <span key={i} className="text-[10px] font-mono text-[var(--accent-red)] opacity-70">{r}</span>
              ))}
              {msg.content && (
                <div
                  className={cn(
                    "max-w-[85%] px-3 py-2 rounded-lg text-sm",
                    msg.role === "user"
                      ? "bg-[var(--accent-red)] text-white"
                      : "bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono border border-[var(--border)]"
                  )}
                >
                  {msg.content}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex items-start">
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="px-6 py-5 border-t border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2">
          <input
            disabled={isLoading}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("bait.placeholder")}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] py-[2px] disabled:cursor-not-allowed"
          />
          <button
            disabled={isLoading || !input.trim()}
            onClick={handleSend}
            className="text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
