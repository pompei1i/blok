import { create } from "zustand";
import { persist } from "zustand/middleware";
import type Anthropic from "@anthropic-ai/sdk";
import { BAIT_TOOLS, executeTool } from "../bait-tools";
import { useServerStore } from "./server-store";
import { useAuthStore } from "./auth-store";
import { supabase } from "../supabaseClient";

export interface BaitMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: string[];
}

interface BaitStore {
  isTabOpen: boolean;
  isActive: boolean;
  messagesByServer: Record<string, BaitMessage[]>;
  isLoading: boolean;

  openTab: () => void;
  closeTab: () => void;
  activate: () => void;
  deactivate: () => void;
  clearHistory: () => void;
  sendMessage: (text: string) => Promise<void>;
}

// Sliding-window rate limiter — not persisted, resets on app restart
let requestLog: number[] = [];
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function serverKey(): string {
  return useServerStore.getState().activeServerId ?? "_global";
}

// Route the Anthropic call through the Supabase Edge Function ("bait") so the API
// key stays server-side. Auth is the user's Supabase JWT; the function rate-limits
// per user and forces a cheap model + token cap. Retries once on 529 (overloaded).
async function callBaitProxy(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const url = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/bait`;
  const doFetch = () => fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(params),
  });

  let res = await doFetch();
  if (res.status === 529) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await doFetch();
  }
  if (res.status === 429) {
    throw new Error("Rate limit — max 10 requests per minute. Please wait.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`b.ai.t request failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return await res.json() as Anthropic.Message;
}

export const useBaitStore = create<BaitStore>()(
  persist(
    (set, get) => ({
      isTabOpen: false,
      isActive: false,
      messagesByServer: {},
      isLoading: false,

      openTab: () => set({ isTabOpen: true, isActive: true }),
      closeTab: () => set({ isTabOpen: false, isActive: false }),
      activate: () => set({ isActive: true }),
      deactivate: () => set({ isActive: false }),

      clearHistory: () => {
        const key = serverKey();
        set((s) => ({ messagesByServer: { ...s.messagesByServer, [key]: [] } }));
      },

      sendMessage: async (text) => {
        if (!text.trim()) return;

        const key = serverKey();
        const msgs = get().messagesByServer[key] ?? [];

        const addMsgs = (...newMsgs: BaitMessage[]) =>
          set((s) => ({
            messagesByServer: {
              ...s.messagesByServer,
              [key]: [...(s.messagesByServer[key] ?? []), ...newMsgs],
            },
          }));

        // Client-side rate limiting — instant feedback; the proxy enforces the real cap.
        const now = Date.now();
        requestLog = requestLog.filter((t) => now - t < RATE_WINDOW_MS);
        if (requestLog.length >= RATE_LIMIT) {
          addMsgs(
            { id: crypto.randomUUID(), role: "user", content: text.trim() },
            { id: crypto.randomUUID(), role: "assistant", content: "Error: Rate limit — max 10 requests per minute. Please wait." },
          );
          return;
        }
        requestLog.push(now);

        const userMsg: BaitMessage = { id: crypto.randomUUID(), role: "user", content: text.trim() };
        addMsgs(userMsg);
        set({ isLoading: true });

        const { activeServerId, activeChannelId, servers, channels, messages: channelMessages } = useServerStore.getState();
        const userId = useAuthStore.getState().user?.id ?? "";

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

        const systemText =
          "You are b.ai.t — Blok's built-in AI assistant. " +
          "Blok is a team chat app (like Discord). " +
          "Use the provided tools to perform actions in the app. " +
          "Be concise and helpful. Respond in the same language the user writes in. " +
          "Format your responses as plain text only — no markdown, no **bold**, no _italic_. " +
          "Use a plain dash (- item) or numbered list (1. item) with newlines between items when listing things." +
          serverContext +
          channelContext;

        const history: Anthropic.MessageParam[] = [...msgs, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        try {
          const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
            tools: BAIT_TOOLS,
            messages: history,
          };

          let response = await callBaitProxy(baseParams);

          const toolResults: string[] = [];

          while (response.stop_reason === "tool_use") {
            const toolUseBlocks = response.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
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

            response = await callBaitProxy({ ...baseParams, messages: history });
          }

          const assistantText = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n");

          addMsgs({
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantText,
            toolResults: toolResults.length > 0 ? toolResults : undefined,
          });
          set({ isLoading: false });
        } catch (err) {
          addMsgs({
            id: crypto.randomUUID(),
            role: "assistant",
            content: err instanceof Error ? `Error: ${err.message}` : "Unknown error",
          });
          set({ isLoading: false });
        }
      },
    }),
    {
      name: "bait-store",
      partialize: (s) => ({ messagesByServer: s.messagesByServer }),
    },
  ),
);
