import { useState } from "react";
import { useServerStore } from "@/lib/store/server-store";
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
  const [isUploading, setIsUploading] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);

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

  const readFilesWithProgress = (files: File[]): Promise<Attachment[]> => {
    if (files.length === 0) return Promise.resolve([]);

    const messageId = `m${Date.now()}`;
    const fileLoaded = new Array(files.length).fill(0);
    const totalSize = files.reduce((s, f) => s + f.size, 0) || 1;

    return new Promise((resolve, reject) => {
      const results: (Attachment | null)[] = new Array(files.length).fill(null);
      let completed = 0;

      files.forEach((file, i) => {
        const reader = new FileReader();

        reader.onprogress = (e) => {
          if (e.lengthComputable) {
            fileLoaded[i] = e.loaded;
            const loaded = fileLoaded.reduce((s, l: number) => s + l, 0);
            setFileProgress(Math.round((loaded / totalSize) * 100));
          }
        };

        reader.onloadend = () => {
          results[i] = {
            id: `att${Date.now()}-${i}`,
            messageId,
            url: reader.result as string,
            filename: file.name,
            mediaType: file.type,
            sizeBytes: file.size,
            createdAt: new Date().toISOString(),
          };
          completed++;
          if (completed === files.length) resolve(results as Attachment[]);
        };

        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
      });
    });
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

      const base64Attachments = await readFilesWithProgress(attachments);

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
        author: user,
        attachments: [
          ...base64Attachments,
          ...gifAttachments.map((a) => ({ ...a, messageId })),
        ],
      };

      await addMessage(activeChannelId, message);

      setInputValue("");
      setAttachments([]);
      setGifAttachments([]);
      setReplyTo(null);
      setShowGifPicker(false);
    } catch (err) {
      console.error("Failed to send message", err);
    } finally {
      setIsUploading(false);
      setFileProgress(0);
    }
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
