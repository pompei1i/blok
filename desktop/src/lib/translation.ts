import type { Language } from "./store/ui-settings-store";

/**
 * Client-side language guessing for auto-translate.
 *
 * Its only job is to avoid paying for translations we don't need: a message
 * already written in the reader's language is skipped before any network call.
 * Guessing is therefore deliberately asymmetric — it must never claim a language
 * it isn't sure about. "Unknown" costs one API call (the model returns the text
 * unchanged when it's already in the target language, and the result is cached);
 * a wrong "already in your language" silently withholds a translation the user
 * asked for.
 */

export const LANG_TO_CODE: Record<Language, string> = {
  English: "en",
  Russian: "ru",
  Ukrainian: "uk",
  Polish: "pl",
  German: "de",
  Spanish: "es",
};

/** Longest message we bother translating (matches MAX_MESSAGE_LEN). */
export const MAX_TRANSLATE_LEN = 4000;

/**
 * Drop the parts of a message that carry no language: URLs, @mentions,
 * #channels, :emoji_codes:, custom emoji, code spans/fences, and digits.
 * What's left is what the guesser scores.
 */
export function stripNoise(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/[@#]\S+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Marker letters and stopwords per language. Letters are worth less than words:
// a single "ö" shows up in quoted names, while "und" is German prose.
const LETTER_MARKERS: Record<string, RegExp> = {
  ru: /[ыэъё]/g,
  uk: /[іїєґ]/g,
  pl: /[ąćęłńśźż]/g,
  de: /[äöüß]/g,
  es: /[ñ¿¡]/g,
};

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "you", "that", "with", "this", "what", "for", "have", "just", "not", "but", "yeah", "guys", "please", "thanks"],
  ru: ["что", "это", "как", "так", "все", "меня", "тебя", "если", "когда", "привет", "спасибо", "нет", "уже", "можно", "надо", "буду"],
  uk: ["що", "це", "як", "але", "тобі", "мене", "якщо", "коли", "привіт", "дякую", "немає", "вже", "можна", "треба", "буду", "добре"],
  pl: ["nie", "jest", "tak", "czy", "jak", "tego", "dla", "mnie", "ale", "dzięki", "cześć", "dobra", "teraz", "trzeba", "można", "jeszcze"],
  de: ["und", "nicht", "das", "ist", "ich", "aber", "auch", "mit", "noch", "danke", "wenn", "schon", "kann", "wie", "hier", "sehr"],
  es: ["que", "los", "las", "por", "con", "para", "pero", "esto", "muy", "gracias", "hola", "todo", "está", "cuando", "porque", "también"],
};

const LETTER_WEIGHT = 2;
const WORD_WEIGHT = 3;
/** Minimum lead over the runner-up before a guess is trusted. */
const CONFIDENCE_MARGIN = 3;

/**
 * Best-effort language code for a message, or null when unsure.
 * Never returns a language it can't back with several markers.
 */
export function detectLanguage(text: string): string | null {
  const clean = stripNoise(text).toLowerCase();
  if (clean.replace(/[^\p{L}]/gu, "").length < 4) return null;

  const cyrillic = (clean.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latin = (clean.match(/\p{Script=Latin}/gu) ?? []).length;
  // Neither script dominant (e.g. Greek, CJK, Arabic) → let the model decide.
  if (cyrillic === 0 && latin === 0) return null;
  const candidates = cyrillic > latin ? ["ru", "uk"] : ["en", "pl", "de", "es"];

  const words = new Set(clean.split(/[^\p{L}]+/u).filter(Boolean));
  const scores = candidates.map((code) => {
    const letters = (clean.match(LETTER_MARKERS[code] ?? /(?!)/g) ?? []).length;
    const hits = STOPWORDS[code].filter((w) => words.has(w)).length;
    return { code, score: letters * LETTER_WEIGHT + hits * WORD_WEIGHT };
  }).sort((a, b) => b.score - a.score);

  const [best, next] = scores;
  if (best.score === 0 || best.score - (next?.score ?? 0) < CONFIDENCE_MARGIN) return null;
  return best.code;
}

/**
 * Should this message go to the translator at all? Filters out empty text,
 * pure emoji/links/mentions, and anything confidently already in the target
 * language.
 */
export function shouldTranslate(text: string, targetCode: string): boolean {
  if (!text || text.length > MAX_TRANSLATE_LEN) return false;
  const clean = stripNoise(text);
  // Nothing but emoji, a link or a mention — nothing to translate.
  if (clean.replace(/[^\p{L}]/gu, "").length < 2) return false;
  return detectLanguage(text) !== targetCode;
}
