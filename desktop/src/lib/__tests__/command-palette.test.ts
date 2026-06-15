import { describe, it, expect } from "vitest";
import { scoreMatch, filterCommandItems, type PaletteItem } from "../command-palette";

function item(type: PaletteItem["type"], id: string, label: string, sublabel?: string): PaletteItem {
  return { type, key: `${type}:${id}`, id, label, sublabel };
}

describe("scoreMatch", () => {
  it("returns 0 for an empty query", () => {
    expect(scoreMatch("anything", "")).toBe(0);
  });
  it("returns null when there is no match", () => {
    expect(scoreMatch("general", "xyz")).toBeNull();
  });
  it("ranks a prefix match best (-1)", () => {
    expect(scoreMatch("general", "gen")).toBe(-1);
  });
  it("scores later matches by offset", () => {
    expect(scoreMatch("the-general", "general")).toBe(4);
  });
  it("is case-insensitive", () => {
    expect(scoreMatch("General", "gen")).toBe(-1);
  });
});

describe("filterCommandItems", () => {
  const items: PaletteItem[] = [
    item("server", "s1", "Gaming"),
    item("channel", "c1", "general", "Gaming"),
    item("channel", "c2", "off-topic", "Gaming"),
    item("person", "u1", "alice"),
    item("person", "u2", "bob"),
  ];

  it("returns the head of the list (capped) for an empty query", () => {
    expect(filterCommandItems(items, "", 3)).toHaveLength(3);
    expect(filterCommandItems(items, "   ")).toEqual(items);
  });

  it("matches on the label", () => {
    const res = filterCommandItems(items, "alice");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("u1");
  });

  it("matches on the sublabel (channel's server name)", () => {
    const res = filterCommandItems(items, "gaming");
    // server "Gaming" (prefix on label) + two channels (sublabel match)
    expect(res.map((r) => r.id)).toEqual(["s1", "c1", "c2"]);
  });

  it("prefix matches outrank mid-string matches", () => {
    const list = [item("channel", "a", "the-general"), item("channel", "b", "general")];
    const res = filterCommandItems(list, "general");
    expect(res[0].id).toBe("b");
  });

  it("respects the limit", () => {
    expect(filterCommandItems(items, "", 2)).toHaveLength(2);
  });
});
