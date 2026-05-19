'use client';

import { useState } from 'react';
import { TopBar } from './top-bar';
import { GroupSidebar } from './group-sidebar';
import { ChatArea } from './chat-area';
import { FriendsSidebar } from './friends-sidebar';
import { UserBar } from './user-bar';
import { DMPortal } from './dm-portal';
import { useIsMobile } from '@/hooks/use-mobile';

export function AppLayout() {
  const isMobile = useIsMobile();
  const [showLeftDrawer, setShowLeftDrawer] = useState(false);
  const [showRightDrawer, setShowRightDrawer] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-base)] overflow-hidden">
      {/* Animated grid background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute left-0 top-0 w-24 h-full terminal-grid" />
        <div className="absolute right-0 top-0 w-24 h-full terminal-grid" />
      </div>

      {/* Mobile drawer backdrops */}
      {isMobile && showLeftDrawer && (
        <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowLeftDrawer(false)} />
      )}
      {isMobile && showRightDrawer && (
        <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowRightDrawer(false)} />
      )}

      {/* Mobile left drawer */}
      {isMobile && showLeftDrawer && (
        <div className="fixed inset-y-0 left-0 z-50 shadow-2xl">
          <GroupSidebar onDrawerClose={() => setShowLeftDrawer(false)} />
        </div>
      )}

      {/* Mobile right drawer */}
      {isMobile && showRightDrawer && (
        <div className="fixed inset-y-0 right-0 z-50 shadow-2xl">
          <FriendsSidebar onDrawerClose={() => setShowRightDrawer(false)} />
        </div>
      )}

      {/* Main app container */}
      <div className="relative z-10 flex flex-col h-full">
        <TopBar
          onOpenLeft={isMobile ? () => setShowLeftDrawer(true) : undefined}
          onOpenRight={isMobile ? () => setShowRightDrawer(true) : undefined}
        />

        <div className="flex flex-1 overflow-hidden">
          {!isMobile && <GroupSidebar />}
          <ChatArea />
          {!isMobile && <FriendsSidebar />}
        </div>

        <UserBar />
      </div>

      <DMPortal />
    </div>
  );
}
