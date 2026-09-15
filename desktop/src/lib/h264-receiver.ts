/**
 * Viewer side of the H.264 screen share: decodes the sharer's stream with
 * WebCodecs and paints it onto the share's canvas (the same canvas the JPEG
 * path draws on, so the overlay and its MediaStream don't care which arrived).
 *
 * Frames come off the ordered "vcodec" channel as
 * [u8 flags (bit0 = keyframe)][u64-LE timestamp µs][Annex B access unit].
 * Inter frames are useless without everything since the last keyframe, so
 * after any gap — the first frame, a decoder error, a backlog — deltas are
 * skipped and the sharer is asked for a keyframe.
 */

const FLAG_KEY = 1;
const HEADER = 9;
/** Frames waiting in the decoder past which we'd rather skip to a keyframe. */
const MAX_DECODE_QUEUE = 4;
/** Minimum spacing of keyframe requests, so a struggling decoder can't flood them. */
const KEYFRAME_REQUEST_INTERVAL_MS = 500;

/** Probe codec: Main profile, level 4.0 — covers 1080p60 at share bitrates. */
export const H264_PROBE_CODEC = "avc1.4D4028";

/** Whether this webview can decode H.264 through WebCodecs (cached). */
let decodeSupport: Promise<boolean> | null = null;
export function canDecodeH264(): Promise<boolean> {
  decodeSupport ??= (async () => {
    try {
      if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") return false;
      const { supported } = await VideoDecoder.isConfigSupported({
        codec: H264_PROBE_CODEC,
        optimizeForLatency: true,
      });
      return supported === true;
    } catch {
      return false;
    }
  })();
  return decodeSupport;
}

/** Test hook: forget the cached probe result. */
export function resetDecodeSupportCache(): void {
  decodeSupport = null;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();

/**
 * RFC 6381 codec string (`avc1.PPCCLL`) from the SPS in an Annex B access unit,
 * or null when the unit carries no SPS.
 */
export function codecFromAnnexB(data: Uint8Array): string | null {
  for (let i = 0; i + 6 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
      return `avc1.${hex2(data[i + 4])}${hex2(data[i + 5])}${hex2(data[i + 6])}`;
    }
  }
  return null;
}

export class H264Receiver {
  private decoder: VideoDecoder | null = null;
  private codec: string | null = null;
  private waitingForKey = true;
  private lastKeyRequest = -Infinity;
  private closed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly requestKeyframe: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Feeds one frame payload as received from the transport. */
  push(payload: Uint8Array): void {
    if (this.closed || payload.length <= HEADER) return;
    const key = (payload[0] & FLAG_KEY) !== 0;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const timestamp = Number(view.getBigUint64(1, true));
    const data = payload.subarray(HEADER);

    if (key) {
      const codec = codecFromAnnexB(data);
      if (codec && (codec !== this.codec || !this.decoder || this.decoder.state === "closed")) {
        this.configure(codec);
      }
      if (!this.decoder) return;
      this.waitingForKey = false;
    } else if (this.waitingForKey || !this.decoder) {
      this.askForKeyframe();
      return;
    } else if (this.decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
      // The decoder can't keep up: drop to the next keyframe instead of
      // drawing ever-older frames.
      this.waitingForKey = true;
      this.askForKeyframe();
      return;
    }

    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp, data }));
    } catch (e) {
      console.warn("[h264] decode rejected a frame", e);
      this.fail();
    }
  }

  close(): void {
    this.closed = true;
    this.teardownDecoder();
  }

  private configure(codec: string): void {
    this.teardownDecoder();
    this.codec = codec;
    try {
      const decoder = new VideoDecoder({
        output: (frame) => this.paint(frame),
        error: (e) => {
          console.warn("[h264] decoder error", e);
          this.fail();
        },
      });
      decoder.configure({ codec, optimizeForLatency: true });
      this.decoder = decoder;
    } catch (e) {
      console.warn(`[h264] cannot decode ${codec}`, e);
      this.decoder = null;
    }
  }

  private paint(frame: VideoFrame): void {
    try {
      if (this.closed) return;
      const { displayWidth: w, displayHeight: h } = frame;
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      this.ctx.drawImage(frame, 0, 0, w, h);
    } finally {
      frame.close();
    }
  }

  private fail(): void {
    this.teardownDecoder();
    this.waitingForKey = true;
    this.askForKeyframe();
  }

  private teardownDecoder(): void {
    const d = this.decoder;
    this.decoder = null;
    if (d && d.state !== "closed") {
      try {
        d.close();
      } catch {
        /* already closing */
      }
    }
  }

  private askForKeyframe(): void {
    const t = this.now();
    if (t - this.lastKeyRequest < KEYFRAME_REQUEST_INTERVAL_MS) return;
    this.lastKeyRequest = t;
    this.requestKeyframe();
  }
}
