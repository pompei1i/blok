import type Anthropic from "@anthropic-ai/sdk";
import { useServerStore } from "./store/server-store";
import { supabase } from "./supabaseClient";

export interface ToolContext {
  serverId: string;
  channelId: string;
  userId: string;
}

export interface ToolResult {
  content: string;
  label: string;
}

export const BAIT_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_server",
    description: "Create a new server (workspace) in Blok.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name for the new server" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_channel",
    description: "Create a new channel in the currently active server.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name for the new channel (no spaces, lowercase)" },
        type: { type: "string", enum: ["text", "voice"], description: "Channel type" },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "translate",
    description: "Translate text to another language. Return the translated text in translated_text.",
    input_schema: {
      type: "object" as const,
      properties: {
        translated_text: { type: "string", description: "The translated text" },
        target_language: { type: "string", description: "Target language name" },
      },
      required: ["translated_text", "target_language"],
    },
  },
  {
    name: "create_poll",
    description: "Create a poll in the currently active channel.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: { type: "string", description: "The poll question" },
        options: { type: "array", items: { type: "string" }, description: "Poll answer options (2–10)" },
        multiple_choice: { type: "boolean", description: "Allow multiple selections" },
        anonymous: { type: "boolean", description: "Hide voter names" },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "create_announcement",
    description: "Send an announcement message to the currently active channel.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Announcement message content" },
      },
      required: ["text"],
    },
  },
  {
    name: "set_timer",
    description: "Schedule a message to be sent to the current channel after a delay.",
    input_schema: {
      type: "object" as const,
      properties: {
        delay_seconds: { type: "number", description: "Delay in seconds before sending the message" },
        message: { type: "string", description: "Message text to send after the delay" },
      },
      required: ["delay_seconds", "message"],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case "create_server": {
      const serverName = input.name as string;
      await useServerStore.getState().createServer({ name: serverName, ownerId: ctx.userId });
      return { content: `Server "${serverName}" created.`, label: `✓ server "${serverName}" created` };
    }

    case "create_channel": {
      const channelName = (input.name as string).toLowerCase().replace(/\s+/g, "-");
      const channelType = (input.type as "text" | "voice") ?? "text";
      if (!ctx.serverId) return { content: "No active server.", label: "✗ no active server" };
      await useServerStore.getState().createChannel({
        serverId: ctx.serverId,
        name: channelName,
        type: channelType,
      });
      return {
        content: `Channel "${channelName}" (${channelType}) created.`,
        label: `✓ channel #${channelName} created`,
      };
    }

    case "translate": {
      const translated = input.translated_text as string;
      const lang = input.target_language as string;
      return { content: translated, label: `✓ translated to ${lang}` };
    }

    case "create_poll": {
      if (!ctx.channelId) return { content: "No active channel.", label: "✗ no active channel" };
      const question = input.question as string;
      const options = input.options as string[];
      const multiple = (input.multiple_choice as boolean) ?? false;
      const anon = (input.anonymous as boolean) ?? false;
      await useServerStore.getState().createPoll({
        channelId: ctx.channelId,
        question,
        options,
        isMultipleChoice: multiple,
        isAnonymous: anon,
        authorId: ctx.userId,
      });
      return { content: `Poll "${question}" created.`, label: `✓ poll created` };
    }

    case "create_announcement": {
      if (!ctx.channelId) return { content: "No active channel.", label: "✗ no active channel" };
      const text = input.text as string;
      const { error } = await supabase
        .from("messages")
        .insert({ channel_id: ctx.channelId, author_id: ctx.userId, content: text });
      if (error) return { content: `Failed: ${error.message}`, label: "✗ announcement failed" };
      return { content: "Announcement sent.", label: "✓ announcement sent" };
    }

    case "set_timer": {
      if (!ctx.channelId) return { content: "No active channel.", label: "✗ no active channel" };
      const delaySec = Math.max(1, Math.min(Number(input.delay_seconds) || 30, 3600));
      const timerMsg = input.message as string;
      setTimeout(async () => {
        await supabase
          .from("messages")
          .insert({ channel_id: ctx.channelId, author_id: ctx.userId, content: timerMsg });
      }, delaySec * 1000);
      const label = delaySec < 60 ? `${delaySec}s` : `${Math.round(delaySec / 60)}m`;
      return { content: `Timer set. Message will be sent in ${label}.`, label: `✓ timer set (${label})` };
    }

    default:
      return { content: `Unknown tool: ${name}`, label: `✗ unknown tool` };
  }
}
