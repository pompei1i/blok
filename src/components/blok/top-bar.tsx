import { useMemo, useState } from "react";
import { X, Plus, Menu, Users } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { CreateServerModal } from "./create-server-modal";

interface TopBarProps {
  onOpenLeft?: () => void;
  onOpenRight?: () => void;
}

export function TopBar({ onOpenLeft, onOpenRight }: TopBarProps) {
  const { servers, openTabs, activeServerId, setActiveServer, closeTab, openTab } =
    useServerStore();
  const [showAllOpen, setShowAllOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { t } = useI18n();

  const openServers = servers.filter((s) => openTabs.includes(s.id));
  const closedServers = useMemo(
    () => servers.filter((s) => !openTabs.includes(s.id)),
    [servers, openTabs],
  );

  return (
    <div className="h-10 bg-[var(--bg-surface)] border-b border-[var(--border)] flex items-center px-2 gap-1">
      {/* Mobile hamburger — channels */}
      {onOpenLeft && (
        <button
          onClick={onOpenLeft}
          className="p-1.5 hover:bg-[var(--bg-hover)] rounded transition-colors shrink-0"
          aria-label="Open channels"
        >
          <Menu className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      )}

      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {openServers.map((server) => (
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
              onClick={() => setActiveServer(server.id)}
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
            </button>
            <button
              onClick={() => closeTab(server.id)}
              className="hover:text-[var(--text-primary)] p-1 rounded"
              aria-label={`Close ${server.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {closedServers.length > 0 && (
        <div className="flex items-center gap-1 border-l border-[var(--border)] pl-2 ml-1">
          {closedServers.slice(0, 2).map((server) => (
              <button
                key={server.id}
                onClick={() => {
                  openTab(server.id);
                  setActiveServer(server.id);
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

      {!onOpenLeft && (
        <div className="flex items-center gap-1 ml-auto pl-4">
          <div className="text-xs text-[var(--text-muted)] font-mono">
            {"~/blok"}
            <span className="cursor-blink inline-block w-2 h-4 bg-[var(--text-primary)] ml-1" />
          </div>
        </div>
      )}

      {/* Mobile hamburger — friends */}
      {onOpenRight && (
        <button
          onClick={onOpenRight}
          className="p-1.5 hover:bg-[var(--bg-hover)] rounded transition-colors shrink-0"
          aria-label="Open friends"
        >
          <Users className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      )}
      
      {showCreateModal && <CreateServerModal onClose={() => setShowCreateModal(false)} />}
    </div>
  );
}

