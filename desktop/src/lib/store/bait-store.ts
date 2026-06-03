import { create } from "zustand";
import { persist } from "zustand/middleware";
import Anthropic from "@anthropic-ai/sdk";
import { BAIT_TOOLS, executeTool } from "../bait-tools";
import { useServerStore } from "./server-store";
import { useAuthStore } from "./auth-store";

export interface BaitMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: string[];
}

interface BaitStore {
  isTabOpen: boolean;
  isActive: boolean;
  apiKey: string;
  messages: BaitMessage[];
  isLoading: boolean;

  openTab: () => void;
  closeTab: () => void;
  activate: () => void;
  deactivate: () => void;
  setApiKey: (key: string) => void;
  clearHistory: () => void;
  sendMessage: (text: string) => Promise<void>;
}

export const useBaitStore = create<BaitStore>()(
  persist(
    (set, get) => ({
      isTabOpen: false,
      isActive: false,
      apiKey: "",
      messages: [],
      isLoading: false,

      openTab: () => set({ isTabOpen: true, isActive: true }),
      closeTab: () => set({ isTabOpen: false, isActive: false }),
      activate: () => set({ isActive: true }),
      deactivate: () => set({ isActive: false }),
      setApiKey: (key) => set({ apiKey: key }),
      clearHistory: () => set({ messages: [] }),

      sendMessage: async (text) => {
        const resolvedKey = get().apiKey || (import.meta.env.VITE_BAIT_DEFAULT_KEY as string) || "";
        const { messages } = get();
        if (!resolvedKey || !text.trim()) return;
        const apiKey = resolvedKey;

        const userMsg: BaitMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: text.trim(),
        };
        set({ messages: [...messages, userMsg], isLoading: true });

        const { activeServerId, activeChannelId, servers, channels, messages: channelMessages } = useServerStore.getState();
        const userId = useAuthStore.getState().user?.id ?? "";

        // Build context from current server/channel and last 20 messages
        const activeServer = servers.find((s) => s.id === activeServerId);
        const activeChannel = activeServerId && activeChannelId
          ? (channels[activeServerId] ?? []).find((c) => c.id === activeChannelId)
          : null;
        const recentMsgs = activeChannelId ? (channelMessages[activeChannelId] ?? []).slice(-20) : [];
        const channelContext = recentMsgs.length > 0
          ? "\n\nRecent messages in #" + (activeChannel?.name ?? "channel") + " (oldest first):\n" +
            recentMsgs.map((m) => `[${m.author?.username ?? "?"}]: ${m.content}`).join("\n")
          : "";
        const serverContext = activeServer
          ? `\n\nActive server: "${activeServer.name}"${activeChannel ? `. Active channel: #${activeChannel.name} (${activeChannel.type})` : ""}.`
          : "";

        const systemPrompt =
          "You are b.ai.t — Blok's built-in AI assistant. " +
          "Blok is a team chat app (like Discord). " +
          "Use the provided tools to perform actions in the app. " +
          "Be concise and helpful. Respond in the same language the user writes in." +
          serverContext +
          channelContext;

        const history: Anthropic.MessageParam[] = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        try {
          const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

          let response = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            system: systemPrompt,
            tools: BAIT_TOOLS,
            messages: history,
          });

          const toolResults: string[] = [];

          // Handle tool_use loop
          while (response.stop_reason === "tool_use") {
            const toolUseBlocks = response.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
            );

            const toolResultMessages: Anthropic.ToolResultBlockParam[] = [];

            for (const block of toolUseBlocks) {
              const result = await executeTool(block.name, block.input as Record<string, unknown>, {
                serverId: activeServerId ?? "",
                channelId: activeChannelId ?? "",
                userId,
              });
              toolResults.push(result.label);
              toolResultMessages.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result.content,
              });
            }

            history.push({ role: "assistant", content: response.content });
            history.push({ role: "user", content: toolResultMessages });

            response = await client.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 1024,
              system: systemPrompt,
              tools: BAIT_TOOLS,
              messages: history,
            });
          }

          const assistantText = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n");

          const assistantMsg: BaitMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantText,
            toolResults: toolResults.length > 0 ? toolResults : undefined,
          };

          set((s) => ({ messages: [...s.messages, assistantMsg], isLoading: false }));
        } catch (err) {
          const errMsg: BaitMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: err instanceof Error ? `Error: ${err.message}` : "Unknown error",
          };
          set((s) => ({ messages: [...s.messages, errMsg], isLoading: false }));
        }
      },
    }),
    {
      name: "bait-store",
      partialize: (s) => ({ apiKey: s.apiKey, messages: s.messages }),
    }
  )
);
