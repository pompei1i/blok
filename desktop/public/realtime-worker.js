// Supabase Realtime heartbeat ticker (see `realtime.worker` in supabaseClient.ts).
// Same script realtime-js inlines as a blob: URL, served from 'self' instead so
// the Tauri CSP doesn't need to allow blob: workers.
addEventListener("message", (e) => {
  if (e.data.event === "start") {
    setInterval(() => postMessage({ event: "keepAlive" }), e.data.interval);
  }
});
