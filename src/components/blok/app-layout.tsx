import { GroupSidebar } from "./group-sidebar";
import { ChatArea } from "./chat-area";
import { FriendsSidebar } from "./friends-sidebar";
import { DMPortal } from "./dm-portal";
import { TopBar } from "./top-bar";
import { ScreenShareOverlay } from "./screen-share-overlay";
import { OfflineBanner } from "./offline-banner";
import { useUiSettingsStore } from "@/lib/store/ui-settings-store";
import { useServerStore } from "@/lib/store/server-store";
import { useFriendsStore } from "@/lib/store/friends-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

export function AppLayout() {
  const showMemberList = useUiSettingsStore((state) => state.showMemberList);
  const { initData: initServerData } = useServerStore();
  const { initFriendsData } = useFriendsStore();
  const { initDMData } = useDMStore();
  const { user } = useAuthStore();
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  );
  const [showLeftDrawer, setShowLeftDrawer] = useState(false);
  const [showRightDrawer, setShowRightDrawer] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
      ]);

      if (!isCancelled) setIsBootstrapping(false);
    };

    void bootstrapData();

    return () => {
      isCancelled = true;
    };
  }, [user?.id, initServerData, initFriendsData, initDMData]);

  if (isBootstrapping) {
    return (
      <div className="h-screen flex bg-[var(--bg-base)] items-center justify-center">
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute left-0 top-0 w-24 h-full terminal-grid opacity-30" />
          <div className="absolute right-0 top-0 w-24 h-full terminal-grid opacity-30" />
        </div>
        <div className="relative z-10 text-center text-[var(--text-muted)] font-mono text-sm">
          <span className="cursor-blink mr-2">$</span> loading servers and chats...
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

      {/* Mobile drawer backdrops */}
      {isMobile && showLeftDrawer && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setShowLeftDrawer(false)}
        />
      )}
      {isMobile && showRightDrawer && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setShowRightDrawer(false)}
        />
      )}

      {/* Mobile left drawer */}
      {isMobile && showLeftDrawer && (
        <div className="fixed inset-y-0 left-0 z-50 shadow-2xl">
          <GroupSidebar onDrawerClose={() => setShowLeftDrawer(false)} />
        </div>
      )}

      {/* Mobile right drawer */}
      {isMobile && showRightDrawer && showMemberList && (
        <div className="fixed inset-y-0 right-0 z-50 shadow-2xl">
          <FriendsSidebar onDrawerClose={() => setShowRightDrawer(false)} />
        </div>
      )}

      {/* Main App Container */}
      <div className="relative z-10 flex flex-1 h-full w-full flex-col">
        <OfflineBanner />
        <TopBar
          onOpenLeft={isMobile ? () => setShowLeftDrawer(true) : undefined}
          onOpenRight={isMobile && showMemberList ? () => setShowRightDrawer(true) : undefined}
        />
        <div className="flex flex-1 overflow-hidden">
          {!isMobile && <GroupSidebar />}
          <ChatArea />
          {!isMobile && showMemberList && <FriendsSidebar />}
        </div>
      </div>

      <DMPortal />
      <ScreenShareOverlay />
    </div>
  );
}
