import { useMemo, useState } from "react";
import { X, Plus, Hash } from "lucide-react";
import { FishHookIcon } from "./fish-hook-icon";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { CreateServerModal } from "./create-server-modal";
import { useBaitStore } from "@/lib/store/bait-store";

export function TopBar() {
  const { servers, openTabs, activeServerId, setActiveServer, closeTab, openTab, channels, unreadCounts, joinByInviteCode } =
    useServerStore();
  const { user } = useAuthStore();
  const [showAllOpen, setShowAllOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinStatus, setJoinStatus] = useState<"idle" | "loading" | "error">("idle");
  const [joinError, setJoinError] = useState("");
  const { t } = useI18n();
  const { isTabOpen: isBaitTabOpen, isActive: isBaitActive, closeTab: closeBaitTab, activate: activateBait, deactivate: deactivateBait } = useBaitStore();

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

  const openServers = servers.filter((s) => openTabs.includes(s.id));
  const closedServers = useMemo(
    () => servers.filter((s) => !openTabs.includes(s.id)),
    [servers, openTabs],
  );

  return (
    <div className="h-10 bg-[var(--bg-surface)] border-b border-[var(--border)] flex items-center px-2 gap-1">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {isBaitTabOpen && (
          <div
            className={cn(
              "flex items-center gap-1 px-1 py-1 rounded-full text-xs font-medium transition-all duration-120",
              isBaitActive
                ? "bg-[var(--bg-elevated)] border border-[var(--border)]"
                : "text-[var(--text-muted)]",
            )}
          >
            <button
              onClick={() => { activateBait(); }}
              className={cn(
                "flex items-center gap-2 px-2 py-0.5 rounded-full hover:bg-[var(--bg-hover)]",
                isBaitActive ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]",
              )}
            >
              <FishHookIcon className="w-3 h-3" />
              <span>bait</span>
            </button>
            <button
              onClick={closeBaitTab}
              className="hover:text-[var(--text-primary)] p-1 rounded"
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
          return (
          <div
            key={server.id}
            className={cn(
              "flex items-center gap-1 px-1 py-1 rounded-full text-xs font-medium transition-all duration-120",
              activeServerId === server.id
                ? "bg-[var(--bg-elevated)] border border-[var(--border)]"
                : "text-[var(--text-muted)]",
            )}
          >
            <button
              onClick={() => { setActiveServer(server.id); deactivateBait(); }}
              className={cn(
                "flex items-center gap-2 px-2 py-0.5 rounded-full",
                "hover:bg-[var(--bg-hover)]",
                activeServerId === server.id
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-muted)]",
              )}
            >
              <span className="text-[var(--text-muted)]">@</span>
              <span className="max-w-[100px] truncate">{server.name}</span>
              {serverUnread > 0 && activeServerId !== server.id && (
                <span className="min-w-[16px] h-4 flex items-center justify-center bg-[var(--accent-red)] rounded-full text-[10px] text-white font-bold px-1">
                  {serverUnread > 99 ? "99+" : serverUnread}
                </span>
              )}
            </button>
            <button
              onClick={() => closeTab(server.id)}
              className="hover:text-[var(--text-primary)] p-1 rounded"
              aria-label={`Close ${server.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          );
        })}
      </div>

      {closedServers.length > 0 && (
        <div className="flex items-center gap-1 border-l border-[var(--border)] pl-2 ml-1">
          {closedServers.slice(0, 2).map((server) => (
              <button
                key={server.id}
                onClick={() => {
                  openTab(server.id);
                  setActiveServer(server.id);
                  deactivateBait();
                }}
                className="px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
              >
                + {server.name}
              </button>
            ))}
        </div>
      )}

      <div className="relative ml-2 flex items-center gap-2">
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--accent-red)] text-white hover:opacity-90 font-medium transition-opacity"
        >
          <Plus className="w-3 h-3" /> {t("topBar.createServer")}
        </button>
        <button
          onClick={() => { setShowJoinModal(true); setJoinCode(""); setJoinStatus("idle"); setJoinError(""); }}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Hash className="w-3 h-3" /> {t("invite.joinByCode")}
        </button>
        <button
          onClick={() => setShowAllOpen((v) => !v)}
          className="px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          {t("topBar.opened")} ({openServers.length})
        </button>
        {showAllOpen && (
          <div className="absolute right-0 top-full mt-2 w-72 max-h-72 overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl z-30 p-2">
            {openServers.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">{t("topBar.noOpenedGroups")}</div>
            ) : (
              openServers.map((server) => (
                <div key={server.id} className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setActiveServer(server.id);
                      setShowAllOpen(false);
                    }}
                    className={cn(
                      "flex-1 text-left px-3 py-2 rounded-lg text-xs transition-colors",
                      activeServerId === server.id
                        ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                    )}
                  >
                    @{server.name}
                  </button>
                  <button
                    onClick={() => closeTab(server.id)}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 ml-auto pl-4">
        <div className="text-xs text-[var(--text-muted)] font-mono">
          {"~/blok"}
          <span className="cursor-blink inline-block w-2 h-4 bg-[var(--text-primary)] ml-1" />
        </div>
      </div>
      
      {showCreateModal && <CreateServerModal onClose={() => setShowCreateModal(false)} />}

      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[340px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-[var(--accent-red)]" />
                <span className="font-semibold text-sm text-[var(--text-primary)]">{t("invite.joinByCode")}</span>
              </div>
              <button onClick={() => setShowJoinModal(false)} className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
                <X className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            </div>
            <div className="px-4 py-4 space-y-4">
              <input
                autoFocus
                type="text"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); if (joinStatus !== "idle") { setJoinStatus("idle"); setJoinError(""); } }}
                onKeyDown={(e) => { if (e.key === "Enter") void handleJoin(); if (e.key === "Escape") setShowJoinModal(false); }}
                placeholder={t("invite.enterCode")}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
              />
              {joinError && (
                <p className="text-xs text-[var(--destructive)] font-mono">{joinError}</p>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowJoinModal(false)} className="flex-1 px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors">
                  {t("topBar.cancel")}
                </button>
                <button
                  onClick={() => void handleJoin()}
                  disabled={!joinCode.trim() || joinStatus === "loading"}
                  className={cn(
                    "flex-1 px-3 py-2 text-sm rounded-lg transition-colors font-medium",
                    joinCode.trim() && joinStatus !== "loading"
                      ? "bg-[var(--accent-red)] hover:opacity-90 text-white"
                      : "bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed"
                  )}
                >
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

