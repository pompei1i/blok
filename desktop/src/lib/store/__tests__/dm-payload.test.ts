import { describe, it, expect } from "vitest";
import { parseDMContent, buildDMContent, DM_PAYLOAD_PREFIX } from "../dm-store";
import type { Attachment } from "../types";

// ── parseDMContent ────────────────────────────────────────────────────────────

describe("parseDMContent", () => {
  it("returns raw text unchanged when no prefix", () => {
    const result = parseDMContent("hello world");
    expect(result.content).toBe("hello world");
    expect(result.attachments).toHaveLength(0);
  });

  it("returns empty string for empty input", () => {
    const result = parseDMContent("");
    expect(result.content).toBe("");
    expect(result.attachments).toHaveLength(0);
  });

  it("parses text-only payload correctly", () => {
    const raw = `${DM_PAYLOAD_PREFIX}${JSON.stringify({ text: "hi there", attachments: [] })}`;
    const result = parseDMContent(raw);
    expect(result.content).toBe("hi there");
    expect(result.attachments).toHaveLength(0);
  });

  it("parses payload with attachments", () => {
    const payload = {
      text: "check this file",
      attachments: [
        {
          url: "data:image/png;base64,abc",
          filename: "photo.png",
          mediaType: "image/png",
          sizeBytes: 1024,
        },
      ],
    };
    const raw = `${DM_PAYLOAD_PREFIX}${JSON.stringify(payload)}`;
    const result = parseDMContent(raw);
    expect(result.content).toBe("check this file");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("photo.png");
    expect(result.attachments[0].url).toBe("data:image/png;base64,abc");
    expect(result.attachments[0].sizeBytes).toBe(1024);
  });

  it("falls back gracefully on malformed JSON", () => {
    const raw = `${DM_PAYLOAD_PREFIX}not valid json`;
    const result = parseDMContent(raw);
    // Should not throw and should return raw content as fallback
    expect(result.attachments).toHaveLength(0);
  });

  it("handles payload with missing text field", () => {
    const raw = `${DM_PAYLOAD_PREFIX}${JSON.stringify({ attachments: [] })}`;
    const result = parseDMContent(raw);
    expect(result.content).toBe("");
  });
});

// ── buildDMContent ────────────────────────────────────────────────────────────

describe("buildDMContent", () => {
  it("returns plain text when no attachments", () => {
    expect(buildDMContent("hello", [])).toBe("hello");
  });

  it("encodes text and attachments as prefixed JSON", () => {
    const attachments: Attachment[] = [
      {
        id: "a1",
        messageId: "m1",
        url: "data:image/png;base64,xyz",
        filename: "img.png",
        mediaType: "image/png",
        sizeBytes: 512,
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    const result = buildDMContent("see attached", attachments);
    expect(result.startsWith(DM_PAYLOAD_PREFIX)).toBe(true);
    const parsed = JSON.parse(result.slice(DM_PAYLOAD_PREFIX.length));
    expect(parsed.text).toBe("see attached");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe("img.png");
  });

  it("round-trips text + attachments through build → parse", () => {
    const attachments: Attachment[] = [
      {
        id: "x1",
        messageId: "m1",
        url: "data:text/plain;base64,dGVzdA==",
        filename: "doc.txt",
        mediaType: "text/plain",
        sizeBytes: 4,
        createdAt: "2024-06-01T00:00:00Z",
      },
    ];
    const encoded = buildDMContent("original message", attachments);
    const decoded = parseDMContent(encoded);
    expect(decoded.content).toBe("original message");
    expect(decoded.attachments).toHaveLength(1);
    expect(decoded.attachments[0].filename).toBe("doc.txt");
    expect(decoded.attachments[0].url).toBe("data:text/plain;base64,dGVzdA==");
  });

  it("round-trips empty message with multiple attachments", () => {
    const attachments: Attachment[] = [
      { id: "1", messageId: "m", url: "data:a", filename: "a.png", mediaType: "image/png", sizeBytes: 10, createdAt: "" },
      { id: "2", messageId: "m", url: "data:b", filename: "b.png", mediaType: "image/png", sizeBytes: 20, createdAt: "" },
    ];
    const decoded = parseDMContent(buildDMContent("", attachments));
    expect(decoded.content).toBe("");
    expect(decoded.attachments).toHaveLength(2);
  });
});
