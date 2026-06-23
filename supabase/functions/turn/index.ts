// TURN credentials proxy — issues short-lived Cloudflare TURN credentials to
// authenticated blok users.
//
// Why a proxy: WebRTC (screen share / camera / video calls) needs a TURN relay
// when both peers are behind strict NAT. Cloudflare's TURN credentials are
// short-lived and minted via an API token that must stay server-side — if it (or
// static creds) shipped in the desktop binary, anyone could extract and abuse the
// relay. So the client calls this function with its JWT, and we mint fresh creds.
//
// Deploy:
//   supabase secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=...
//   supabase functions deploy turn
//
// Get the Key ID + API Token from Cloudflare dashboard → Realtime → TURN Keys.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TTL_SECS = 86400; // 24h — comfortably outlives any voice session

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

  const keyId = Deno.env.get("CF_TURN_KEY_ID");
  const apiToken = Deno.env.get("CF_TURN_API_TOKEN");
  if (!keyId || !apiToken) return json({ error: "server_misconfigured" }, 500);

  // Only hand TURN credentials to a real, authenticated blok user.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

  const cfRes = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: TTL_SECS }),
    },
  );
  if (!cfRes.ok) {
    return json({ error: "cloudflare_failed", status: cfRes.status, detail: await cfRes.text() }, 502);
  }

  // Cloudflare returns { iceServers: { urls: [...], username, credential } }.
  const data = await cfRes.json();
  return json({ iceServers: data.iceServers, ttl: TTL_SECS });
});
