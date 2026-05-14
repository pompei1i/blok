import { GroupSidebar } from "./group-sidebar";
import { ChatArea } from "./chat-area";
import { FriendsSidebar } from "./friends-sidebar";
import { DMPortal } from "./dm-portal";
import { TopBar } from "./top-bar";
import { ScreenShareOverlay } from "./screen-share-overlay";
import { useUiSettingsStore } from "@/lib/store/ui-settings-store";
import { useServerStore } from "@/lib/store/server-store";
import { useFriendsStore } from "@/lib/store/friends-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useEffect, useState } from "react";

export function AppLayout() {
  const showMemberList = useUiSettingsStore((state) => state.showMemberList);
  const { initData: initServerData } = useServerStore();
  const { initFriendsData, updatePresence } = useFriendsStore();
  const { initDMData } = useDMStore();
  const { user } = useAuthStore();
  const [isBootstrapping, setIsBootstrapping] = useState(true);

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

      void updatePresence(user.id, "online");

      if (!isCancelled) setIsBootstrapping(false);
    };

    void bootstrapData();

    return () => {
      isCancelled = true;
    };
  }, [user, initServerData, initFriendsData, initDMData, updatePresence]);

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

      {/* Main App Container */}
      <div className="relative z-10 flex flex-1 h-full w-full flex-col">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <GroupSidebar />
          <ChatArea />
          {showMemberList && (
            <div className="hidden min-[800px]:contents">
              <FriendsSidebar />
            </div>
          )}
        </div>
      </div>

      <DMPortal />
      <ScreenShareOverlay />
    </div>
  );
}
