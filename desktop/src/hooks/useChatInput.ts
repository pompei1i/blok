import { useState } from "react";
import { useServerStore } from "@/lib/store/server-store";
import { supabase } from "@/lib/supabaseClient";
import { MAX_FILE_SIZE } from "@/lib/constants";
import type { Message, Attachment, User } from "@/lib/store/types";

interface UseChatInputOptions {
  activeChannelId: string | null;
  user: User | null;
}

export function useChatInput({ activeChannelId, user }: UseChatInputOptions) {
  const { addMessage } = useServerStore();

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

  const canSend =
    inputValue.trim().length > 0 ||
    attachments.length > 0 ||
    gifAttachments.length > 0;

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
      const path = `${channelId}/${messageId}-${i}-${file.name}`;
      setFileProgress(Math.round((i / files.length) * 100));

      const { error } = await supabase.storage.from("attachments").upload(path, file, { upsert: false });
      if (error) {
        console.error("Upload failed", file.name, error);
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
