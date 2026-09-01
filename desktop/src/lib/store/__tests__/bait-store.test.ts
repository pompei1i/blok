import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { supabase } from "@/lib/supabaseClient";
import { callBaitProxy, baitDailyRemaining, BAIT_DAILY_LIMIT } from "../bait-store";
import type Anthropic from "@anthropic-ai/sdk";

const PARAMS = {
  model: "claude",
  max_tokens: 256,
  messages: [{ role: "user" as const, content: "ку" }],
} as Anthropic.MessageCreateParamsNonStreaming;

const OK_BODY = { id: "msg_1", role: "assistant", content: [] };

const fetchMock = () => globalThis.fetch as ReturnType<typeof vi.fn>;

/** One `fetch` result: a status plus the body the proxy would return. */
function reply(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
  };
}

/** Drives the promise while letting the retry backoff timers fire. */
async function settle<T>(p: Promise<T>): Promise<T | Error> {
  const done: Promise<T | Error> = p.catch((e: Error) => e);
  await vi.advanceTimersByTimeAsync(10_000);
  return await done;
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.fetch = vi.fn();
  (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: { session: { access_token: "token" } },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("callBaitProxy transient retries", () => {
  // The regression: the proxy switched from Anthropic to Gemini, whose overload
  // is a 503, while the retry still only recognised Anthropic's 529 — so every
  // "model is experiencing high demand" blip hit the user directly.
  it("retries a 503 overload and returns the eventual success", async () => {
    fetchMock()
      .mockResolvedValueOnce(reply(503, { error: "upstream_error" }))
      .mockResolvedValueOnce(reply(200, OK_BODY));

    const result = await settle(callBaitProxy(PARAMS));

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(result).toEqual(OK_BODY);
  });

  it("still retries Anthropic's 529, which the proxy may pass through", async () => {
    fetchMock()
      .mockResolvedValueOnce(reply(529, { error: "overloaded" }))
      .mockResolvedValueOnce(reply(200, OK_BODY));

    expect(await settle(callBaitProxy(PARAMS))).toEqual(OK_BODY);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it("gives up after a bounded number of attempts", async () => {
    fetchMock().mockResolvedValue(reply(503, { error: "upstream_error" }));

    const err = await settle(callBaitProxy(PARAMS));

    expect(err).toBeInstanceOf(Error);
    // One initial call plus two retries — a stuck upstream must not spin forever.
    expect(fetchMock()).toHaveBeenCalledTimes(3);
  });

  it("does not retry a client error", async () => {
    fetchMock().mockResolvedValue(reply(400, { error: "bad_request" }));

    await settle(callBaitProxy(PARAMS));

    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rate limit, and surfaces the server's own wording", async () => {
    fetchMock().mockResolvedValue(reply(429, { message: "Limit reached (10/min or 10/day)." }));

    const err = await settle(callBaitProxy(PARAMS));

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect((err as Error).message).toBe("Limit reached (10/min or 10/day).");
  });
});

describe("callBaitProxy error surfacing", () => {
  it("shows the proxy's plain-language message instead of raw upstream JSON", async () => {
    const message = "b.ai.t is busy right now — the model is overloaded. Try again in a moment.";
    fetchMock().mockResolvedValue(
      reply(503, { error: "upstream_error", status: 503, message, detail: '[{\n  "error": {\n "code": 503' }),
    );

    const err = await settle(callBaitProxy(PARAMS));

    expect((err as Error).message).toBe(message);
  });

  it("falls back to the raw detail when the body carries no message", async () => {
    fetchMock().mockResolvedValue(reply(502, { error: "upstream_error", detail: "bad gateway" }));

    const err = await settle(callBaitProxy(PARAMS));

    expect((err as Error).message).toContain("502");
    expect((err as Error).message).toContain("bad gateway");
  });
});

describe("baitDailyRemaining", () => {
  it("counts only calls inside the rolling 24h window", () => {
    const now = Date.now();
    const log = [now - 25 * 60 * 60 * 1000, now - 60_000, now];
    expect(baitDailyRemaining(log)).toBe(BAIT_DAILY_LIMIT - 2);
  });

  it("never reports a negative remainder", () => {
    const now = Date.now();
    expect(baitDailyRemaining(Array(BAIT_DAILY_LIMIT + 5).fill(now))).toBe(0);
  });
});
