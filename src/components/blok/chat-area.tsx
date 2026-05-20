import { useRef, useLayoutEffect, useState } from "react";
import {
  Hash,
  Send,
  Smile,
  PlusCircle,
  AtSign,
  Paperclip,
  X,
} from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { supabase } from "@/lib/supabaseClient";
import { MessageBubble } from "./message-bubble";
import { EmojiPicker } from "./emoji-picker";
import { GifPicker } from "./gif-picker";
import { MentionPicker } from "./mention-picker";
import { AttachmentPicker } from "./attachment-picker";
import type { Attachment } from "@/lib/store/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function ChatArea() {
  const { t } = useI18n();
  const {
    activeServerId,
    activeChannelId,
    channels,
    messages,
    messagesLoading,
    messagesAtStart,
    typingUsers,
    addMessage,
    editMessage,
    loadMoreMessages,
  } = useServerStore();
  const { user } = useAuthStore();
  const [inputValue, setInputValue] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [gifAttachments, setGifAttachments] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const serverChannels = activeServerId ? channels[activeServerId] || [] : [];
  const activeChannel = serverChannels.find((c) => c.id === activeChannelId);
  const channelMessages = activeChannelId
    ? messages[activeChannelId] || []
    : [];
  const typing = activeChannelId ? typingUsers[activeChannelId] || [] : [];

  const isAtStart = activeChannelId ? messagesAtStart.has(activeChannelId) : true;
  const isLoadingMore = activeChannelId ? messagesLoading.has(activeChannelId) : false;

  useLayoutEffect(() => {
    if (prevScrollHeightRef.current !== null && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [channelMessages]);

  const handleLoadMore = async () => {
    if (!activeChannelId || !messagesContainerRef.current) return;
    prevScrollHeightRef.current = messagesContainerRef.current.scrollHeight;
    await loadMoreMessages(activeChannelId);
  };

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.currentTarget.scrollTop < 80 && !isAtStart && !isLoadingMore) {
      void handleLoadMore();
    }
  };

  const handleGifSelect = (url: string) => {
    setGifAttachments((prev) => [
      ...prev,
      {
        id: `gif-${Date.now()}`,
        messageId: "",
        url,
        filename: "gif",
        mediaType: "image/gif",
        sizeBytes: 0,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && attachments.length === 0 && gifAttachments.length === 0) || !activeChannelId || !user) return;

    const messageId = `m${Date.now()}`;
    const hasFiles = attachments.length > 0;

    if (hasFiles) setIsUploading(true);
    try {
      const uploadedAttachments: Attachment[] = [];
      for (let i = 0; i < attachments.length; i++) {
        const file = attachments[i];
        const path = `${activeChannelId}/${messageId}-${i}-${file.name}`;
        const { error } = await supabase.storage.from("attachments").upload(path, file, { upsert: false });
        if (error) { console.error("Upload failed", file.name, error); continue; }
        const { data: { publicUrl } } = supabase.storage.from("attachments").getPublicUrl(path);
        uploadedAttachments.push({
          id: `att${Date.now()}-${i}`,
          messageId,
          url: publicUrl,
          filename: file.name,
          mediaType: file.type,
          sizeBytes: file.size,
          createdAt: new Date().toISOString(),
        });
      }

      const allAttachments = [
        ...uploadedAttachments,
        ...gifAttachments.map((a) => ({ ...a, messageId })),
      ];

      const newMessage = {
        id: messageId,
        channelId: activeChannelId,
        authorId: user.id,
        content: inputValue.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isEdited: false,
        author: user,
        attachments: allAttachments,
      };

      addMessage(activeChannelId, newMessage);
      setInputValue("");
      setAttachments([]);
      setGifAttachments([]);
      setShowGifPicker(false);
    } catch (err) {
      console.error("Failed to send message", err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setInputValue((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const handleMentionSelect = (mention: string) => {
    setInputValue((prev) => prev + mention + " ");
    inputRef.current?.focus();
  };

  const handleAttach = (files: File[]) => {
    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setFileError(`File too large (max 10 MB): ${oversized.map((f) => f.name).join(", ")}`);
      const valid = files.filter((f) => f.size <= MAX_FILE_SIZE);
      if (valid.length > 0) setAttachments((prev) => [...prev, ...valid]);
      return;
    }
    setFileError(null);
    setAttachments((prev) => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
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

  return (
    <div className="flex-1 bg-[var(--bg-base)] flex flex-col">
      <div className="h-12 border-b border-[var(--border)] flex items-center px-4 bg-[var(--bg-surface)]">
        <Hash className="w-5 h-5 text-[var(--text-muted)] mr-2" />
        <span className="font-medium text-[var(--text-primary)]">
          {activeChannel.name}
        </span>
        <div className="ml-2 h-4 w-px bg-[var(--border)]" />
        <span className="ml-2 text-sm text-[var(--text-muted)]">
          {t("chat.channelTopic")}
        </span>
      </div>

      <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto py-4">
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
                  300000;

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  user={message.author || user || undefined}
                  isOwn={message.authorId === user?.id}
                  showAvatar={showAvatar}
                  onEdit={activeChannelId ? (id, content) => void editMessage(activeChannelId, id, content) : undefined}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {typing.length > 0 && (
        <div className="px-4 py-1 text-xs text-[var(--text-muted)]">
          <span className="animate-pulse">
            {typing.length === 1
              ? t("chat.someoneTyping")
              : t("chat.severalTyping")}
          </span>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-2 py-1 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)]"
              >
                <Paperclip className="w-3 h-3 text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-primary)] max-w-32 truncate">
                  {file.name}
                </span>
                <button
                  onClick={() => removeAttachment(index)}
                  className="p-0.5 hover:bg-[var(--bg-hover)] rounded transition-colors"
                >
                  <X className="w-3 h-3 text-[var(--text-muted)]" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-surface)]">
        {fileError && (
          <p className="mb-1 text-xs text-[var(--destructive)] font-mono">{fileError}</p>
        )}
        {gifAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {gifAttachments.map((att, idx) => (
              <div key={att.id} className="relative">
                <img
                  src={att.url}
                  alt="gif"
                  className="h-14 rounded border border-[var(--border)] object-cover"
                />
                <button
                  onClick={() => setGifAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-full flex items-center justify-center hover:bg-[var(--bg-hover)]"
                >
                  <X className="w-2.5 h-2.5 text-[var(--text-muted)]" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)] px-3 py-2 relative">
          <div className="relative">
            <button
              onClick={() => {
                setShowAttachmentPicker(!showAttachmentPicker);
                setShowEmojiPicker(false);
                setShowGifPicker(false);
                setShowMentionPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
                showAttachmentPicker && "bg-[var(--bg-hover)]",
              )}
            >
              <PlusCircle className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            {showAttachmentPicker && (
              <AttachmentPicker
                onAttach={handleAttach}
                onClose={() => setShowAttachmentPicker(false)}
              />
            )}
          </div>

          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.messagePlaceholder").replace("{channel}", activeChannel.name)}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />

          <div className="relative">
            <button
              onClick={() => {
                setShowGifPicker(!showGifPicker);
                setShowEmojiPicker(false);
                setShowMentionPicker(false);
                setShowAttachmentPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors text-[var(--text-muted)] text-[10px] font-bold leading-none",
                showGifPicker && "bg-[var(--bg-hover)]",
              )}
            >
              GIF
            </button>
            {showGifPicker && (
              <GifPicker
                onSelect={handleGifSelect}
                onClose={() => setShowGifPicker(false)}
              />
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setShowMentionPicker(!showMentionPicker);
                setShowEmojiPicker(false);
                setShowGifPicker(false);
                setShowAttachmentPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
                showMentionPicker && "bg-[var(--bg-hover)]",
              )}
            >
              <AtSign className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            {showMentionPicker && (
              <MentionPicker
                onSelect={handleMentionSelect}
                onClose={() => setShowMentionPicker(false)}
              />
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowGifPicker(false);
                setShowMentionPicker(false);
                setShowAttachmentPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
                showEmojiPicker && "bg-[var(--bg-hover)]",
              )}
            >
              <Smile className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                onSelect={handleEmojiSelect}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>

          <button
            onClick={() => void handleSendMessage()}
            disabled={isUploading || (!inputValue.trim() && attachments.length === 0 && gifAttachments.length === 0)}
            className={cn(
              "p-1.5 rounded transition-colors",
              !isUploading && (inputValue.trim() || attachments.length > 0 || gifAttachments.length > 0)
                ? "bg-[var(--accent-red)] hover:opacity-90 text-white"
                : "bg-[var(--bg-hover)] text-[var(--text-muted)]",
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

