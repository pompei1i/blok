import { useMemo, useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { FishHookIcon } from "./fish-hook-icon";
import { CreateServerModal } from "./create-server-modal";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useBaitStore } from "@/lib/store/bait-store";

export function TopBar() {
  const { servers, openTabs, activeServerId, setActiveServer, closeTab, openTab, channels, unreadCounts, serverAccessOrder, joinByInviteCode } =
    useServerStore();
  const { user } = useAuthStore();
  const [showServersDropdown, setShowServersDropdown] = useState(false);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinStatus, setJoinStatus] = useState<"idle" | "loading" | "error">("idle");
  const [joinError, setJoinError] = useState("");
  const { t } = useI18n();

  const handleJoin = async () => {
    if (!joinCode.trim() || !user) return;
    setJoinStatus("loading");
    setJoinError("");
    const error = await joinByInviteCode(joinCode.trim(), user.id);
    if (error) {
      setJoinStatus("error");
      setJoinError(error);
    } else {
      setJoinStatus("idle");
      setJoinCode("");
      setShowJoinModal(false);
    }
  };
  const { isTabOpen: isBaitTabOpen, isActive: isBaitActive, closeTab: closeBaitTab, activate: activateBait, deactivate: deactivateBait } = useBaitStore();

  const openServers = useMemo(() => servers.filter((s) => openTabs.includes(s.id)), [servers, openTabs]);

  // Quick-open: recently accessed servers that aren't open as tabs (up to 2)
  const recentClosed = useMemo(() => {
    const openSet = new Set(openTabs);
    return serverAccessOrder
      .filter((id) => !openSet.has(id) && servers.some((s) => s.id === id))
      .slice(0, 2)
      .map((id) => servers.find((s) => s.id === id)!);
  }, [serverAccessOrder, openTabs, servers]);

  // All servers not yet open (for dropdown)
  const closedServers = useMemo(() => servers.filter((s) => !openTabs.includes(s.id)), [servers, openTabs]);

  return (
    <div className="h-10 bg-[var(--bg-surface)] border-b border-[var(--border)] flex items-center px-2 gap-1">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {isBaitTabOpen && (
          <div
            className={cn(
              "relative flex items-center gap-1 px-1 h-10 text-xs font-medium transition-all duration-120 border-b-2",
              isBaitActive
                ? "border-b-[var(--accent-red)] text-[var(--text-primary)]"
                : "border-b-transparent text-[var(--text-muted)]",
            )}
          >
            <button
              onClick={() => { activateBait(); }}
              className={cn(
                "flex items-center gap-2 px-2 py-0.5 hover:bg-[var(--bg-hover)]",
                isBaitActive ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]",
              )}
            >
              <FishHookIcon className="w-3 h-3" />
              <span>b.ai.t</span>
            </button>
            <button
              onClick={closeBaitTab}
              className="hover:text-[var(--text-primary)] p-1"
              aria-label={t("topBar.closeBait")}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        {openServers.map((server) => {
          const serverUnread = (channels[server.id] || []).reduce(
            (sum, ch) => sum + (unreadCounts[ch.id] ?? 0), 0
          );
          const isActive = activeServerId === server.id;
          return (
            <div
              key={server.id}
              className={cn(
                "relative flex items-center gap-1 px-1 h-10 text-xs font-medium transition-all duration-120 border-b-2",
                isActive
                  ? "border-b-[var(--accent-red)] text-[var(--text-primary)]"
                  : "border-b-transparent text-[var(--text-muted)]",
              )}
            >
              <button
                onClick={() => { setActiveServer(server.id); deactivateBait(); }}
                className={cn(
                  "flex items-center gap-2 px-2 py-0.5 hover:bg-[var(--bg-hover)]",
                  isActive ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]",
                )}
              >
                <span className="text-[var(--text-muted)]">@</span>
                <span className="max-w-[100px] truncate">{server.name}</span>
                {serverUnread > 0 && !isActive && (
                  <span className="min-w-[16px] h-4 flex items-center justify-center bg-[var(--accent-red)] text-[12px] text-white font-bold px-1">
                    {serverUnread > 99 ? "99+" : serverUnread}
                  </span>
                )}
              </button>
              <button
                onClick={() => closeTab(server.id)}
                className="hover:text-[var(--text-primary)] p-1"
                aria-label={`Close ${server.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Recently closed quick-open */}
      {recentClosed.length > 0 && (
        <div className="flex items-center gap-1 border-l border-[var(--border)] pl-2 ml-1">
          {recentClosed.map((server) => (
            <button
              key={server.id}
              onClick={() => { openTab(server.id); setActiveServer(server.id); deactivateBait(); }}
              className="px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors font-mono"
            >
              + {server.name}
            </button>
          ))}
        </div>
      )}

      {/* All servers dropdown + create/join */}
      <div className="flex items-center gap-1 ml-1 pl-1 border-l border-[var(--border)] shrink-0">
      <div className="relative">
        <button
          onClick={() => setShowServersDropdown((v) => !v)}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-xs border transition-colors font-mono",
            showServersDropdown
              ? "border-[var(--text-muted)] text-[var(--text-primary)] bg-[var(--bg-hover)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]",
          )}
        >
          <span>servers</span>
          <ChevronDown className={cn("w-3 h-3 transition-transform", showServersDropdown && "rotate-180")} />
        </button>
        {showServersDropdown && (
          <div
            className="absolute right-0 top-full mt-1 w-64 bg-[var(--bg-surface)] border border-[var(--border)] shadow-2xl z-30 py-1"
            onMouseLeave={() => setShowServersDropdown(false)}
          >
            {servers.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)] font-mono">no servers</div>
            ) : (
              <>
                {openServers.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[12px] text-[var(--text-muted)] uppercase tracking-wider font-mono opacity-60">open</div>
                    {openServers.map((server) => (
                      <div key={server.id} className="flex items-center gap-1 px-2">
                        <button
                          onClick={() => { setActiveServer(server.id); deactivateBait(); setShowServersDropdown(false); }}
                          className={cn(
                            "flex-1 text-left px-2 py-1.5 text-xs font-mono transition-colors",
                            activeServerId === server.id
                              ? "text-[var(--text-primary)]"
                              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                          )}
                        >
                          <span className="text-[var(--text-muted)] mr-1">@</span>{server.name}
                        </button>
                        <button
                          onClick={() => closeTab(server.id)}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {closedServers.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[12px] text-[var(--text-muted)] uppercase tracking-wider font-mono opacity-60 mt-1 border-t border-[var(--border)] pt-2">closed</div>
                    {closedServers.map((server) => (
                      <button
                        key={server.id}
                        onClick={() => { openTab(server.id); setActiveServer(server.id); deactivateBait(); setShowServersDropdown(false); }}
                        className="flex w-full text-left px-4 py-1.5 text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        + {server.name}
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
        <button
          onClick={() => setShowCreateServer(true)}
          title={t("topBar.createServer")}
          className="px-2 py-1 text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border)] hover:border-[var(--text-muted)]"
        >
          +
        </button>
        <button
          onClick={() => { setShowJoinModal(true); setJoinCode(""); setJoinStatus("idle"); setJoinError(""); }}
          title={t("invite.joinByCode")}
          className="px-2 py-1 text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border)] hover:border-[var(--text-muted)]"
        >
          #code
        </button>
      </div>

      <div className="flex items-center gap-1 ml-2 pl-2">
        <div className="text-xs text-[var(--text-muted)] font-mono">
          {"~/blok"}
          <span className="cursor-blink inline-block w-2 h-4 bg-[var(--text-primary)] ml-1" />
        </div>
      </div>

      {showCreateServer && <CreateServerModal onClose={() => setShowCreateServer(false)} />}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div role="dialog" aria-modal="true" aria-label={t("invite.joinByCode")} className="w-[340px] bg-[var(--bg-surface)] border border-[var(--border)] shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
              <span className="text-xs text-[var(--text-muted)] font-mono">~/blok $ {t("invite.joinByCode")}</span>
              <button onClick={() => setShowJoinModal(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] font-mono transition-colors">[esc]</button>
            </div>
            <div className="px-4 py-4 space-y-4">
              <input
                autoFocus
                type="text"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); if (joinStatus !== "idle") { setJoinStatus("idle"); setJoinError(""); } }}
                onKeyDown={(e) => { if (e.key === "Enter") void handleJoin(); if (e.key === "Escape") setShowJoinModal(false); }}
                placeholder={t("invite.enterCode")}
                className="input-terminal text-sm"
              />
              {joinError && <p className="prefix-error text-xs text-[var(--destructive)] font-mono">{joinError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowJoinModal(false)} className="flex-1 px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors border border-transparent hover:border-[var(--border)]">
                  {t("topBar.cancel")}
                </button>
                <button
                  onClick={() => void handleJoin()}
                  disabled={!joinCode.trim() || joinStatus === "loading"}
                  className={cn("flex-1 px-3 py-2 text-sm transition-colors font-medium text-center", joinCode.trim() && joinStatus !== "loading" ? "border border-[var(--accent-red)] text-[var(--accent-red)] hover:bg-[var(--accent-red)] hover:text-white" : "border border-[var(--border)] text-[var(--text-muted)] cursor-not-allowed opacity-50")}
                >
                  <span className="opacity-50">$ </span>
                  {joinStatus === "loading" ? t("invite.joining") : t("invite.join")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
