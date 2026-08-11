import { create } from "zustand";
import { Languages } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useUiSettingsStore } from "./ui-settings-store";
import { useToastStore } from "./toast-store";
import { translate as t } from "../i18n";
import { LANG_TO_CODE, shouldTranslate } from "../translation";

/**
 * Auto-translation of chat messages.
 *
 * Messages ask for themselves: every rendered bubble calls
 * `useMessageTranslation`, which drops the id into a queue that flushes on a
 * short debounce. That keeps the feature working in every text surface at once
 * (channels, DMs, group DMs) without each of them wiring up its own pass, and
 * because the channel list is virtualized only the messages actually on screen
 * are ever paid for.
 *
 * Results are cached server-side per (message, language) — see the "translate"
 * Edge Function — so this store keeps only an in-memory copy and never persists.
 */

export type TranslationScope = "channel" | "dm";
export type TranslationStatus = "pending" | "done" | "error";

export interface TranslationEntry {
  status: TranslationStatus;
  text?: string;
  /** ISO 639-1 code of the original, as reported by the translator. */
  sourceLang?: string | null;
  /** Source text this entry was produced from — an edit invalidates it. */
  source: string;
  at: number;
}

/** Must not exceed MAX_IDS in supabase/functions/translate. */
const MAX_BATCH = 25;
/** Collect ids for this long before firing, so a screenful costs one call. */
const BATCH_DELAY_MS = 350;
/** A failed message may be retried after this long (transient network errors). */
const RETRY_AFTER_MS = 30_000;
/** In-memory cap; oldest entries are dropped past it. */
const MAX_ENTRIES = 2000;
/** Don't repeat the rate-limit toast more than this often. */
const ERROR_TOAST_INTERVAL_MS = 5 * 60_000;

const entryKey = (scope: TranslationScope, id: string, lang: string) => `${scope}:${id}:${lang}`;
const originalKey = (scope: TranslationScope, id: string) => `${scope}:${id}`;

interface QueueItem {
  scope: TranslationScope;
  parentId: string;
  id: string;
  lang: string;
  /** Text at enqueue time; carried so the resulting entry can be invalidated on edit. */
  source: string;
}

interface TranslationState {
  entries: Record<string, TranslationEntry>;
  /** Messages the reader has flipped back to the original text. */
  showOriginal: Record<string, boolean>;

  request: (scope: TranslationScope, parentId: string, id: string, content: string) => void;
  toggleOriginal: (scope: TranslationScope, id: string) => void;
  reset: () => void;
}

let queue: QueueItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastErrorToast = 0;

/** Current UI language as an ISO 639-1 code. */
export function targetLangCode(): string {
  return LANG_TO_CODE[useUiSettingsStore.getState().language];
}

function trimEntries(entries: Record<string, TranslationEntry>): Record<string, TranslationEntry> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return entries;
  const keep = keys.slice(keys.length - MAX_ENTRIES);
  const out: Record<string, TranslationEntry> = {};
  for (const k of keep) out[k] = entries[k];
  return out;
}

interface TranslateResponse {
  translations: Record<string, { text: string; sourceLang: string | null }>;
}

async function callTranslate(
  scope: TranslationScope,
  lang: string,
  ids: string[],
): Promise<TranslateResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/translate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ scope, lang, ids }),
  });

  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const err = new Error(body?.message ?? "Translation limit reached.");
    err.name = "RateLimited";
    throw err;
  }
  if (!res.ok) throw new Error(`translate failed (${res.status})`);
  return await res.json() as TranslateResponse;
}

function noteError(error: unknown) {
  if (!(error instanceof Error) || error.name !== "RateLimited") return;
  const now = Date.now();
  if (now - lastErrorToast < ERROR_TOAST_INTERVAL_MS) return;
  lastErrorToast = now;
  useToastStore.getState().showToast({
    icon: Languages,
    title: t("translation.limitTitle"),
    message: error.message,
  });
}

async function flush() {
  flushTimer = null;
  const batch = queue;
  queue = [];
  if (!batch.length) return;

  // One call per conversation: the Edge Function only feeds the model preceding
  // messages as context when a batch belongs to a single conversation, and that
  // context is what keeps pronouns and ellipsis correct.
  const groups = new Map<string, QueueItem[]>();
  for (const item of batch) {
    const key = `${item.scope}:${item.parentId}:${item.lang}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  for (const items of groups.values()) {
    const { scope, lang } = items[0];
    for (let i = 0; i < items.length; i += MAX_BATCH) {
      const chunk = items.slice(i, i + MAX_BATCH);
      const ids = chunk.map((c) => c.id);
      try {
        const { translations } = await callTranslate(scope, lang, ids);
        useTranslationStore.setState((state) => {
          const entries = { ...state.entries };
          for (const item of chunk) {
            const hit = translations?.[item.id];
            entries[entryKey(scope, item.id, lang)] = hit
              ? { status: "done", text: hit.text, sourceLang: hit.sourceLang, source: item.source, at: Date.now() }
              : { status: "error", source: item.source, at: Date.now() };
          }
          return { entries: trimEntries(entries) };
        });
      } catch (error) {
        noteError(error);
        useTranslationStore.setState((state) => {
          const entries = { ...state.entries };
          for (const item of chunk) {
            entries[entryKey(scope, item.id, lang)] = { status: "error", source: item.source, at: Date.now() };
          }
          return { entries };
        });
      }
    }
  }
}

export const useTranslationStore = create<TranslationState>()((set, get) => ({
  entries: {},
  showOriginal: {},

  request: (scope, parentId, id, content) => {
    if (!useUiSettingsStore.getState().autoTranslate) return;
    const lang = targetLangCode();
    if (!shouldTranslate(content, lang)) return;

    const key = entryKey(scope, id, lang);
    const existing = get().entries[key];
    if (existing && existing.source === content) {
      const retryable = existing.status === "error" && Date.now() - existing.at > RETRY_AFTER_MS;
      if (!retryable) return;
    }
    if (queue.some((q) => q.id === id && q.lang === lang && q.scope === scope && q.source === content)) return;

    set((state) => ({
      entries: trimEntries({ ...state.entries, [key]: { status: "pending", source: content, at: Date.now() } }),
    }));
    queue.push({ scope, parentId, id, lang, source: content });
    if (!flushTimer) flushTimer = setTimeout(() => { void flush(); }, BATCH_DELAY_MS);
  },

  toggleOriginal: (scope, id) => {
    const key = originalKey(scope, id);
    set((state) => ({ showOriginal: { ...state.showOriginal, [key]: !state.showOriginal[key] } }));
  },

  reset: () => {
    queue = [];
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    set({ entries: {}, showOriginal: {} });
  },
}));

export { entryKey, originalKey };
