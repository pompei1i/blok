import { describe, it, expect } from "vitest";
import { cn, mapProfile } from "../utils";

// ── cn (class merging) ────────────────────────────────────────────────────────

describe("cn", () => {
  it("returns a single class unchanged", () => {
    expect(cn("foo")).toBe("foo");
  });

  it("joins multiple classes", () => {
    expect(cn("foo", "bar", "baz")).toBe("foo bar baz");
  });

  it("ignores falsy values", () => {
    expect(cn("foo", false, null, undefined, "bar")).toBe("foo bar");
  });

  it("handles conditional object syntax", () => {
    expect(cn({ active: true, inactive: false })).toBe("active");
  });

  it("deduplicates conflicting Tailwind utilities (twMerge)", () => {
    // twMerge should keep the last conflicting class
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("bg-red-500 p-2", "bg-blue-500")).toBe("p-2 bg-blue-500");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });

  it("handles array input", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });
});

// ── mapProfile ────────────────────────────────────────────────────────────────

describe("mapProfile", () => {
  it("maps required fields", () => {
    const row = { id: "u1", username: "alice", email: "a@a.com", created_at: "2024-01-01" };
    const user = mapProfile(row);
    expect(user.id).toBe("u1");
    expect(user.username).toBe("alice");
    // email is intentionally NOT mapped from profiles (PII); it comes from the auth session
    expect(user.email).toBeUndefined();
    expect(user.createdAt).toBe("2024-01-01");
  });

  it("maps snake_case to camelCase", () => {
    const row = {
      id: "u2", username: "bob", email: "b@b.com", created_at: "2024-01-02",
      display_name: "Bob Smith",
      avatar_url: "https://example.com/bob.jpg",
      status_message: "Hello world",
      accent_color: "#ff0000",
    };
    const user = mapProfile(row);
    expect(user.displayName).toBe("Bob Smith");
    expect(user.avatarUrl).toBe("https://example.com/bob.jpg");
    expect(user.statusMessage).toBe("Hello world");
    expect(user.accentColor).toBe("#ff0000");
  });

  it("leaves optional fields undefined when null in DB", () => {
    const row = {
      id: "u3", username: "carol", email: "c@c.com", created_at: "2024-01-03",
      display_name: null, avatar_url: null, bio: null,
      status_message: null, accent_color: null, pronouns: null,
    };
    const user = mapProfile(row);
    expect(user.displayName).toBeUndefined();
    expect(user.avatarUrl).toBeUndefined();
    expect(user.bio).toBeUndefined();
    expect(user.statusMessage).toBeUndefined();
    expect(user.accentColor).toBeUndefined();
    expect(user.pronouns).toBeUndefined();
  });

  it("maps pronouns field", () => {
    const row = { id: "u4", username: "dave", email: "d@d.com", created_at: "2024-01-04", pronouns: "they/them" };
    const user = mapProfile(row);
    expect(user.pronouns).toBe("they/them");
  });

  it("maps banner_url and cosmetics snapshot", () => {
    const row = {
      id: "u5", username: "erin", email: "e@e.com", created_at: "2024-01-05",
      banner_url: "https://example.com/banner.png",
      cosmetics: { nameplate: { id: "np_crimson", rarity: "common", payload: { color: "#e74c3c" } } },
    };
    const user = mapProfile(row);
    expect(user.bannerUrl).toBe("https://example.com/banner.png");
    expect(user.cosmetics?.nameplate?.id).toBe("np_crimson");
  });
});
