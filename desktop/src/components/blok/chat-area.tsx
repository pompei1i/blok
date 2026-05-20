import { useRef, useEffect, useState } from "react";
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
} from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { MessageBubble } from "./message-bubble";
import { EmojiPicker } from "./emoji-picker";
import { GifPicker } from "./gif-picker";
import { MentionPicker } from "./mention-picker";
import { AttachmentPicker } from "./attachment-picker";
import type { Message } from "@/lib/store/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useChatInput } from "@/hooks/useChatInput";
import { MESSAGE_GROUP_THRESHOLD_MS, HIGHLIGHT_FLASH_DURATION_MS } from "@/lib/constants";

export function ChatArea() {
  const { t } = useI18n();
  const {
    activeServerId,
    activeChannelId,
    channels,
    messages,
    messagesLoading,
    typingUsers,
    servers,
    deleteMessage,
    editMessage,
    pinMessage,
    addReaction,
    removeReaction,
  } = useServerStore();
  const { user } = useAuthStore();

  const isServerOwner = user?.id === servers.find((s) => s.id === activeServerId)?.ownerId;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showPinnedList, setShowPinnedList] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const chat = useChatInput({ activeChannelId, user });

  const serverChannels = activeServerId ? channels[activeServerId] || [] : [];
  const activeChannel = serverChannels.find((c) => c.id === activeChannelId);
  const channelMessages = activeChannelId ? messages[activeChannelId] || [] : [];
  const typing = activeChannelId ? typingUsers[activeChannelId] || [] : [];
  const pinnedMessages = channelMessages.filter((m) => m.isPinned);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channelMessages]);

  // Keep focus on input after emoji/mention selection
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

  if (!activeChannel) {
    return (
      <div className="flex-1 bg-[var(--bg-base)] flex flex-col items-center justify-center">
        <div className="text-center animate-fade-in">
          <pre className="text-[var(--text-muted)] text-xs mb-4 font-mono">
{`
  ╔══════════════════════════╗
  ║   SELECT A CHANNEL       ║
  ║   TO START CHATTING      ║
  ╚══════════════════════════╝
`}
          </pre>
          <p className="text-sm text-[var(--text-muted)]">
            <span className="text-[var(--text-muted)]">$ </span>
            {t("chat.chooseChannel")}
          </p>
        </div>
      </div>
    );
  }

  const scrollToMessage = (id: string) => {
    const el = messageRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("highlight-flash");
      setTimeout(() => el.classList.remove("highlight-flash"), HIGHLIGHT_FLASH_DURATION_MS);
    }
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
          <div className="border-2 border-dashed border-[var(--accent-red)] rounded-xl px-12 py-8 text-center">
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
      </div>

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
                  {activeChannelId && isServerOwner && (
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
      <div className="flex-1 overflow-y-auto py-4">
        {activeChannelId && messagesLoading.has(activeChannelId) ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] font-mono text-sm">
            <span className="cursor-blink mr-2">$</span> loading...
          </div>
        ) : channelMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mb-4 border border-[var(--border)]">
              <Hash className="w-8 h-8 text-[var(--text-muted)]" />
            </div>
            <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
              {t("chat.welcomeToChannel").replace("{channel}", activeChannel.name)}
            </h3>
            <p className="text-sm text-[var(--text-muted)]">
              {t("chat.beginningOfChannel").replace("{channel}", activeChannel.name)}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {channelMessages.map((message, index) => {
              const prevMessage = channelMessages[index - 1];
              const showAvatar =
                !prevMessage ||
                prevMessage.authorId !== message.authorId ||
                new Date(message.createdAt).getTime() -
                  new Date(prevMessage.createdAt).getTime() >
                  MESSAGE_GROUP_THRESHOLD_MS;

              const replyToMsg = message.replyToId
                ? channelMessages.find((m) => m.id === message.replyToId) ?? null
                : null;

              return (
                <div
                  key={message.id}
                  ref={(el) => { messageRefs.current[message.id] = el; }}
                >
                  <MessageBubble
                    message={message}
                    user={message.author || user || undefined}
                    isOwn={message.authorId === user?.id}
                    showAvatar={showAvatar}
                    replyToMessage={replyToMsg}
                    replyToId={message.replyToId}
                    onReply={(msg) => chat.setReplyTo(msg as Message)}
                    onEdit={activeChannelId ? (id, content) => void editMessage(activeChannelId, id, content) : undefined}
                    onDelete={activeChannelId ? (id) => deleteMessage(id, activeChannelId) : undefined}
                    onPin={isServerOwner && activeChannelId ? (id) => pinMessage(id, activeChannelId) : undefined}
                    onJumpTo={scrollToMessage}
                    onReact={activeChannelId && user ? (emoji) => addReaction(message.id, activeChannelId, emoji, user.id) : undefined}
                    onRemoveReact={activeChannelId && user ? (emoji) => removeReaction(message.id, activeChannelId, emoji, user.id) : undefined}
                    currentUserId={user?.id}
                  />
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Typing indicator */}
      {typing.length > 0 && (
        <div className="px-4 py-1 text-xs text-[var(--text-muted)]">
          <span className="animate-pulse">
            {typing.length === 1 ? t("chat.someoneTyping") : t("chat.severalTyping")}
          </span>
        </div>
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
            className="ml-auto p-0.5 hover:bg-[var(--bg-hover)] rounded transition-colors"
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
                className="flex items-center gap-2 px-2 py-1 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)]"
              >
                <Paperclip className="w-3 h-3 text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-primary)] max-w-32 truncate">{file.name}</span>
                <button
                  onClick={() => chat.removeAttachment(index)}
                  className="p-0.5 hover:bg-[var(--bg-hover)] rounded transition-colors"
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

        {chat.isUploading && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mb-1">
              <span>{chat.fileProgress < 100 ? `Reading files… ${chat.fileProgress}%` : "Sending…"}</span>
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

        <div className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)] px-3 py-2 relative">
          {/* Attachment picker */}
          <div className="relative">
            <button
              onClick={() => {
                const next = !chat.showAttachmentPicker;
                chat.closeAllPickers();
                if (next) chat.setShowAttachmentPicker(true);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
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

          {/* Text input */}
          <input
            ref={inputRef}
            type="text"
            value={chat.inputValue}
            onChange={(e) => chat.setInputValue(e.target.value)}
            onKeyDown={chat.handleKeyDown}
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
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors text-[var(--text-muted)] text-[10px] font-bold leading-none",
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
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
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
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
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

          {/* Send button */}
          <button
            onClick={() => void chat.handleSendMessage()}
            disabled={!chat.canSend || chat.isUploading}
            className={cn(
              "p-1.5 rounded transition-colors flex-shrink-0",
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
