import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { supabase } from "@/lib/supabaseClient";
import { useTranslationStore } from "../translation-store";
import { useUiSettingsStore } from "../ui-settings-store";

const RU = "привет, что это такое, можно уже играть?";
const EN = "what is that thing you have for the server";

/** Every fetch body the store sent, parsed. */
function calls(): Array<{ scope: string; lang: string; ids: string[] }> {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
    ([, init]) => JSON.parse((init as RequestInit).body as string),
  );
}

function respondWith(translations: Record<string, { text: string; sourceLang: string }>) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ translations }),
  });
}

/** Run the debounce and let the resulting promise chain settle. */
async function flushQueue() {
  await vi.advanceTimersByTimeAsync(400);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.fetch = vi.fn();
  respondWith({});
  (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: { session: { access_token: "token" } },
  });
  useUiSettingsStore.setState({ language: "English", autoTranslate: true });
  useTranslationStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── batching ──────────────────────────────────────────────────────────────────

describe("batching", () => {
  it("collects a screenful of messages into a single call", async () => {
    respondWith({ m1: { text: "a", sourceLang: "ru" }, m2: { text: "b", sourceLang: "ru" } });
    const { request } = useTranslationStore.getState();
    request("channel", "c1", "m1", RU);
    request("channel", "c1", "m2", RU);
    await flushQueue();

    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ scope: "channel", lang: "en", ids: ["m1", "m2"] });
  });

  it("splits per conversation so each call keeps its own context", async () => {
    const { request } = useTranslationStore.getState();
    request("channel", "c1", "m1", RU);
    request("dm", "d1", "m2", RU);
    await flushQueue();

    expect(calls()).toHaveLength(2);
    expect(calls().map((c) => c.scope).sort()).toEqual(["channel", "dm"]);
  });

  it("chunks past the server's per-request cap", async () => {
    const { request } = useTranslationStore.getState();
    for (let i = 0; i < 30; i++) request("channel", "c1", `m${i}`, RU);
    await flushQueue();

    const sizes = calls().map((c) => c.ids.length);
    expect(sizes).toEqual([25, 5]);
  });

  it("does not re-request a message it already has", async () => {
    respondWith({ m1: { text: "перевод", sourceLang: "ru" } });
    useTranslationStore.getState().request("channel", "c1", "m1", RU);
    await flushQueue();
    useTranslationStore.getState().request("channel", "c1", "m1", RU);
    await flushQueue();

    expect(calls()).toHaveLength(1);
    expect(useTranslationStore.getState().entries["channel:m1:en"]).toMatchObject({
      status: "done",
      text: "перевод",
    });
  });

  it("re-requests after the message is edited", async () => {
    respondWith({ m1: { text: "перевод", sourceLang: "ru" } });
    useTranslationStore.getState().request("channel", "c1", "m1", RU);
    await flushQueue();
    useTranslationStore.getState().request("channel", "c1", "m1", `${RU} и ещё немного текста`);
    await flushQueue();

    expect(calls()).toHaveLength(2);
  });
});

// ── skipping ──────────────────────────────────────────────────────────────────

describe("skipping", () => {
  it("does nothing while auto-translate is off", async () => {
    useUiSettingsStore.setState({ autoTranslate: false });
    useTranslationStore.getState().request("channel", "c1", "m1", RU);
    await flushQueue();

    expect(calls()).toHaveLength(0);
  });

  it("skips a message already in the reader's language", async () => {
    useTranslationStore.getState().request("channel", "c1", "m1", EN);
    await flushQueue();

    expect(calls()).toHaveLength(0);
    expect(useTranslationStore.getState().entries["channel:m1:en"]).toBeUndefined();
  });

  it("keys entries by language so switching UI language re-translates", async () => {
    useTranslationStore.getState().request("channel", "c1", "m1", RU);
    await flushQueue();
    useUiSettingsStore.setState({ language: "Polish" });
    useTranslationStore.getState().request("channel", "c1", "m1", RU);
    await flushQueue();

    expect(calls().map((c) => c.lang)).toEqual(["en", "pl"]);
  });
});

// ── failures ──────────────────────────────────────────────────────────────────

describe("failures", () => {
  it("marks the message failed and stops retrying on the next render", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    useTranslationStore.getState().request("channel", "c1", "m1", RU);
    await flushQueue();

    expect(useTranslationStore.getState().entries["channel:m1:en"]).toMatchObject({ status: "error" });

    useTranslationStore.getState().request("channel", "c1", "m1", RU);
    await flushQueue();
    expect(calls()).toHaveLength(1);
  });

  it("marks messages the translator left out as failed", async () => {
    respondWith({ m1: { text: "перевод", sourceLang: "ru" } });
    const { request } = useTranslationStore.getState();
    request("channel", "c1", "m1", RU);
    request("channel", "c1", "m2", RU);
    await flushQueue();

    const { entries } = useTranslationStore.getState();
    expect(entries["channel:m1:en"].status).toBe("done");
    expect(entries["channel:m2:en"].status).toBe("error");
  });
});

// ── show original ─────────────────────────────────────────────────────────────

describe("showOriginal", () => {
  it("toggles per message", () => {
    const { toggleOriginal } = useTranslationStore.getState();
    toggleOriginal("channel", "m1");
    expect(useTranslationStore.getState().showOriginal["channel:m1"]).toBe(true);
    toggleOriginal("channel", "m1");
    expect(useTranslationStore.getState().showOriginal["channel:m1"]).toBe(false);
  });
});
