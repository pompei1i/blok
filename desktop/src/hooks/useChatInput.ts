import { useState, useRef, useEffect } from "react";
import { useServerStore } from "@/lib/store/server-store";
import { supabase } from "@/lib/supabaseClient";
import { can } from "@/lib/permission";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB } from "@/lib/constants";
import type { Message, Attachment, User } from "@/lib/store/types";

interface UseChatInputOptions {
  activeChannelId: string | null;
  user: User | null;
}

export function useChatInput({ activeChannelId, user }: UseChatInputOptions) {
  const {
    addMessage,
    channelIndex = {},
    members = {},
    roles = {},
    servers = [],
    activeServerId = null,
  } = useServerStore();

  // ── Slowmode + timeout (moderation) ───────────────────────────────────────
  // Server-side triggers are the source of truth; this only guards UX so the
  // user isn't surprised by a rejected send. Moderators bypass slowmode.
  const lastSentRef = useRef<Record<string, number>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());

  const channel = activeChannelId ? channelIndex[activeChannelId] : undefined;
  const slowModeSeconds = channel?.slowModeSeconds ?? 0;
  const server = servers.find((s) => s.id === activeServerId) ?? null;
  const myMember = activeServerId
    ? (members[activeServerId] ?? []).find((m) => m.userId === user?.id)
    : undefined;
  const myRole = myMember?.roleId
    ? (roles[activeServerId ?? ""] ?? []).find((r) => r.id === myMember.roleId) ?? null
    : null;
  const bypassSlowmode = can("manage_channels", { userId: user?.id, server, role: myRole });

  const timeoutUntilMs = myMember?.timeoutUntil ? new Date(myMember.timeoutUntil).getTime() : 0;
  const isTimedOut = timeoutUntilMs > nowTick;
  const timeoutRemaining = isTimedOut ? Math.ceil((timeoutUntilMs - nowTick) / 1000) : 0;

  const cooldownEndMs =
    !bypassSlowmode && slowModeSeconds > 0 && activeChannelId
      ? (lastSentRef.current[activeChannelId] ?? 0) + slowModeSeconds * 1000
      : 0;
  const cooldownRemaining = cooldownEndMs > nowTick ? Math.ceil((cooldownEndMs - nowTick) / 1000) : 0;

  // Tick once a second only while a cooldown or timeout is counting down.
  useEffect(() => {
    if (cooldownRemaining === 0 && timeoutRemaining === 0) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownRemaining, timeoutRemaining]);

  const [inputValue, setInputValue] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [gifAttachments, setGifAttachments] = useState<Attachment[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);

  const hasContent =
    inputValue.trim().length > 0 ||
    attachments.length > 0 ||
    gifAttachments.length > 0;
  const canSend = hasContent && !isTimedOut && cooldownRemaining === 0;

  const closeAllPickers = () => {
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setShowMentionPicker(false);
    setShowAttachmentPicker(false);
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

  const uploadFilesToStorage = async (files: File[], messageId: string, channelId: string): Promise<Attachment[]> => {
    const results: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Storage object keys reject spaces and most non-ASCII chars (a screenshot
      // named "Снимок экрана … .png" would 400 with "Invalid key"). Sanitize the
      // key but keep the original name for display.
      const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
      const path = `${channelId}/${messageId}-${i}-${safeName}`;
      setFileProgress(Math.round((i / files.length) * 100));

      const { error } = await supabase.storage
        .from("attachments")
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (error) {
        console.error("Upload failed", file.name, error);
        setFileError(`Upload failed: ${error.message}`);
        continue;
      }
      const { data: { publicUrl } } = supabase.storage.from("attachments").getPublicUrl(path);
      results.push({
        id: `att${Date.now()}-${i}`,
        messageId,
        url: publicUrl,
        filename: file.name,
        mediaType: file.type,
        sizeBytes: file.size,
        createdAt: new Date().toISOString(),
      });
    }
    setFileProgress(100);
    return results;
  };

  const handleSendMessage = async () => {
    if (!canSend || !activeChannelId || !user || isUploading) return;

    const hasFiles = attachments.length > 0;
    if (hasFiles) {
      setIsUploading(true);
      setFileProgress(0);
    }

    try {
      const messageId = `m${Date.now()}`;

      const uploadedAttachments = hasFiles
        ? await uploadFilesToStorage(attachments, messageId, activeChannelId)
        : [];

      // Every upload failed and there's nothing else to send → don't post an
      // empty message; keep the attachments so the user can retry (fileError is set).
      if (hasFiles && uploadedAttachments.length === 0 &&
          inputValue.trim().length === 0 && gifAttachments.length === 0) {
        return;
      }

      if (hasFiles) setFileProgress(100);

      const message: Message = {
        id: messageId,
        channelId: activeChannelId,
        authorId: user.id,
        replyToId: replyTo?.id,
        content: inputValue.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isEdited: false,
        isAnnouncement,
        author: user,
        attachments: [
          ...uploadedAttachments,
          ...gifAttachments.map((a) => ({ ...a, messageId })),
        ],
      };

      await addMessage(activeChannelId, message);

      // Start the slowmode cooldown for this channel (no-op if slowmode is off).
      lastSentRef.current[activeChannelId] = Date.now();
      setNowTick(Date.now());

      setInputValue("");
      setAttachments([]);
      setGifAttachments([]);
      setReplyTo(null);
      setIsAnnouncement(false);
      setMentionQuery(null);
      setShowGifPicker(false);
    } catch (err) {
      console.error("Failed to send message", err);
    } finally {
      setIsUploading(false);
      setFileProgress(0);
    }
  };

  const handleInputChange = (value: string, selectionStart: number) => {
    setInputValue(value);
    const before = value.slice(0, selectionStart);
    const match = before.match(/@(\S*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const insertMention = (username: string) => {
    setInputValue((prev) => {
      const match = prev.match(/@\S*$/);
      if (!match) return prev + `@${username} `;
      return prev.slice(0, prev.lastIndexOf(match[0])) + `@${username} `;
    });
    setMentionQuery(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setInputValue((prev) => prev + emoji);
  };

  const handleMentionSelect = (mention: string) => {
    setInputValue((prev) => prev + mention + " ");
  };

  const handleAttach = (files: File[]) => {
    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setFileError(`File too large (max ${MAX_FILE_SIZE_MB} MB): ${oversized.map((f) => f.name).join(", ")}`);
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

  const removeGifAttachment = (index: number) => {
    setGifAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return {
    inputValue,
    setInputValue,
    isAnnouncement,
    setIsAnnouncement,
    mentionQuery,
    setMentionQuery,
    handleInputChange,
    insertMention,
    showEmojiPicker,
    setShowEmojiPicker,
    showGifPicker,
    setShowGifPicker,
    showMentionPicker,
    setShowMentionPicker,
    showAttachmentPicker,
    setShowAttachmentPicker,
    attachments,
    gifAttachments,
    replyTo,
    setReplyTo,
    canSend,
    slowModeSeconds,
    cooldownRemaining,
    isTimedOut,
    timeoutRemaining,
    isUploading,
    fileProgress,
    fileError,
    closeAllPickers,
    handleGifSelect,
    handleSendMessage,
    handleKeyDown,
    handleEmojiSelect,
    handleMentionSelect,
    handleAttach,
    removeAttachment,
    removeGifAttachment,
  };
}
