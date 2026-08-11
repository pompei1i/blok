import { useEffect } from "react";
import { useUiSettingsStore } from "@/lib/store/ui-settings-store";
import {
  useTranslationStore,
  targetLangCode,
  entryKey,
  originalKey,
  type TranslationScope,
  type TranslationStatus,
} from "@/lib/store/translation-store";

export interface MessageTranslation {
  /** Translated text to render, or null when the original should stay. */
  text: string | null;
  /** ISO 639-1 code of the original, when the translator reported one. */
  sourceLang: string | null;
  status: TranslationStatus | "off";
  showingOriginal: boolean;
  toggleOriginal: () => void;
}

/**
 * Resolve (and, on first render, request) the translation of one message.
 *
 * Called from the message bubble so every text surface gets auto-translate for
 * free, and so only messages actually rendered — the channel list is
 * virtualized — cost anything. Requests are batched in the store.
 */
export function useMessageTranslation(
  scope: TranslationScope | null,
  parentId: string | undefined,
  messageId: string,
  content: string,
): MessageTranslation {
  const autoTranslate = useUiSettingsStore((s) => s.autoTranslate);
  const language = useUiSettingsStore((s) => s.language);
  const lang = autoTranslate ? targetLangCode() : "";

  const entry = useTranslationStore((s) => (scope && lang ? s.entries[entryKey(scope, messageId, lang)] : undefined));
  const showingOriginal = useTranslationStore((s) => (scope ? s.showOriginal[originalKey(scope, messageId)] ?? false : false));
  const toggle = useTranslationStore((s) => s.toggleOriginal);

  useEffect(() => {
    if (!autoTranslate || !scope || !content) return;
    useTranslationStore.getState().request(scope, parentId ?? "", messageId, content);
    // `language` re-runs the request when the reader switches UI language.
  }, [autoTranslate, language, scope, parentId, messageId, content]);

  if (!autoTranslate || !scope) {
    return { text: null, sourceLang: null, status: "off", showingOriginal: false, toggleOriginal: () => {} };
  }

  return {
    text: entry?.status === "done" && !showingOriginal ? entry.text ?? null : null,
    sourceLang: entry?.sourceLang ?? null,
    status: entry?.status ?? "off",
    showingOriginal,
    toggleOriginal: () => toggle(scope, messageId),
  };
}
