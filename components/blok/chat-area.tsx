'use client';

import { useRef, useEffect, useState } from 'react';
import { Hash, Send, Smile, PlusCircle, AtSign, Paperclip, X } from 'lucide-react';
import { useGroupStore } from '@/lib/store/group-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { MessageBubble } from './message-bubble';
import { EmojiPicker } from './emoji-picker';
import { MentionPicker } from './mention-picker';
import { AttachmentPicker } from './attachment-picker';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export function ChatArea() {
  const { t } = useI18n();
  const { activeGroupId, activeChannelId, channels, messages, typingUsers, addMessage } = useGroupStore();
  const { user } = useAuthStore();
  const [inputValue, setInputValue] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const groupChannels = activeGroupId ? channels[activeGroupId] || [] : [];
  const activeChannel = groupChannels.find(c => c.id === activeChannelId);
  const channelMessages = activeChannelId ? messages[activeChannelId] || [] : [];
  const typing = activeChannelId ? typingUsers[activeChannelId] || [] : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages]);

  const handleSendMessage = () => {
    if (!inputValue.trim() || !activeChannelId || !user) return;

    const newMessage = {
      id: `m${Date.now()}`,
      channelId: activeChannelId,
      userId: user.id,
      content: inputValue.trim(),
      createdAt: new Date().toISOString(),
      user: user,
    };

    addMessage(activeChannelId, newMessage);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setInputValue(prev => prev + emoji);
    inputRef.current?.focus();
  };

  const handleMentionSelect = (mention: string) => {
    setInputValue(prev => prev + mention + ' ');
    inputRef.current?.focus();
  };

  const handleAttach = (files: File[]) => {
    setAttachments(prev => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
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
      {/* Channel header */}
      <div className="h-12 border-b border-[var(--border)] flex items-center px-4 bg-[var(--bg-surface)]">
        <Hash className="w-5 h-5 text-[var(--text-muted)] mr-2" />
        <span className="font-medium text-[var(--text-primary)]">{activeChannel.name}</span>
        <div className="ml-2 h-4 w-px bg-[var(--border)]" />
        <span className="ml-2 text-sm text-[var(--text-muted)]">
          {t("chat.channelTopic")}
        </span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-4">
        {channelMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mb-4 border border-[var(--border)]">
              <Hash className="w-8 h-8 text-[var(--text-muted)]" />
            </div>
            <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
              {t("chat.welcomeToChannel").replace("#{channel}", activeChannel.name)}
            </h3>
            <p className="text-sm text-[var(--text-muted)]">
              {t("chat.beginningOfChannel").replace("#{channel}", activeChannel.name)}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {channelMessages.map((message, index) => {
              const prevMessage = channelMessages[index - 1];
              const showAvatar = !prevMessage || 
                prevMessage.userId !== message.userId ||
                new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() > 300000;
              
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  user={message.user || user || undefined}
                  isOwn={message.userId === user?.id}
                  showAvatar={showAvatar}
                />
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

      {/* Attachments preview */}
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

      {/* Input area */}
      <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)] px-3 py-2 relative">
          {/* Attachment button */}
          <div className="relative">
            <button 
              onClick={() => {
                setShowAttachmentPicker(!showAttachmentPicker);
                setShowEmojiPicker(false);
                setShowMentionPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
                showAttachmentPicker && "bg-[var(--bg-hover)]"
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
            placeholder={t("chat.messagePlaceholder").replace("#{channel}", activeChannel.name)}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />

          {/* Mention button */}
          <div className="relative">
            <button 
              onClick={() => {
                setShowMentionPicker(!showMentionPicker);
                setShowEmojiPicker(false);
                setShowAttachmentPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
                showMentionPicker && "bg-[var(--bg-hover)]"
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

          {/* Emoji button */}
          <div className="relative">
            <button 
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowMentionPicker(false);
                setShowAttachmentPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
                showEmojiPicker && "bg-[var(--bg-hover)]"
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
            onClick={handleSendMessage}
            disabled={!inputValue.trim() && attachments.length === 0}
            className={cn(
              'p-1.5 rounded transition-colors',
              (inputValue.trim() || attachments.length > 0)
                ? 'bg-[var(--accent-red)] hover:opacity-90 text-white'
                : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
