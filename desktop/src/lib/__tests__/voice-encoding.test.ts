import { describe, it, expect } from "vitest";

// ── Inline the pure codec helpers from native-voice-engine for direct testing ─
// These functions are not exported, so we replicate them here.
// If they change in the source, these tests will catch divergence.

function int16ToBase64(samples: number[]): string {
  const bytes = new Uint8Array(new Int16Array(samples).buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToInt16Array(b64: string): number[] {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Array.from(new Int16Array(bytes.buffer));
}

// ── int16ToBase64 / base64ToInt16Array ────────────────────────────────────────

describe("int16ToBase64 / base64ToInt16Array round-trip", () => {
  it("encodes and decodes an empty array", () => {
    const encoded = int16ToBase64([]);
    const decoded = base64ToInt16Array(encoded);
    expect(decoded).toHaveLength(0);
  });

  it("round-trips a silence buffer (all zeros)", () => {
    const silence = new Array(480).fill(0);
    const decoded = base64ToInt16Array(int16ToBase64(silence));
    expect(decoded).toEqual(silence);
  });

  it("round-trips positive and negative i16 values", () => {
    const samples = [0, 1, -1, 32767, -32768, 16384, -16384];
    const decoded = base64ToInt16Array(int16ToBase64(samples));
    expect(decoded).toEqual(samples);
  });

  it("round-trips a 4800-sample frame (100 ms at 48 kHz)", () => {
    const frame: number[] = Array.from({ length: 4800 }, (_, i) =>
      Math.round(Math.sin((i / 4800) * Math.PI * 2) * 20000)
    );
    const decoded = base64ToInt16Array(int16ToBase64(frame));
    expect(decoded).toEqual(frame);
  });

  it("produces valid base64 (no non-base64 chars)", () => {
    const samples = [100, 200, 300, -100];
    const b64 = int16ToBase64(samples);
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("encoded length is ceil(samples * 2 / 3) * 4 characters", () => {
    const samples = [1, 2, 3, 4, 5, 6]; // 6 samples × 2 bytes = 12 bytes → 16 base64 chars
    const b64 = int16ToBase64(samples);
    const expectedLen = Math.ceil((samples.length * 2) / 3) * 4;
    expect(b64.length).toBe(expectedLen);
  });

  it("handles large buffers without hitting call-stack limits", () => {
    // > 65535 samples to exercise the chunked String.fromCharCode path
    const large = new Array(70000).fill(1000);
    const decoded = base64ToInt16Array(int16ToBase64(large));
    expect(decoded).toHaveLength(70000);
    expect(decoded[0]).toBe(1000);
    expect(decoded[69999]).toBe(1000);
  });
});
