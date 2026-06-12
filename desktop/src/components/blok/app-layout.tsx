import { GroupSidebar } from "./group-sidebar";
import { BaitSidebar } from "./bait-sidebar";
import { useBaitStore } from "@/lib/store/bait-store";
import { ChatArea } from "./chat-area";
import { DMPortal } from "./dm-portal";
import { TopBar } from "./top-bar";
import { ScreenShareOverlay } from "./screen-share-overlay";
import { VideoCallOverlay } from "./video-call-overlay";
import { IncomingCallBanner } from "./incoming-call-banner";
import { OfflineBanner } from "./offline-banner";
import { RightSidebar } from "./right-sidebar";
import { ToastHost } from "./toast-host";
import { useUiSettingsStore } from "@/lib/store/ui-settings-store";
import { useServerStore } from "@/lib/store/server-store";
import { useFriendsStore } from "@/lib/store/friends-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useEconomyStore } from "@/lib/store/economy-store";
import { useQuestsStore } from "@/lib/store/quests-store";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

export function AppLayout() {
  const { t } = useI18n();
  const showMemberList = useUiSettingsStore((state) => state.showMemberList);
  const isBaitActive = useBaitStore((s) => s.isActive);
  const { initData: initServerData } = useServerStore();
  const { initFriendsData, updatePresence } = useFriendsStore();
  const { initDMData } = useDMStore();
  const loadEconomy = useEconomyStore((s) => s.loadEconomy);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const loadQuests = useQuestsStore((s) => s.loadQuests);
  const { user } = useAuthStore();
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  // Keep the quest progress subscription always live (per active server) so
  // completion toasts fire even when the quests panel was never opened.
  useEffect(() => {
    if (user?.id && activeServerId) void loadQuests(user.id, activeServerId);
  }, [user?.id, activeServerId, loadQuests]);

  useEffect(() => {
    let isCancelled = false;

    const bootstrapData = async () => {
      if (!user) {
        if (!isCancelled) setIsBootstrapping(false);
        return;
      }

      if (!isCancelled) setIsBootstrapping(true);

      await Promise.all([
        initServerData(user.id),
        initFriendsData(user.id),
        initDMData(user.id),
        loadEconomy(user.id),
      ]);

      void updatePresence(user.id, "online");

      if (!isCancelled) setIsBootstrapping(false);
    };

    void bootstrapData();

    return () => {
      isCancelled = true;
    };
  // Depend on user?.id (not the full user object) so profile edits don't
  // trigger a full re-bootstrap — only login/logout should.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, initServerData, initFriendsData, initDMData, loadEconomy, updatePresence]);

  if (isBootstrapping) {
    return (
      <div className="h-screen flex bg-[var(--bg-base)] items-center justify-center">
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute left-0 top-0 w-24 h-full terminal-grid opacity-30" />
          <div className="absolute right-0 top-0 w-24 h-full terminal-grid opacity-30" />
        </div>
        <div className="relative z-10 text-center text-[var(--text-muted)] font-mono text-sm">
          <span className="cursor-blink mr-2">$</span> {t("app.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[var(--bg-base)] overflow-hidden">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute left-0 top-0 w-24 h-full terminal-grid opacity-30" />
        <div className="absolute right-0 top-0 w-24 h-full terminal-grid opacity-30" />
      </div>

      {/* Main App Container */}
      <div className="relative z-10 flex flex-1 h-full w-full flex-col">
        <OfflineBanner />
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          {isBaitActive ? <BaitSidebar /> : <GroupSidebar />}
          <ChatArea />
          {showMemberList && (
            <div className="hidden min-[800px]:contents">
              <RightSidebar />
            </div>
          )}
        </div>
      </div>

      <DMPortal />
      <ScreenShareOverlay />
      <VideoCallOverlay />
      <IncomingCallBanner />
      <ToastHost />
    </div>
  );
}
