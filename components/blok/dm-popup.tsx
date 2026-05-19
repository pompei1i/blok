'use client';

import { useRef, useState, useEffect } from 'react';
import { X, Minus, Send, Smile } from 'lucide-react';
import { useDMStore } from '@/lib/store/dm-store';
import { useFriendsStore } from '@/lib/store/friends-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { UserAvatar } from './user-avatar';
import { PresenceDot } from './presence-dot';
import { MessageBubble } from './message-bubble';
import { cn } from '@/lib/utils';
import type { DMWindowState } from '@/lib/store/types';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
import { useIsMobile } from '@/hooks/use-mobile';

interface DMPopupProps {
  dmState: DMWindowState;
}

export function DMPopup({ dmState }: DMPopupProps) {
  const { closeDM, minimizeDM, restoreDM, updatePosition, addMessage, clearUnread } = useDMStore();
  const { friends, presence } = useFriendsStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  const friend = friends.find(f => f.friendId === dmState.userId)?.friend;
  const friendPresence = presence[dmState.userId] || 'offline';

  useEffect(() => {
    if (!dmState.minimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      clearUnread(dmState.userId);
    }
  }, [dmState.messages, dmState.minimized, dmState.userId, clearUnread]);

  const handleSendMessage = () => {
    if (!inputValue.trim() || !user) return;

    const newMessage = {
      id: `dm${Date.now()}`,
      fromUserId: user.id,
      toUserId: dmState.userId,
      content: inputValue.trim(),
      createdAt: new Date().toISOString(),
    };

    addMessage(dmState.userId, newMessage);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleDragStop = (_e: DraggableEvent, data: DraggableData) => {
    updatePosition(dmState.userId, { x: data.x, y: data.y });
  };

  if (dmState.minimized) {
    return (
      <button
        onClick={() => restoreDM(dmState.userId)}
        className="fixed bottom-16 right-4 flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-full px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors shadow-lg z-50"
        style={{ right: `${16 + (Object.keys(useDMStore.getState().openDMs).indexOf(dmState.userId) * 150)}px` }}
      >
        <div className="relative">
          <UserAvatar user={friend} size="sm" />
          <PresenceDot 
            status={friendPresence} 
            size="sm" 
            className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-elevated)]"
          />
        </div>
        <span className="text-sm text-[var(--text-primary)]">@{friend?.username}</span>
        {dmState.unreadCount > 0 && (
          <span className="bg-[var(--accent-red)] text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
            {dmState.unreadCount}
          </span>
        )}
      </button>
    );
  }

  if (isMobile) {
    return (
      <div className="fixed left-4 right-4 top-[10vh] h-[75vh] bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden animate-slide-in">
        <div className="dm-header flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
          <div className="relative">
            <PresenceDot status={friendPresence} size="md" />
          </div>
          <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
            @{friend?.username}
          </span>
          <button onClick={() => minimizeDM(dmState.userId)} className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
            <Minus className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
          <button onClick={() => closeDM(dmState.userId)} className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[var(--bg-base)]">
          {dmState.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <UserAvatar user={friend} size="xl" className="mb-3" />
              <p className="text-sm text-[var(--text-primary)] font-medium">@{friend?.username}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Start a conversation</p>
            </div>
          ) : (
            <>
              {dmState.messages.map((message) => (
                <MessageBubble key={message.id} message={message} user={message.fromUserId === user?.id ? user : friend} isOwn={message.fromUserId === user?.id} showAvatar isDM />
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
        <div className="p-2 border-t border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)] px-2 py-1.5">
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={`Message @${friend?.username}`} className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none" />
            <button onClick={handleSendMessage} disabled={!inputValue.trim()} className={cn('p-1 rounded transition-colors', inputValue.trim() ? 'bg-[var(--accent-red)] hover:opacity-90 text-white' : 'text-[var(--text-muted)]')}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Draggable
      nodeRef={nodeRef}
      handle=".dm-header"
      defaultPosition={dmState.position}
      onStop={handleDragStop}
      bounds="parent"
    >
      <div
        ref={nodeRef}
        className="fixed w-[21.25rem] h-[26.25rem] bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden animate-slide-in"
      >
        {/* Header */}
        <div className="dm-header flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] cursor-move bg-[var(--bg-elevated)]">
          <div className="relative">
            <PresenceDot status={friendPresence} size="md" />
          </div>
          <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
            @{friend?.username}
          </span>
          <button
            onClick={() => minimizeDM(dmState.userId)}
            className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
          >
            <Minus className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
          <button
            onClick={() => closeDM(dmState.userId)}
            className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
          >
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[var(--bg-base)]">
          {dmState.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <UserAvatar user={friend} size="xl" className="mb-3" />
              <p className="text-sm text-[var(--text-primary)] font-medium">
                @{friend?.username}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Start a conversation
              </p>
            </div>
          ) : (
            <>
              {dmState.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  user={message.fromUserId === user?.id ? user : friend}
                  isOwn={message.fromUserId === user?.id}
                  showAvatar={true}
                  isDM
                />
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="p-2 border-t border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)] px-2 py-1.5">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message @${friend?.username}`}
              className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
            />
            <button className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
              <Smile className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim()}
              className={cn(
                'p-1 rounded transition-colors',
                inputValue.trim()
                  ? 'bg-[var(--accent-red)] hover:opacity-90 text-white'
                  : 'text-[var(--text-muted)]'
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </Draggable>
  );
}
