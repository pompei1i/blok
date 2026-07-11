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
    description:
      "Create a new server (workspace) in Blok. You may also lay out its initial categories, each with its own channels, in one call — prefer doing this so a new server isn't empty.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name for the new server" },
        categories: {
          type: "array",
          description: "Optional initial categories to create inside the new server, in order.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Category name" },
              channels: {
                type: "array",
                description: "Channels to create inside this category.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Channel name (no spaces, lowercase)" },
                    type: { type: "string", enum: ["text", "voice"], description: "Channel type" },
                  },
                  required: ["name", "type"],
                },
              },
            },
            required: ["name"],
          },
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_channel",
    description: "Create a new channel in the currently active server, optionally inside a category.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name for the new channel (no spaces, lowercase)" },
        type: { type: "string", enum: ["text", "voice"], description: "Channel type" },
        category: { type: "string", description: "Optional category name to place the channel in (must already exist)" },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "create_category",
    description: "Create a new category (channel group) in the currently active server.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Category name" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_role",
    description: "Create a new role in the currently active server. Roles are cosmetic here (name + colour); permissions default to none.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Role name" },
        color: { type: "string", description: "Optional hex colour, e.g. #e74c3c" },
      },
      required: ["name"],
    },
  },
  {
    name: "set_server_avatar",
    description:
      "Set the active server's avatar to a generated icon. Pick a seed (any text — the server name or a theme works well) and an art style; the icon is deterministic from the seed.",
    input_schema: {
      type: "object" as const,
      properties: {
        seed: { type: "string", description: "Text seed the avatar is generated from" },
        style: {
          type: "string",
          enum: ["shapes", "identicon", "bottts", "thumbs", "glass", "rings", "icons", "initials"],
          description: "Avatar art style",
        },
      },
      required: ["seed"],
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
  {
    name: "summarize_channel",
    description: "Summarize the recent messages in the current channel. Write your summary in the 'summary' field — it will be shown to the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Your concise summary of the recent channel messages" },
      },
      required: ["summary"],
    },
  },
  {
    name: "get_channel_members",
    description: "Retrieve the list of members currently in the active server.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "list_roles",
    description: "List all roles available in the active server. Use this before assign_role to know valid role names and IDs.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "assign_role",
    description: "Assign a role to a server member, or remove their role by passing null. Use list_roles first to get role IDs.",
    input_schema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Username of the member to assign the role to" },
        role_id: { type: ["string", "null"], description: "Role ID to assign, or null to remove the current role" },
      },
      required: ["username", "role_id"],
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
      const store = useServerStore.getState();
      const serverId = await store.createServer({ name: serverName });

      // Optional initial layout: categories, each with its own channels. IDs flow
      // within this one call (createServer/createCategory return their new ids), so
      // it works on the brand-new server without waiting for realtime state.
      const cats = (input.categories as Array<{ name?: string; channels?: Array<{ name?: string; type?: string }> }>) ?? [];
      let catCount = 0;
      let chCount = 0;
      for (const cat of cats) {
        if (!cat?.name) continue;
        try {
          const categoryId = await store.createCategory(serverId, cat.name);
          catCount++;
          for (const ch of cat.channels ?? []) {
            if (!ch?.name) continue;
            const chName = String(ch.name).toLowerCase().replace(/\s+/g, "-");
            const chType = ch.type === "voice" ? "voice" : "text";
            await store.createChannel({ serverId, name: chName, type: chType, categoryId });
            chCount++;
          }
        } catch (e) {
          console.error("bait create_server: nested creation failed", e);
        }
      }
      const extra = catCount ? ` with ${catCount} categor${catCount === 1 ? "y" : "ies"}, ${chCount} channel${chCount === 1 ? "" : "s"}` : "";
      return { content: `Server "${serverName}" created${extra}.`, label: `✓ server "${serverName}" created${extra}` };
    }

    case "create_channel": {
      const channelName = (input.name as string).toLowerCase().replace(/\s+/g, "-");
      const channelType = (input.type as "text" | "voice") ?? "text";
      if (!ctx.serverId) return { content: "No active server.", label: "✗ no active server" };
      let categoryId: string | undefined;
      const catName = input.category as string | undefined;
      if (catName) {
        const cats = useServerStore.getState().categories[ctx.serverId] ?? [];
        categoryId = cats.find((c) => c.name.toLowerCase() === catName.toLowerCase())?.id;
        if (!categoryId) return { content: `Category "${catName}" not found. Create it first.`, label: "✗ category not found" };
      }
      await useServerStore.getState().createChannel({
        serverId: ctx.serverId,
        name: channelName,
        type: channelType,
        categoryId,
      });
      return {
        content: `Channel "${channelName}" (${channelType})${catName ? ` in "${catName}"` : ""} created.`,
        label: `✓ channel #${channelName} created`,
      };
    }

    case "create_category": {
      if (!ctx.serverId) return { content: "No active server.", label: "✗ no active server" };
      const catName = input.name as string;
      await useServerStore.getState().createCategory(ctx.serverId, catName);
      return { content: `Category "${catName}" created.`, label: `✓ category "${catName}" created` };
    }

    case "create_role": {
      if (!ctx.serverId) return { content: "No active server.", label: "✗ no active server" };
      const roleName = input.name as string;
      const color = (input.color as string | undefined)?.trim() || undefined;
      await useServerStore.getState().createRole({ serverId: ctx.serverId, name: roleName, color, permissions: 0 });
      return { content: `Role "${roleName}" created.`, label: `✓ role "${roleName}" created` };
    }

    case "set_server_avatar": {
      if (!ctx.serverId) return { content: "No active server.", label: "✗ no active server" };
      const seed = (input.seed as string) || "blok";
      const allowed = ["shapes", "identicon", "bottts", "thumbs", "glass", "rings", "icons", "initials"];
      const style = allowed.includes(input.style as string) ? (input.style as string) : "shapes";
      // DiceBear: free, keyless, deterministic avatars served as a plain image URL.
      const url = `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}`;
      await useServerStore.getState().updateServerIcon(ctx.serverId, url);
      return { content: `Server avatar updated (${style}).`, label: `✓ server avatar set` };
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

    case "summarize_channel": {
      const summary = input.summary as string;
      return { content: summary, label: "✓ channel summarized" };
    }

    case "get_channel_members": {
      if (!ctx.serverId) return { content: "No active server.", label: "✗ no active server" };
      const serverMembers = useServerStore.getState().members[ctx.serverId] ?? [];
      if (serverMembers.length === 0) return { content: "No members found.", label: "✓ 0 members" };
      const names = serverMembers
        .map((m) => m.user?.displayName || m.user?.username || m.userId)
        .join(", ");
      return {
        content: `Members (${serverMembers.length}): ${names}`,
        label: `✓ ${serverMembers.length} members`,
      };
    }

    case "list_roles": {
      if (!ctx.serverId) return { content: "No active server.", label: "✗ no active server" };
      const roles = useServerStore.getState().roles[ctx.serverId] ?? [];
      if (roles.length === 0) return { content: "No roles in this server.", label: "✓ no roles" };
      const list = roles.map((r) => `${r.name} (id: ${r.id})`).join("\n");
      return { content: `Roles:\n${list}`, label: `✓ ${roles.length} roles` };
    }

    case "assign_role": {
      if (!ctx.serverId) return { content: "No active server.", label: "✗ no active server" };
      const username = input.username as string;
      const roleId = (input.role_id as string | null) ?? null;
      const state = useServerStore.getState();
      const serverMembers = state.members[ctx.serverId] ?? [];
      const member = serverMembers.find(
        (m) => m.user?.username === username || m.user?.displayName === username,
      );
      if (!member) return { content: `Member "${username}" not found.`, label: "✗ member not found" };
      if (roleId !== null) {
        const roles = state.roles[ctx.serverId] ?? [];
        const role = roles.find((r) => r.id === roleId);
        if (!role) return { content: `Role ID "${roleId}" not found.`, label: "✗ role not found" };
      }
      await state.assignRole(member.id, ctx.serverId, roleId);
      const label = roleId
        ? `✓ role assigned to ${username}`
        : `✓ role removed from ${username}`;
      const content = roleId
        ? `Role assigned to ${username}.`
        : `Role removed from ${username}.`;
      return { content, label };
    }

    default:
      return { content: `Unknown tool: ${name}`, label: `✗ unknown tool` };
  }
}
