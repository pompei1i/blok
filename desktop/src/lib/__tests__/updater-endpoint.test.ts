import { describe, it, expect } from "vitest";

// Latest.json lives on the public blok-releases repo so Tauri's updater can
// fetch it without authentication. These tests verify it remains accessible
// and structurally valid.
//
// Skipped by default to keep CI offline-friendly.
// Run with:  TEST_UPDATER=1 npx vitest run --reporter=verbose

const LATEST_JSON_URL =
  "https://github.com/pompei1i/blok-releases/releases/latest/download/latest.json";

const runIf = process.env.TEST_UPDATER ? describe : describe.skip;

runIf("auto-updater: latest.json endpoint (network)", () => {
  it("is publicly accessible (HTTP 200)", async () => {
    const res = await fetch(LATEST_JSON_URL, { redirect: "follow" });
    expect(res.ok).toBe(true);
  });

  it("returns valid JSON with required Tauri updater fields", async () => {
    const res = await fetch(LATEST_JSON_URL, { redirect: "follow" });
    const json = await res.json();
    expect(typeof json.version).toBe("string");
    expect(typeof json.notes).toBe("string");
    expect(typeof json.pub_date).toBe("string");
    expect(typeof json.platforms).toBe("object");
    expect(json.platforms).not.toBeNull();
  });

  it("each platform entry has non-empty url and signature", async () => {
    const res = await fetch(LATEST_JSON_URL, { redirect: "follow" });
    const json = await res.json() as { platforms: Record<string, { url: string; signature: string }> };
    const entries = Object.entries(json.platforms);
    expect(entries.length).toBeGreaterThan(0);
    for (const [platform, entry] of entries) {
      expect(entry.url, `${platform}.url`).toBeTruthy();
      expect(entry.signature, `${platform}.signature`).toBeTruthy();
      // Signature must not be empty — a blank sig would silently pass Tauri's check
      expect(entry.signature.trim().length, `${platform}.signature non-empty`).toBeGreaterThan(0);
    }
  });

  it("latest.json has no UTF-8 BOM (would break JSON.parse)", async () => {
    const res = await fetch(LATEST_JSON_URL, { redirect: "follow" });
    const bytes = new Uint8Array(await res.arrayBuffer());
    // BOM is EF BB BF
    expect(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF).toBe(false);
  });
});
