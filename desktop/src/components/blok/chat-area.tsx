import { useRef, useLayoutEffect, useEffect, useState, useMemo } from "react";
import {
  Hash,
  Send,
  Smile,
  PlusCircle,
  AtSign,
  Paperclip,
  X,
  CornerUpLeft,
  Pin,
  ChevronDown,
  Search,
  BarChart2,
  Megaphone,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { MessageBubble } from "./message-bubble";
import { EmojiPicker } from "./emoji-picker";
import { GifPicker } from "./gif-picker";
import { MentionPicker } from "./mention-picker";
import { AtMentionDropdown } from "./at-mention-dropdown";
import { AttachmentPicker } from "./attachment-picker";
import { SearchModal } from "./search-modal";
import { PollCreator } from "./poll-creator";
import type { Message } from "@/lib/store/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useChatInput } from "@/hooks/useChatInput";
import { MESSAGE_GROUP_THRESHOLD_MS, HIGHLIGHT_FLASH_DURATION_MS } from "@/lib/constants";
import { can } from "@/lib/permission";
import { useBaitStore } from "@/lib/store/bait-store";
import { BaitView } from "./bait-view";
import { VoiceView } from "./voice-view";

const ASCII_BG = Array(80).fill(Array(52).fill("·").join("   ")).join("\n");

export function ChatArea() {
  const { t } = useI18n();
  const {
    activeServerId,
    activeChannelId,
    channels,
    messages,
    messagesLoading,
    typingUsers,
    members,
    roles,
    servers,
    userProfileCache,
    deleteMessage,
    editMessage,
    pinMessage,
    addReaction,
    removeReaction,
    loadMoreMessages,
    messagesAtStart,
    polls,
    createPoll,
    votePoll,
    setActiveChannel,
    activeVoiceChannelId,
  } = useServerStore();
  const { user } = useAuthStore();

  const isBaitActive = useBaitStore((s) => s.isActive);

  const activeServer = servers.find((s) => s.id === activeServerId) ?? null;

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevScrollHeightRef = useRef<number | null>(null);
  const isNearBottomRef = useRef(true);
  const prevChannelIdRef = useRef<string | null>(null);
  const [showPinnedList, setShowPinnedList] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);

  const chat = useChatInput({ activeChannelId, user });

  const serverChannels = useMemo(
    () => (activeServerId ? channels[activeServerId] ?? [] : []),
    [channels, activeServerId],
  );
  const activeChannel = useMemo(
    () => serverChannels.find((c) => c.id === activeChannelId),
    [serverChannels, activeChannelId],
  );
  const channelMessages = useMemo(
    () => (activeChannelId ? messages[activeChannelId] ?? [] : []),
    [messages, activeChannelId],
  );
  // O(1) lookup by id — replaces O(n) find() calls inside the virtualizer render loop.
  const messageIndex = useMemo(() => {
    const map = new Map<string, import("@/lib/store/types").Message>();
    for (const msg of channelMessages) map.set(msg.id, msg);
    return map;
  }, [channelMessages]);

  const typing = activeChannelId ? typingUsers[activeChannelId] ?? [] : [];
  const serverMembers = useMemo(
    () => (activeServerId ? members[activeServerId] ?? [] : []),
    [members, activeServerId],
  );
  // Keyed by userId for O(1) lookup in typingNames map below.
  const memberByUserId = useMemo(() => {
    const map = new Map<string, (typeof serverMembers)[number]>();
    for (const m of serverMembers) map.set(m.userId, m);
    return map;
  }, [serverMembers]);

  const myMember = memberByUserId.get(user?.id ?? "");
  const myRole = useMemo(
    () => myMember?.roleId
      ? (roles[activeServerId ?? ""] ?? []).find((r) => r.id === myMember!.roleId) ?? null
      : null,
    [myMember, roles, activeServerId],
  );
  const canPin = can("pin_message", { userId: user?.id, server: activeServer, role: myRole });
  const mentionableUsers = useMemo(
    () => serverMembers.map((m) => m.user).filter(Boolean) as import("@/lib/store/types").User[],
    [serverMembers],
  );
  const typingNames = useMemo(
    () => typing
      .filter((uid) => uid !== user?.id)
      .map((uid) => memberByUserId.get(uid)?.user?.username ?? "someone"),
    [typing, user?.id, memberByUserId],
  );
  const typingText =
    typingNames.length === 1
      ? `${typingNames[0]} is typing`
      : typingNames.length === 2
      ? `${typingNames[0]} and ${typingNames[1]} are typing`
      : typingNames.length > 2
      ? `${typingNames.slice(0, 2).join(", ")} and ${typingNames.length - 2} more are typing`
      : "";
  const pinnedMessages = useMemo(
    () => channelMessages.filter((m) => m.isPinned),
    [channelMessages],
  );
  const isAtStart = activeChannelId ? messagesAtStart.has(activeChannelId) : true;
  const isLoadingMore = activeChannelId ? messagesLoading.has(activeChannelId) : false;

  const virtualizer = useVirtualizer({
    count: channelMessages.length,
    getScrollElement: () => messagesContainerRef.current,
    // Content-aware estimate: avoids large layout shifts and incorrect scroll
    // position when jumping channels. measureElement self-corrects after render,
    // but the initial estimate determines scrollToIndex accuracy.
    estimateSize: (index) => {
      const msg = channelMessages[index];
      if (!msg) return 64;
      // Base: grouped message (no avatar header) is shorter than a new group.
      const prev = channelMessages[index - 1];
      const isGrouped = prev &&
        prev.authorId === msg.authorId &&
        new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < MESSAGE_GROUP_THRESHOLD_MS;
      let h = isGrouped ? 28 : 56;            // avatar row or compact continuation
      if (msg.replyToId) h += 36;             // reply preview bar
      if (msg.content) h += Math.ceil(msg.content.length / 62) * 22;
      if (msg.attachments?.length) h += msg.attachments.length * 108;
      if (msg.poll) h += 180;
      if ((msg.reactions?.length ?? 0) > 0) h += 32;
      return Math.min(h, 640);               // cap: prevent absurd estimates
    },
    overscan: 5,
  });

  useEffect(() => {
    if (activeChannelId !== prevChannelIdRef.current) {
      prevChannelIdRef.current = activeChannelId;
      isNearBottomRef.current = true;
      prevScrollHeightRef.current = null;
    }
  }, [activeChannelId]);

  // Ctrl+F / Cmd+F → open search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && activeChannelId) {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeChannelId]);

  useLayoutEffect(() => {
    if (prevScrollHeightRef.current !== null && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
    }
  }, [channelMessages.length]);

  useEffect(() => {
    if (isNearBottomRef.current && channelMessages.length > 0) {
      virtualizer.scrollToIndex(channelMessages.length - 1, { align: "end" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelMessages.length]);

  const handleLoadMore = async () => {
    if (!activeChannelId || !messagesContainerRef.current) return;
    prevScrollHeightRef.current = messagesContainerRef.current.scrollHeight;
    await loadMoreMessages(activeChannelId);
  };

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (el.scrollTop < 80 && !isAtStart && !isLoadingMore) {
      void handleLoadMore();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    chat.handleEmojiSelect(emoji);
    inputRef.current?.focus();
  };

  const handleMentionSelect = (mention: string) => {
    chat.handleMentionSelect(mention);
    inputRef.current?.focus();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      chat.closeAllPickers();
      chat.handleAttach(files);
    }
  };

  if (isBaitActive) {
    return <BaitView />;
  }

  if (activeVoiceChannelId && !activeChannel) {
    return <VoiceView />;
  }

  if (!activeChannel) {
    const noServer = !activeServerId;
    return (
      <div className="flex-1 bg-[var(--bg-base)] flex flex-col items-center justify-center">
        <div className="text-center animate-fade-in">
          <pre className="text-[var(--text-muted)] text-xs mb-4 font-mono">
{noServer ? `
  ╔══════════════════════════╗
  ║   SELECT A SERVER        ║
  ║   TO START CHATTING      ║
  ╚══════════════════════════╝
` : `
  ╔══════════════════════════╗
  ║   SELECT A CHANNEL       ║
  ║   TO START CHATTING      ║
  ╚══════════════════════════╝
`}
          </pre>
          <p className="text-sm text-[var(--text-muted)]">
            <span className="text-[var(--text-muted)]">$ </span>
            {t(noServer ? "chat.chooseServer" : "chat.chooseChannel")}
          </p>
        </div>
      </div>
    );
  }

  const scrollToMessage = (id: string) => {
    if (!messageIndex.has(id)) return;
    const idx = channelMessages.indexOf(messageIndex.get(id)!);
    if (idx === -1) return;
    virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
    setTimeout(() => {
      const el = messageRefs.current[id];
      if (el) {
        el.classList.add("highlight-flash");
        setTimeout(() => el.classList.remove("highlight-flash"), HIGHLIGHT_FLASH_DURATION_MS);
      }
    }, 200);
  };

  return (
    <div
      className="flex-1 bg-[var(--bg-base)] flex flex-col relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center bg-[var(--bg-base)]/80 backdrop-blur-sm">
          <div className="border-2 border-dashed border-[var(--accent-red)] px-12 py-8 text-center">
            <p className="text-[var(--accent-red)] font-mono text-sm">
              <span className="opacity-60">$ </span>drop to attach
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="h-12 border-b border-[var(--border)] flex items-center px-4 bg-[var(--bg-surface)]">
        <Hash className="w-5 h-5 text-[var(--text-muted)] mr-2" />
        <span className="font-medium text-[var(--text-primary)]">{activeChannel.name}</span>
        <div className="ml-2 h-4 w-px bg-[var(--border)]" />
        <span className="ml-2 text-sm text-[var(--text-muted)]">{t("chat.channelTopic")}</span>
        <button
          onClick={() => setIsSearchOpen(true)}
          className="ml-auto p-1.5 hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title={`${t("search.title").replace("{channel}", activeChannel.name)} (Ctrl+F)`}
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {/* Search modal */}
      {isSearchOpen && (
        <SearchModal
          serverId={activeServerId!}
          channelId={activeChannelId!}
          channelName={activeChannel.name}
          onClose={() => setIsSearchOpen(false)}
          onJumpToMessage={scrollToMessage}
          onSelectChannel={(cid) => { setActiveChannel(cid); setIsSearchOpen(false); }}
        />
      )}

      {/* Pinned messages bar */}
      {pinnedMessages.length > 0 && (
        <div className="relative border-b border-[var(--border)] bg-[var(--bg-surface)]">
          <button
            onClick={() => setShowPinnedList((v) => !v)}
            className="flex items-center gap-2 w-full px-4 py-2 hover:bg-[var(--bg-hover)] transition-colors text-left"
          >
            <Pin className="w-3.5 h-3.5 text-[var(--accent-red)] flex-shrink-0" />
            <span className="text-xs font-medium text-[var(--text-primary)]">
              {pinnedMessages.length} pinned {pinnedMessages.length === 1 ? "message" : "messages"}
            </span>
            <span className="ml-2 text-xs text-[var(--text-muted)] truncate flex-1">
              {pinnedMessages[pinnedMessages.length - 1].content?.slice(0, 60) ?? ""}
            </span>
            <ChevronDown className={cn(
              "w-3.5 h-3.5 text-[var(--text-muted)] transition-transform flex-shrink-0",
              showPinnedList && "rotate-180",
            )} />
          </button>

          {showPinnedList && (
            <div className="absolute top-full left-0 right-0 z-30 bg-[var(--bg-elevated)] border border-[var(--border)] border-t-0 shadow-lg max-h-64 overflow-y-auto">
              {pinnedMessages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] border-b border-[var(--border)]/50 last:border-0">
                  <Pin className="w-3 h-3 text-[var(--accent-red)] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      @{msg.author?.username ?? "unknown"}
                    </span>
                    <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{msg.content}</p>
                  </div>
                  <button
                    onClick={() => { scrollToMessage(msg.id); setShowPinnedList(false); }}
                    className="text-xs text-[var(--accent-red)] hover:underline flex-shrink-0"
                  >
                    Jump
                  </button>
                  {activeChannelId && canPin && (
                    <button
                      onClick={() => pinMessage(msg.id, activeChannelId)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--destructive)] flex-shrink-0"
                      title="Unpin"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages list */}
      <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto py-4 relative">
        <pre
          aria-hidden
          className="absolute inset-0 overflow-hidden pointer-events-none select-none font-mono text-xs leading-5 text-white opacity-[0.07] whitespace-pre"
        >{ASCII_BG}</pre>
        {isLoadingMore && (
          <div className="flex items-center justify-center py-2 text-xs text-[var(--text-muted)] font-mono">
            <span className="cursor-blink mr-1">$</span> loading older messages...
          </div>
        )}
        {!isAtStart && !isLoadingMore && channelMessages.length > 0 && (
          <div className="flex items-center justify-center py-1">
            <button
              onClick={() => void handleLoadMore()}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline font-mono"
            >
              Load older messages
            </button>
          </div>
        )}
        {activeChannelId && messagesLoading.has(activeChannelId) && channelMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] font-mono text-sm">
            <span className="cursor-blink mr-2">$</span> loading...
          </div>
        ) : channelMessages.length === 0 ? (
          <div className="flex flex-col items-start justify-end h-full px-6 pb-6 font-mono">
            <div className="border-l-2 border-[var(--border)] pl-4 space-y-1">
              <p className="text-xs text-[var(--text-muted)]">~/blok/#{activeChannel.name}</p>
              <p className="text-sm text-[var(--text-primary)] font-semibold tracking-wider uppercase">
                <span className="text-[var(--text-muted)] font-normal">$ </span>
                {t("chat.welcomeToChannel").replace("{channel}", activeChannel.name)}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {t("chat.beginningOfChannel").replace("{channel}", activeChannel.name)}
              </p>
            </div>
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const message = channelMessages[vItem.index];
              if (!message) return null;
              const prevMessage = channelMessages[vItem.index - 1];
              const showAvatar =
                !prevMessage ||
                prevMessage.authorId !== message.authorId ||
                new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() >
                  MESSAGE_GROUP_THRESHOLD_MS;
              const replyToMsg = message.replyToId
                ? (messageIndex.get(message.replyToId) ?? null)
                : null;
              // Prefer the live cache entry over the embedded author snapshot so
              // profile updates (avatar, username) are reflected without re-fetching
              // or iterating message arrays on every patchUser call.
              const resolvedAuthor =
                userProfileCache[message.authorId] ?? message.author ?? user ?? undefined;

              return (
                <div
                  key={message.id}
                  data-index={vItem.index}
                  ref={(el) => {
                    messageRefs.current[message.id] = el;
                    virtualizer.measureElement(el as Element | null);
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vItem.start}px)`,
                  }}
                  className="pb-1"
                >
                  <MessageBubble
                    message={polls[message.id] ? { ...message, poll: polls[message.id] } : message}
                    user={resolvedAuthor}
                    isOwn={message.authorId === user?.id}
                    showAvatar={showAvatar}
                    replyToMessage={replyToMsg}
                    replyToId={message.replyToId}
                    onReply={(msg) => chat.setReplyTo(msg as Message)}
                    onEdit={activeChannelId ? (id, content) => void editMessage(activeChannelId, id, content) : undefined}
                    onDelete={activeChannelId ? (id) => deleteMessage(id, activeChannelId) : undefined}
                    onPin={canPin && activeChannelId ? (id) => pinMessage(id, activeChannelId) : undefined}
                    onJumpTo={scrollToMessage}
                    onReact={activeChannelId && user ? (emoji) => addReaction(message.id, activeChannelId, emoji, user.id) : undefined}
                    onRemoveReact={activeChannelId && user ? (emoji) => removeReaction(message.id, activeChannelId, emoji, user.id) : undefined}
                    currentUserId={user?.id}
                    onVotePoll={user ? (pollId, optionIds) => void votePoll(pollId, optionIds, user.id) : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-4 py-1 flex items-center gap-2 text-xs text-[var(--text-muted)] min-h-[24px]">
          <span className="flex items-end gap-[3px] pb-px">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="w-1 h-1 rounded-full bg-[var(--text-muted)] animate-bounce"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          <span>{typingText}…</span>
        </div>
      )}

      {/* Poll creator */}
      {showPollCreator && (
        <PollCreator
          onClose={() => setShowPollCreator(false)}
          onSubmit={async (params) => {
            if (!activeChannelId || !user) return;
            await createPoll({ ...params, channelId: activeChannelId, authorId: user.id });
            setShowPollCreator(false);
          }}
        />
      )}

      {/* Reply bar */}
      {chat.replyTo && (
        <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-surface)] flex items-center gap-2">
          <CornerUpLeft className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
          <span className="text-xs text-[var(--text-muted)]">
            Replying to{" "}
            <span className="font-medium text-[var(--text-primary)]">
              @{chat.replyTo.author?.username ?? "unknown"}
            </span>
            {chat.replyTo.content && (
              <span className="ml-1 opacity-60 truncate max-w-xs inline-block align-bottom">
                {chat.replyTo.content}
              </span>
            )}
          </span>
          <button
            onClick={() => chat.setReplyTo(null)}
            className="ml-auto p-0.5 hover:bg-[var(--bg-hover)] transition-colors"
          >
            <X className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          </button>
        </div>
      )}

      {/* Attachment previews */}
      {chat.attachments.length > 0 && (
        <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex flex-wrap gap-2">
            {chat.attachments.map((file, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-2 py-1 bg-[var(--bg-elevated)] border border-[var(--border)]"
              >
                <Paperclip className="w-3 h-3 text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-primary)] max-w-32 truncate">{file.name}</span>
                <button
                  onClick={() => chat.removeAttachment(index)}
                  className="p-0.5 hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <X className="w-3 h-3 text-[var(--text-muted)]" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-surface)]">
        {chat.gifAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {chat.gifAttachments.map((att, idx) => (
              <div key={att.id} className="relative">
                <img
                  src={att.url}
                  alt="gif"
                  className="h-14 rounded border border-[var(--border)] object-cover"
                />
                <button
                  onClick={() => chat.removeGifAttachment(idx)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-full flex items-center justify-center hover:bg-[var(--bg-hover)]"
                >
                  <X className="w-2.5 h-2.5 text-[var(--text-muted)]" />
                </button>
              </div>
            ))}
          </div>
        )}

        {chat.fileError && (
          <p className="mb-1 text-xs text-[var(--destructive)] font-mono">{chat.fileError}</p>
        )}

        {chat.isUploading && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mb-1">
              <span>{chat.fileProgress < 100 ? `Uploading… ${chat.fileProgress}%` : "Sending…"}</span>
            </div>
            <div className="h-0.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
              {chat.fileProgress < 100 ? (
                <div
                  className="h-full bg-[var(--accent-red)] transition-all duration-150 rounded-full"
                  style={{ width: `${chat.fileProgress}%` }}
                />
              ) : (
                <div className="h-full bg-[var(--accent-red)] rounded-full animate-pulse" />
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 relative">
          {chat.mentionQuery !== null && (
            <AtMentionDropdown
              query={chat.mentionQuery}
              members={mentionableUsers}
              activeIndex={mentionIndex}
              onSelect={(username) => { chat.insertMention(username); inputRef.current?.focus(); }}
            />
          )}
          {/* Attachment picker */}
          <div className="relative">
            <button
              onClick={() => {
                const next = !chat.showAttachmentPicker;
                chat.closeAllPickers();
                if (next) chat.setShowAttachmentPicker(true);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] transition-colors",
                chat.showAttachmentPicker && "bg-[var(--bg-hover)]",
              )}
            >
              <PlusCircle className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            {chat.showAttachmentPicker && (
              <AttachmentPicker
                onAttach={chat.handleAttach}
                onClose={() => chat.setShowAttachmentPicker(false)}
              />
            )}
          </div>

          {/* Poll creator button */}
          <button
            onClick={() => setShowPollCreator((v) => !v)}
            className={cn(
              "p-1 hover:bg-[var(--bg-hover)] transition-colors",
              showPollCreator && "bg-[var(--bg-hover)] text-[var(--accent-red)]",
            )}
            title={t("poll.title")}
          >
            <BarChart2 className="w-5 h-5 text-[var(--text-muted)]" />
          </button>

          {/* Text input */}
          <input
            ref={inputRef}
            type="text"
            value={chat.inputValue}
            onChange={(e) => {
              chat.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
              setMentionIndex(0);
            }}
            onKeyDown={(e) => {
              if (chat.mentionQuery !== null) {
                const filtered = mentionableUsers
                  .filter((u) =>
                    u.username.toLowerCase().includes(chat.mentionQuery!.toLowerCase()) ||
                    (u.displayName ?? "").toLowerCase().includes(chat.mentionQuery!.toLowerCase())
                  )
                  .slice(0, 8);
                if (filtered.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % filtered.length); return; }
                  if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIndex((i) => (i - 1 + filtered.length) % filtered.length); return; }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    chat.insertMention(filtered[mentionIndex % filtered.length].username);
                    return;
                  }
                }
                if (e.key === "Escape") { e.preventDefault(); chat.setMentionQuery(null); return; }
              }
              chat.handleKeyDown(e);
            }}
            placeholder={t("chat.messagePlaceholder").replace("{channel}", activeChannel.name)}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />

          {/* GIF picker */}
          <div className="relative">
            <button
              onClick={() => {
                const next = !chat.showGifPicker;
                chat.closeAllPickers();
                if (next) chat.setShowGifPicker(true);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)] text-[10px] font-bold leading-none",
                chat.showGifPicker && "bg-[var(--bg-hover)]",
              )}
            >
              GIF
            </button>
            {chat.showGifPicker && (
              <GifPicker
                onSelect={chat.handleGifSelect}
                onClose={() => chat.setShowGifPicker(false)}
              />
            )}
          </div>

          {/* Mention picker */}
          <div className="relative">
            <button
              onClick={() => {
                const next = !chat.showMentionPicker;
                chat.closeAllPickers();
                if (next) chat.setShowMentionPicker(true);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] transition-colors",
                chat.showMentionPicker && "bg-[var(--bg-hover)]",
              )}
            >
              <AtSign className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            {chat.showMentionPicker && (
              <MentionPicker
                onSelect={handleMentionSelect}
                onClose={() => chat.setShowMentionPicker(false)}
              />
            )}
          </div>

          {/* Emoji picker */}
          <div className="relative">
            <button
              onClick={() => {
                const next = !chat.showEmojiPicker;
                chat.closeAllPickers();
                if (next) chat.setShowEmojiPicker(true);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] transition-colors",
                chat.showEmojiPicker && "bg-[var(--bg-hover)]",
              )}
            >
              <Smile className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            {chat.showEmojiPicker && (
              <EmojiPicker
                onSelect={handleEmojiSelect}
                onClose={() => chat.setShowEmojiPicker(false)}
              />
            )}
          </div>

          {/* Announce toggle */}
          <button
            onClick={() => chat.setIsAnnouncement(!chat.isAnnouncement)}
            title={chat.isAnnouncement ? "Sending as announcement (click to cancel)" : "Send as announcement"}
            className={cn(
              "p-1 transition-colors flex-shrink-0",
              chat.isAnnouncement
                ? "text-[var(--accent-red)] bg-[var(--bg-hover)]"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]",
            )}
          >
            <Megaphone className="w-4 h-4" />
          </button>

          {/* Send button */}
          <button
            onClick={() => void chat.handleSendMessage()}
            disabled={!chat.canSend || chat.isUploading}
            className={cn(
              "p-1.5 transition-colors flex-shrink-0",
              chat.canSend && !chat.isUploading
                ? "bg-[var(--accent-red)] hover:opacity-90 text-white"
                : "bg-[var(--bg-hover)] text-[var(--text-muted)]",
            )}
          >
            {chat.isUploading ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
