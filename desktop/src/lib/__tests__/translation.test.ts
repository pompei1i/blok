import { describe, it, expect } from "vitest";
import { detectLanguage, shouldTranslate, stripNoise } from "../translation";

// ── stripNoise ────────────────────────────────────────────────────────────────

describe("stripNoise", () => {
  it("drops urls, mentions, channels and emoji codes", () => {
    expect(stripNoise("hey @bob check #general https://a.b/c :smile:")).toBe("hey check");
  });

  it("drops code spans and fences", () => {
    expect(stripNoise("run `npm test` then ```js\nconst a = 1\n``` ok")).toBe("run then ok");
  });

  it("drops unicode emoji", () => {
    expect(stripNoise("nice 🔥🔥 work")).toBe("nice work");
  });
});

// ── detectLanguage ────────────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("detects English from stopwords", () => {
    expect(detectLanguage("what is that thing you have for the server")).toBe("en");
  });

  it("detects Russian", () => {
    expect(detectLanguage("привет, что это такое, можно уже играть?")).toBe("ru");
  });

  it("detects Ukrainian and not Russian", () => {
    expect(detectLanguage("привіт, дякую, вже можна грати? це добре")).toBe("uk");
  });

  it("detects Polish", () => {
    expect(detectLanguage("nie wiem czy to jest dobre, dzięki za pomoc")).toBe("pl");
  });

  it("detects German", () => {
    expect(detectLanguage("ich weiß nicht ob das schon geht, aber danke")).toBe("de");
  });

  it("detects Spanish", () => {
    expect(detectLanguage("hola, gracias por todo, pero esto no está bien")).toBe("es");
  });

  it("returns null for text with no usable signal", () => {
    expect(detectLanguage("ok")).toBeNull();
    expect(detectLanguage("https://example.com")).toBeNull();
    expect(detectLanguage("🔥🔥🔥")).toBeNull();
  });

  it("returns null rather than guessing on a weak signal", () => {
    // Shared across languages, no markers → must not claim a language.
    expect(detectLanguage("lol ping pong")).toBeNull();
  });

  it("ignores scripts it does not know", () => {
    expect(detectLanguage("これはテストです、よろしく")).toBeNull();
  });
});

// ── shouldTranslate ───────────────────────────────────────────────────────────

describe("shouldTranslate", () => {
  it("skips a message already in the target language", () => {
    expect(shouldTranslate("привет, что это такое, можно уже играть?", "ru")).toBe(false);
  });

  it("translates a message in another language", () => {
    expect(shouldTranslate("привет, что это такое, можно уже играть?", "en")).toBe(true);
  });

  it("translates when the language is unclear (the model decides)", () => {
    expect(shouldTranslate("lol ping pong", "ru")).toBe(true);
  });

  it("skips messages with nothing to translate", () => {
    expect(shouldTranslate("🔥", "en")).toBe(false);
    expect(shouldTranslate("https://example.com", "en")).toBe(false);
    expect(shouldTranslate("@bob", "en")).toBe(false);
    expect(shouldTranslate("", "en")).toBe(false);
  });

  it("skips absurdly long input", () => {
    expect(shouldTranslate("привет ".repeat(1000), "en")).toBe(false);
  });
});
