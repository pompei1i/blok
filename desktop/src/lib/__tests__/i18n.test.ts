import { describe, it, expect } from "vitest";
import en from "@/locales/en.json";
import ru from "@/locales/ru.json";
import uk from "@/locales/uk.json";
import pl from "@/locales/pl.json";
import de from "@/locales/de.json";
import es from "@/locales/es.json";

const allLocales = { en, ru, uk, pl, de, es };
const enKeys = Object.keys(en) as (keyof typeof en)[];

// ── Coverage: every locale has all English keys ───────────────────────────────

describe("translation coverage", () => {
  for (const [lang, locale] of Object.entries(allLocales)) {
    if (lang === "en") continue;
    it(`${lang}.json has all keys from en.json`, () => {
      const missing = enKeys.filter((k) => !(k in locale));
      expect(missing, `Missing keys in ${lang}: ${missing.join(", ")}`).toHaveLength(0);
    });

    it(`${lang}.json has no extra keys absent from en.json`, () => {
      const enKeySet = new Set(enKeys);
      const extra = Object.keys(locale).filter((k) => !enKeySet.has(k as keyof typeof en));
      expect(extra, `Extra keys in ${lang}: ${extra.join(", ")}`).toHaveLength(0);
    });
  }
});

// ── English spot-checks ───────────────────────────────────────────────────────

describe("English values", () => {
  it("settings.title", () => expect(en["settings.title"]).toBe("Settings"));
  it("settings.tab.* all present", () => {
    expect(en["settings.tab.account"]).toBe("Account");
    expect(en["settings.tab.audio"]).toBe("Audio");
    expect(en["settings.tab.video"]).toBe("Video");
    expect(en["settings.tab.hotkeys"]).toBe("Hotkeys");
    expect(en["settings.tab.system"]).toBe("System");
  });
  it("auth keys truthy", () => {
    expect(en["auth.login"]).toBeTruthy();
    expect(en["auth.register"]).toBeTruthy();
    expect(en["auth.email"]).toBeTruthy();
    expect(en["auth.password"]).toBeTruthy();
  });
  it("userBar keys truthy", () => {
    expect(en["userBar.mute"]).toBeTruthy();
    expect(en["userBar.unmute"]).toBeTruthy();
    expect(en["userBar.deafen"]).toBeTruthy();
    expect(en["userBar.settings"]).toBeTruthy();
  });
});

// ── Non-English spot-checks ───────────────────────────────────────────────────

describe("non-English values differ from English", () => {
  it("ru settings.title differs", () => expect(ru["settings.title"]).not.toBe(en["settings.title"]));
  it("uk settings.title differs", () => expect(uk["settings.title"]).not.toBe(en["settings.title"]));
  it("pl settings.title differs", () => expect(pl["settings.title"]).not.toBe(en["settings.title"]));
  it("de settings.title differs", () => expect(de["settings.title"]).not.toBe(en["settings.title"]));
  it("es settings.title differs", () => expect(es["settings.title"]).not.toBe(en["settings.title"]));
});
