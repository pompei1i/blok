import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  H264Receiver,
  canDecodeH264,
  codecFromAnnexB,
  resetDecodeSupportCache,
} from "../h264-receiver";

// ── WebCodecs stand-ins (jsdom has none) ─────────────────────────────────────

class FakeChunk {
  type: string;
  timestamp: number;
  data: Uint8Array;
  constructor(init: { type: string; timestamp: number; data: Uint8Array }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.data = init.data;
  }
}

class FakeDecoder {
  static instances: FakeDecoder[] = [];
  state = "unconfigured";
  decodeQueueSize = 0;
  config: { codec: string } | null = null;
  decoded: FakeChunk[] = [];
  constructor(public init: { output: (f: unknown) => void; error: (e: unknown) => void }) {
    FakeDecoder.instances.push(this);
  }
  configure(config: { codec: string }) {
    this.config = config;
    this.state = "configured";
  }
  decode(chunk: FakeChunk) {
    this.decoded.push(chunk);
  }
  close() {
    this.state = "closed";
  }
}

const SPS = [0, 0, 0, 1, 0x67, 0x4d, 0x40, 0x28, 0xaa]; // Main, level 4.0
const IDR = [0, 0, 1, 0x65, 0x88];
const P = [0, 0, 1, 0x41, 0x9a];

function frame(key: boolean, timestamp: number, nals: number[]): Uint8Array {
  const out = new Uint8Array(9 + nals.length);
  out[0] = key ? 1 : 0;
  new DataView(out.buffer).setBigUint64(1, BigInt(timestamp), true);
  out.set(nals, 9);
  return out;
}

function makeReceiver() {
  const canvas = document.createElement("canvas");
  const drawImage = vi.fn();
  const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
  const requestKeyframe = vi.fn();
  let clock = 0;
  const receiver = new H264Receiver(canvas, ctx, requestKeyframe, () => clock);
  return { receiver, canvas, drawImage, requestKeyframe, advance: (ms: number) => (clock += ms) };
}

beforeEach(() => {
  FakeDecoder.instances = [];
  vi.stubGlobal("VideoDecoder", FakeDecoder);
  vi.stubGlobal("EncodedVideoChunk", FakeChunk);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetDecodeSupportCache();
});

describe("codecFromAnnexB", () => {
  it("builds avc1.PPCCLL from the SPS", () => {
    expect(codecFromAnnexB(new Uint8Array([...SPS, 0, 0, 1, 0x68, 1, ...IDR]))).toBe("avc1.4D4028");
  });

  it("returns null without an SPS", () => {
    expect(codecFromAnnexB(new Uint8Array(P))).toBeNull();
  });
});

describe("H264Receiver", () => {
  it("skips inter frames until a keyframe, asking the sharer for one", () => {
    const { receiver, requestKeyframe } = makeReceiver();
    receiver.push(frame(false, 1000, P));
    expect(FakeDecoder.instances).toHaveLength(0);
    expect(requestKeyframe).toHaveBeenCalledTimes(1);
  });

  it("configures from the keyframe's SPS and decodes in order", () => {
    const { receiver } = makeReceiver();
    receiver.push(frame(true, 0, [...SPS, ...IDR]));
    receiver.push(frame(false, 16_666, P));
    const [decoder] = FakeDecoder.instances;
    expect(decoder.config?.codec).toBe("avc1.4D4028");
    expect(decoder.decoded.map((c) => [c.type, c.timestamp])).toEqual([
      ["key", 0],
      ["delta", 16_666],
    ]);
    expect(decoder.decoded[0].data).toEqual(new Uint8Array([...SPS, ...IDR]));
  });

  it("paints decoded frames at their size and releases them", () => {
    const { receiver, canvas, drawImage } = makeReceiver();
    receiver.push(frame(true, 0, [...SPS, ...IDR]));
    const close = vi.fn();
    const videoFrame = { displayWidth: 1280, displayHeight: 720, close };
    FakeDecoder.instances[0].init.output(videoFrame);
    expect([canvas.width, canvas.height]).toEqual([1280, 720]);
    expect(drawImage).toHaveBeenCalledWith(videoFrame, 0, 0, 1280, 720);
    expect(close).toHaveBeenCalled();
  });

  it("recovers from a decoder error by waiting for the next keyframe", () => {
    const { receiver, requestKeyframe, advance } = makeReceiver();
    receiver.push(frame(true, 0, [...SPS, ...IDR]));
    FakeDecoder.instances[0].init.error(new Error("boom"));
    expect(requestKeyframe).toHaveBeenCalledTimes(1);

    advance(1000);
    receiver.push(frame(false, 1, P)); // still broken: skipped
    expect(FakeDecoder.instances[0].decoded).toHaveLength(1);

    receiver.push(frame(true, 2, [...SPS, ...IDR]));
    expect(FakeDecoder.instances).toHaveLength(2);
    expect(FakeDecoder.instances[1].decoded.map((c) => c.type)).toEqual(["key"]);
  });

  it("drops to the next keyframe when the decoder falls behind", () => {
    const { receiver, requestKeyframe } = makeReceiver();
    receiver.push(frame(true, 0, [...SPS, ...IDR]));
    FakeDecoder.instances[0].decodeQueueSize = 10;
    receiver.push(frame(false, 1, P));
    receiver.push(frame(false, 2, P));
    expect(FakeDecoder.instances[0].decoded).toHaveLength(1);
    expect(requestKeyframe).toHaveBeenCalledTimes(1); // throttled, not per frame
  });

  it("reconfigures when the stream's SPS changes (new size or profile)", () => {
    const { receiver } = makeReceiver();
    receiver.push(frame(true, 0, [...SPS, ...IDR]));
    receiver.push(frame(true, 1, [0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, ...IDR]));
    expect(FakeDecoder.instances).toHaveLength(2);
    expect(FakeDecoder.instances[0].state).toBe("closed");
    expect(FakeDecoder.instances[1].config?.codec).toBe("avc1.42C01F");
  });

  it("stops decoding once closed", () => {
    const { receiver } = makeReceiver();
    receiver.push(frame(true, 0, [...SPS, ...IDR]));
    receiver.close();
    receiver.push(frame(true, 1, [...SPS, ...IDR]));
    expect(FakeDecoder.instances).toHaveLength(1);
    expect(FakeDecoder.instances[0].state).toBe("closed");
  });
});

describe("canDecodeH264", () => {
  it("is false without WebCodecs", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("VideoDecoder", undefined);
    expect(await canDecodeH264()).toBe(false);
  });

  it("follows isConfigSupported", async () => {
    const isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
    vi.stubGlobal("VideoDecoder", Object.assign(FakeDecoder, { isConfigSupported }));
    expect(await canDecodeH264()).toBe(true);
    expect(isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({ codec: "avc1.4D4028" }));
  });
});
