// b.ai.t proxy — routes the client's Anthropic-format Messages call to Google
// Gemini (free tier) via Gemini's OpenAI-compatible endpoint, translating the
// request and response so the client stays 100% Anthropic-shaped (content blocks,
// tool_use / tool_result, stop_reason).
//
// Why Gemini: the Anthropic key ran out of credits; Gemini Flash has a generous
// free tier and supports function calling. The client's tool-use loop is unchanged.
//
// Auth: the caller's Supabase JWT. Rate-limited per user, forces a cheap model +
// token cap. The Gemini key stays a server-side secret.
//
// Deploy:
//   supabase secrets set GEMINI_API_KEY=...
//   supabase functions deploy bait
// (Still requires the 20260616_bait_rate_limit migration — bait_rate_check RPC.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODEL = "gemini-flash-latest"; // cheap/free Flash; forced regardless of client
const RATE_MAX = 10;          // burst: requests per window, per user
const RATE_WINDOW_SECS = 60;  // window = 1 minute
const DAILY_MAX = 30;         // per-user daily cap (free tier is generous; beta guard)
const MAX_TOKENS_CAP = 1024;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

// ── Anthropic → OpenAI translation ────────────────────────────────────────────

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}
interface AnthropicMsg { role: "user" | "assistant"; content: string | AnthropicBlock[]; }

// Gemini requires the thought_signature it emits on a tool call to be sent back
// on the follow-up round, but the client only round-trips Anthropic-shaped blocks
// (no place for it) — so we pack it into the tool_use id and unpack it here. The
// separator is chosen not to collide with Gemini's short alphanumeric ids.
const SIG_SEP = "::sig::";
function joinSig(id: string, sig: string): string {
  return sig ? `${id}${SIG_SEP}${sig}` : id;
}
function splitSig(combined: string): [string, string] {
  const i = combined.indexOf(SIG_SEP);
  return i === -1 ? [combined, ""] : [combined.slice(0, i), combined.slice(i + SIG_SEP.length)];
}

// Gemini's schema validator is stricter than Anthropic's. Strip fields it rejects
// and collapse union `type: ["string","null"]` to the first concrete type.
function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$schema" || k === "additionalProperties") continue;
      if (k === "type" && Array.isArray(v)) {
        out[k] = (v.find((t) => t !== "null") ?? "string");
        continue;
      }
      out[k] = sanitizeSchema(v);
    }
    return out;
  }
  return node;
}

function systemToText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return (system as Array<{ text?: string }>).map((b) => b.text ?? "").join("");
  }
  return "";
}

function toOpenAIMessages(system: unknown, messages: AnthropicMsg[]): unknown[] {
  const out: unknown[] = [];
  const sys = systemToText(system);
  if (sys.trim()) out.push({ role: "system", content: sys });
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const toolUses = m.content.filter((b) => b.type === "tool_use");
      const msg: Record<string, unknown> = { role: "assistant", content: text || null };
      if (toolUses.length) {
        msg.tool_calls = toolUses.map((b) => {
          const [id, sig] = splitSig(b.id ?? "");
          const call: Record<string, unknown> = {
            id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          };
          // Gemini rejects a follow-up whose tool call lacks the thought_signature
          // it produced — we smuggled it through the tool_use id and restore it here.
          if (sig) call.extra_content = { google: { thought_signature: sig } };
          return call;
        });
      }
      out.push(msg);
    } else {
      // user: split into tool results (→ role:"tool") and plain text.
      const toolResults = m.content.filter((b) => b.type === "tool_result");
      const textBlocks = m.content.filter((b) => b.type === "text");
      for (const tr of toolResults) {
        const content = typeof tr.content === "string"
          ? tr.content
          : Array.isArray(tr.content)
            ? (tr.content as AnthropicBlock[]).map((c) => c.text ?? "").join("")
            : JSON.stringify(tr.content ?? "");
        out.push({ role: "tool", tool_call_id: splitSig(tr.tool_use_id ?? "")[0], content });
      }
      const text = textBlocks.map((b) => b.text).join("");
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}

// ── OpenAI → Anthropic translation ────────────────────────────────────────────

function toAnthropicResponse(oai: Record<string, unknown>): Record<string, unknown> {
  const choice = (oai.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const content: AnthropicBlock[] = [];
  if (typeof message.content === "string" && message.content) {
    content.push({ type: "text", text: message.content });
  }
  const toolCalls = (message.tool_calls as Array<Record<string, unknown>> | undefined) ?? [];
  for (const tc of toolCalls) {
    const fn = (tc.function ?? {}) as Record<string, unknown>;
    let args: unknown = {};
    try { args = JSON.parse((fn.arguments as string) || "{}"); } catch { args = {}; }
    const sig = (((tc.extra_content as Record<string, unknown>)?.google as Record<string, unknown>)?.thought_signature as string) ?? "";
    const id = joinSig((tc.id as string) ?? crypto.randomUUID(), sig);
    content.push({ type: "tool_use", id, name: fn.name as string, input: args });
  }
  const stop = toolCalls.length ? "tool_use" : "end_turn";
  const usage = (oai.usage ?? {}) as Record<string, number>;
  return {
    id: (oai.id as string) ?? crypto.randomUUID(),
    type: "message",
    role: "assistant",
    model: MODEL,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return json({ error: "server_misconfigured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

  const { data: allowed, error: rlErr } = await supabase.rpc("bait_rate_check", {
    p_max: RATE_MAX,
    p_window_secs: RATE_WINDOW_SECS,
    p_daily_max: DAILY_MAX,
  });
  if (rlErr) return json({ error: "rate_check_failed" }, 500);
  if (!allowed) return json({ error: "rate_limited", message: `Limit reached (${RATE_MAX}/min or ${DAILY_MAX}/day).` }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  // Build the OpenAI-compatible request from the client's Anthropic-shaped body.
  const messages = toOpenAIMessages(body.system, (body.messages as AnthropicMsg[]) ?? []);
  const tools = Array.isArray(body.tools)
    ? (body.tools as Array<Record<string, unknown>>).map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: sanitizeSchema(t.input_schema) ?? { type: "object", properties: {} },
        },
      }))
    : undefined;

  const payload: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
  };
  if (tools && tools.length) payload.tools = tools;

  const resp = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${geminiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return json({ error: "upstream_error", status: resp.status, detail: detail.slice(0, 500) }, resp.status);
  }

  const oai = await resp.json();
  return json(toAnthropicResponse(oai));
});
