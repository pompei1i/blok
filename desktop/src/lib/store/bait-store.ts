import { create } from "zustand";
import { persist } from "zustand/middleware";
import type Anthropic from "@anthropic-ai/sdk";
import { BAIT_TOOLS, executeTool } from "../bait-tools";
import { useServerStore } from "./server-store";
import { useAuthStore } from "./auth-store";
import { supabase } from "../supabaseClient";
import { translate } from "../i18n";

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
  /** Timestamps of proxy calls in the rolling 24h beta window (persisted). */
  dailyLog: number[];

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

// Daily cap (beta cost guard). Mirrors the server's DAILY_MAX in functions/bait:
// the proxy limits Anthropic *calls* per rolling 24h (one b.ai.t message with tool
// use = 2-3 calls), so we count proxy calls here too and persist the log so the
// window survives an app restart. The Edge Function stays the real enforcer — this
// is just instant feedback + a visible "left today" counter. Admins are exempt
// (the server skips the cap for them as well; see the bait_admin_bypass migration).
export const BAIT_DAILY_LIMIT = 10;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Beta gate: b.ai.t is turned off while the Anthropic key has no credits. The
// whole pipeline (proxy, tools, UI) is left intact — to re-enable, set this to
// false and top up ANTHROPIC_API_KEY on the "bait" Edge Function.
export const BAIT_DISABLED = true;

const pruneDaily = (log: number[]): number[] => {
  const cutoff = Date.now() - DAILY_WINDOW_MS;
  return log.filter((t) => t > cutoff);
};

/** b.ai.t prompts left in the rolling 24h beta window. */
export function baitDailyRemaining(log: number[]): number {
  return Math.max(0, BAIT_DAILY_LIMIT - pruneDaily(log).length);
}

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
    // Surface the server's actual message ("Limit reached (10/min or 10/day).")
    // instead of a hardcoded per-minute one, so the daily cap reads correctly.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "b.ai.t rate limit reached. Please wait.");
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
      dailyLog: [],

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

        // Beta gate — echo the prompt and a "coming soon" note, skip the proxy.
        if (BAIT_DISABLED) {
          addMsgs(
            { id: crypto.randomUUID(), role: "user", content: text.trim() },
            { id: crypto.randomUUID(), role: "assistant", content: translate("bait.comingSoonMessage") },
          );
          return;
        }

        // Admins bypass every beta limit (the server skips the cap for them too).
        const isAdmin = useAuthStore.getState().user?.isAdmin ?? false;

        // Client-side rate limiting — instant feedback; the proxy enforces the real cap.
        if (!isAdmin) {
          const now = Date.now();
          requestLog = requestLog.filter((t) => now - t < RATE_WINDOW_MS);
          if (requestLog.length >= RATE_LIMIT) {
            addMsgs(
              { id: crypto.randomUUID(), role: "user", content: text.trim() },
              { id: crypto.randomUUID(), role: "assistant", content: "Error: Rate limit — max 10 requests per minute. Please wait." },
            );
            return;
          }

          // Daily beta cap — count proxy calls over a rolling 24h (see notes above).
          const dailyLog = pruneDaily(get().dailyLog);
          if (dailyLog.length >= BAIT_DAILY_LIMIT) {
            addMsgs(
              { id: crypto.randomUUID(), role: "user", content: text.trim() },
              { id: crypto.randomUUID(), role: "assistant", content: `Error: Daily limit reached — ${BAIT_DAILY_LIMIT} b.ai.t prompts per day during the beta. Try again later.` },
            );
            return;
          }
          if (dailyLog.length !== get().dailyLog.length) set({ dailyLog });
          requestLog.push(now);
        }

        const userMsg: BaitMessage = { id: crypto.randomUUID(), role: "user", content: text.trim() };
        addMsgs(userMsg);
        set({ isLoading: true });

        // Each proxy call = one unit against the daily cap (matching the server).
        // Admins aren't capped, so we don't bother tracking them.
        const proxyCall = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
          const result = await callBaitProxy(params);
          if (!isAdmin) set((s) => ({ dailyLog: pruneDaily([...s.dailyLog, Date.now()]) }));
          return result;
        };

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

          let response = await proxyCall(baseParams);

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

            response = await proxyCall({ ...baseParams, messages: history });
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
      partialize: (s) => ({ messagesByServer: s.messagesByServer, dailyLog: s.dailyLog }),
    },
  ),
);
