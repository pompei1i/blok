// b.ai.t proxy — keeps the Anthropic API key server-side.
//
// The desktop client used to bundle VITE_BAIT_DEFAULT_KEY, so anyone could
// extract it from the binary and spend the owner's money. This function holds the
// key in a Supabase secret instead, authenticates the caller via their JWT, rate
// limits per user, and forwards a single Messages API call to Anthropic. The
// client still runs the tool-use loop (tools are local app actions) — it just
// routes each Anthropic call through here.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy bait
//
// Requires the 20260616_bait_rate_limit migration (bait_rate_check RPC).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const RATE_MAX = 10;          // burst: requests per window, per user
const RATE_WINDOW_SECS = 60;  // window = 1 minute
const DAILY_MAX = 10;         // hard cap: requests per day, per user (beta cost guard).
                             // Note: a single b.ai.t message with tool use = 2-3 calls.
const MAX_TOKENS_CAP = 1024;
const MODEL = "claude-haiku-4-5-20251001"; // forced: cheap model only

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "server_misconfigured" }, 500);

  // Verify the user + rate-limit using their token (so auth.uid() is the caller).
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

  // Hard caps regardless of what the client sends — prevents requesting an
  // expensive model or huge outputs to run up the bill.
  const params = {
    ...body,
    model: MODEL,
    max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
  };

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(params),
  });

  // Pass Anthropic's response (and status, e.g. 529 overloaded) straight through.
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { ...cors, "content-type": "application/json" },
  });
});
