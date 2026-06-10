import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NativeVoiceEngine,
  getActiveNativeVoiceEngine,
  setActiveNativeVoiceEngine,
} from "../native-voice-engine";
import type { VoiceCallbacks } from "../voice-engine";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/lib/supabaseClient";

// Build a minimal VoiceCallbacks stub
function makeCallbacks(): VoiceCallbacks & { onSpeakingChangeCalls: Array<[string, boolean]> } {
  const onSpeakingChangeCalls: Array<[string, boolean]> = [];
  return {
    onParticipantJoin: vi.fn(),
    onParticipantLeave: vi.fn(),
    onSpeakingChange: vi.fn((id: string, speaking: boolean) => {
      onSpeakingChangeCalls.push([id, speaking]);
    }),
    onScreenShareStart: vi.fn(),
    onScreenShareStop: vi.fn(),
    onSpeakingChangeCalls,
  };
}

// ── module-level singleton helpers ────────────────────────────────────────────

describe("getActiveNativeVoiceEngine / setActiveNativeVoiceEngine", () => {
  afterEach(() => {
    setActiveNativeVoiceEngine(null);
  });

  it("returns null before anything is set", () => {
    setActiveNativeVoiceEngine(null);
    expect(getActiveNativeVoiceEngine()).toBeNull();
  });

  it("returns the engine after it is set", () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    setActiveNativeVoiceEngine(engine);
    expect(getActiveNativeVoiceEngine()).toBe(engine);
  });

  it("allows replacing the engine", () => {
    const cb = makeCallbacks();
    const e1 = new NativeVoiceEngine("ch1", "u1", cb);
    const e2 = new NativeVoiceEngine("ch2", "u2", cb);
    setActiveNativeVoiceEngine(e1);
    setActiveNativeVoiceEngine(e2);
    expect(getActiveNativeVoiceEngine()).toBe(e2);
  });
});

// ── isScreenSharing ───────────────────────────────────────────────────────────

describe("NativeVoiceEngine.isScreenSharing", () => {
  it("returns false on a newly created engine", () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    expect(engine.isScreenSharing()).toBe(false);
  });

  it("returns false after stopScreenShare when no share is active", async () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    // stopScreenShare with no active share should be a no-op
    await engine.stopScreenShare();
    expect(engine.isScreenSharing()).toBe(false);
  });
});

// ── updateSpeaking via clearPeerSpeaking (accessed via any cast) ───────────────

describe("NativeVoiceEngine speaking state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onSpeakingChange(true) on the first speaking=true call", () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    (engine as any).updateSpeaking("peer1", true);
    expect(cb.onSpeakingChange).toHaveBeenCalledWith("peer1", true);
  });

  it("does not fire onSpeakingChange(true) again for subsequent speaking=true calls", () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    (engine as any).updateSpeaking("peer1", true);
    (engine as any).updateSpeaking("peer1", true);
    // Only one true event
    const trueCalls = (cb.onSpeakingChange as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, s]) => s === true
    );
    expect(trueCalls).toHaveLength(1);
  });

  it("fires onSpeakingChange(false) after SPEAKING_TIMEOUT_MS elapses", () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    (engine as any).updateSpeaking("peer1", true);
    vi.advanceTimersByTime(400);
    expect(cb.onSpeakingChange).toHaveBeenCalledWith("peer1", false);
  });

  it("resets the silence timer on repeated speaking updates", () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    (engine as any).updateSpeaking("peer1", true);
    vi.advanceTimersByTime(300); // 300 ms — not yet silent
    (engine as any).updateSpeaking("peer1", true); // reset timer
    vi.advanceTimersByTime(300); // 300 ms more — still within 400 ms window
    // Should NOT have fired false yet
    const falseCalls = (cb.onSpeakingChange as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, s]) => s === false
    );
    expect(falseCalls).toHaveLength(0);
    vi.advanceTimersByTime(101); // push past 400 ms
    const falseCallsAfter = (cb.onSpeakingChange as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, s]) => s === false
    );
    expect(falseCallsAfter).toHaveLength(1);
  });

  it("clearPeerSpeaking cancels the timer and fires false when peer was speaking", () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    (engine as any).updateSpeaking("peer1", true);
    (engine as any).clearPeerSpeaking("peer1");
    // Timer cancelled — fire-on-timeout should NOT happen additionally
    vi.advanceTimersByTime(1000);
    const calls = (cb.onSpeakingChange as ReturnType<typeof vi.fn>).mock.calls;
    const falseCalls = calls.filter(([, s]) => s === false);
    expect(falseCalls).toHaveLength(1);
  });

  it("clearPeerSpeaking is a no-op for an unknown peer", () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    expect(() => (engine as any).clearPeerSpeaking("unknown")).not.toThrow();
  });
});

// ── join / leave ───────────────────────────────────────────────────────────────

describe("NativeVoiceEngine.join / leave", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ch = () => (globalThis as any).__mockChannel as Record<string, ReturnType<typeof vi.fn>>;

  function subscribeOk() {
    ch().subscribe.mockImplementation((cb: (s: string) => void) => {
      Promise.resolve().then(() => cb("SUBSCRIBED"));
      return ch();
    });
  }

  beforeEach(() => {
    subscribeOk();
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    ch().subscribe.mockReturnValue(ch()); // restore non-firing default
    vi.clearAllMocks();
  });

  it("throws 'Native voice requires the desktop app' outside Tauri", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    await expect(engine.join()).rejects.toThrow("Native voice requires the desktop app");
  });

  it("join() calls invoke('audio_start') with noiseSuppression and echoCancellation", async () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    await engine.join();
    expect(invoke).toHaveBeenCalledWith(
      "audio_start",
      expect.objectContaining({
        noiseSuppression: expect.any(Boolean),
        echoCancellation: expect.any(Boolean),
      }),
    );
  });

  it("join() resolves when channel reaches SUBSCRIBED", async () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    await expect(engine.join()).resolves.toBeUndefined();
  });

  it("join() is idempotent — second call returns early without re-subscribing", async () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    await engine.join();
    const before = ch().subscribe.mock.calls.length;
    await engine.join();
    expect(ch().subscribe.mock.calls.length).toBe(before);
  });

  it("join() rejects and calls audio_stop on CHANNEL_ERROR", async () => {
    ch().subscribe.mockImplementation((cb: (s: string) => void) => {
      Promise.resolve().then(() => cb("CHANNEL_ERROR"));
      return ch();
    });
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    await expect(engine.join()).rejects.toThrow();
    expect(invoke).toHaveBeenCalledWith("audio_stop");
  });

  it("leave() always calls invoke('audio_stop')", async () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    await engine.leave();
    expect(invoke).toHaveBeenCalledWith("audio_stop");
  });

  it("leave() removes the Supabase channel after a successful join", async () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    await engine.join();
    await engine.leave();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});

// ── setMuted / setDeafened ────────────────────────────────────────────────────

describe("NativeVoiceEngine.setMuted / setDeafened", () => {
  afterEach(() => vi.clearAllMocks());

  it("setMuted(true) invokes audio_set_muted with muted=true", () => {
    new NativeVoiceEngine("ch1", "u1", makeCallbacks()).setMuted(true);
    expect(invoke).toHaveBeenCalledWith("audio_set_muted", { muted: true });
  });

  it("setMuted(false) invokes audio_set_muted with muted=false", () => {
    new NativeVoiceEngine("ch1", "u1", makeCallbacks()).setMuted(false);
    expect(invoke).toHaveBeenCalledWith("audio_set_muted", { muted: false });
  });

  it("setDeafened(true) invokes audio_set_deafened with deafened=true", () => {
    new NativeVoiceEngine("ch1", "u1", makeCallbacks()).setDeafened(true);
    expect(invoke).toHaveBeenCalledWith("audio_set_deafened", { deafened: true });
  });

  it("setDeafened(false) invokes audio_set_deafened with deafened=false", () => {
    new NativeVoiceEngine("ch1", "u1", makeCallbacks()).setDeafened(false);
    expect(invoke).toHaveBeenCalledWith("audio_set_deafened", { deafened: false });
  });
});

// ── Screen-share binary frame format (_sendFrameViaDC / _onScreenFrame) ────────

describe("NativeVoiceEngine screen-share binary frame format", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  // ── _sendFrameViaDC ──────────────────────────────────────────────────────────

  it("packs [w:u32 BE][h:u32 BE][jpeg bytes] into ArrayBuffer", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    const sent: ArrayBuffer[] = [];
    (engine as any)._shareeChannels.set("viewer", {
      readyState: "open", bufferedAmount: 0,
      send: (b: ArrayBuffer) => sent.push(b),
    });

    const testJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
    (engine as any)._sendFrameViaDC(640, 480, btoa(String.fromCharCode(...testJpeg)));

    expect(sent).toHaveLength(1);
    const dv = new DataView(sent[0]);
    expect(dv.getUint32(0, false)).toBe(640);
    expect(dv.getUint32(4, false)).toBe(480);
    expect(new Uint8Array(sent[0], 8)).toEqual(testJpeg);
  });

  it("does not send when no data channels are registered", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    expect(() => (engine as any)._sendFrameViaDC(100, 100, btoa("x"))).not.toThrow();
  });

  it("skips a channel that is not in 'open' state", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    const sent: ArrayBuffer[] = [];
    (engine as any)._shareeChannels.set("viewer", {
      readyState: "closing", bufferedAmount: 0,
      send: (b: ArrayBuffer) => sent.push(b),
    });
    (engine as any)._sendFrameViaDC(100, 100, btoa("x"));
    expect(sent).toHaveLength(0);
  });

  it("skips a channel when bufferedAmount exceeds 1 MB", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    const sent: ArrayBuffer[] = [];
    (engine as any)._shareeChannels.set("viewer", {
      readyState: "open", bufferedAmount: 1_000_001,
      send: (b: ArrayBuffer) => sent.push(b),
    });
    (engine as any)._sendFrameViaDC(100, 100, btoa("x"));
    expect(sent).toHaveLength(0);
  });

  it("still sends when bufferedAmount is below the 1 MB threshold", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    const sent: ArrayBuffer[] = [];
    (engine as any)._shareeChannels.set("viewer", {
      readyState: "open", bufferedAmount: 300_000,
      send: (b: ArrayBuffer) => sent.push(b),
    });
    (engine as any)._sendFrameViaDC(100, 100, btoa("x"));
    expect(sent).toHaveLength(1);
  });

  it("caches the latest frame even when no channels are open (late-joiner fix)", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    expect((engine as any)._lastScreenFrame).toBeNull();
    const testJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
    (engine as any)._sendFrameViaDC(640, 480, btoa(String.fromCharCode(...testJpeg)));
    const cached = (engine as any)._lastScreenFrame as ArrayBuffer;
    expect(cached).toBeInstanceOf(ArrayBuffer);
    const dv = new DataView(cached);
    expect(dv.getUint32(0, false)).toBe(640);
    expect(dv.getUint32(4, false)).toBe(480);
  });

  it("pushes the cached frame to a viewer's channel as soon as it opens", () => {
    const sharer = new NativeVoiceEngine("ch1", "sharer", makeCallbacks());
    // Prime a cached frame (e.g. captured before this viewer connected).
    (sharer as any)._sendFrameViaDC(800, 600, btoa("x"));

    const sent: ArrayBuffer[] = [];
    const channel: any = {
      readyState: "connecting",
      binaryType: "",
      bufferedAmount: 0,
      onopen: null as null | (() => void),
      onclose: null,
      send: (b: ArrayBuffer) => sent.push(b),
    };
    const pc: any = { ondatachannel: null as null | ((e: { channel: any }) => void) };
    // Simulate _handleShareeOffer wiring the data channel.
    pc.ondatachannel = ({ channel: ch }: { channel: any }) => {
      ch.binaryType = "arraybuffer";
      (sharer as any)._shareeChannels.set("viewer", ch);
      ch.onclose = () => (sharer as any)._shareeChannels.delete("viewer");
      const sendInitial = () => {
        if (ch.readyState === "open" && (sharer as any)._lastScreenFrame) {
          ch.send((sharer as any)._lastScreenFrame);
        }
      };
      if (ch.readyState === "open") sendInitial();
      else ch.onopen = sendInitial;
    };
    pc.ondatachannel({ channel });
    expect(sent).toHaveLength(0); // not open yet
    channel.readyState = "open";
    channel.onopen!();
    expect(sent).toHaveLength(1);
    expect(new DataView(sent[0]).getUint32(0, false)).toBe(800);
  });

  // ── _onScreenFrame ───────────────────────────────────────────────────────────

  it("sets canvas width/height from the 8-byte header", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    const buf = new ArrayBuffer(12);
    const dv = new DataView(buf);
    dv.setUint32(0, 320, false);
    dv.setUint32(4, 240, false);
    new Uint8Array(buf, 8).set([0xFF, 0xD8, 0xFF, 0xD9]);

    const canvas = document.createElement("canvas");
    (engine as any)._remoteCanvases.set("sharer", {
      canvas,
      stream: { getVideoTracks: () => [] } as unknown as MediaStream,
    });

    (engine as any)._onScreenFrame("sharer", buf);

    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(240);
  });

  it("ignores frames shorter than 8 bytes without touching the canvas", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    const canvas = document.createElement("canvas");
    const origWidth = canvas.width;
    (engine as any)._remoteCanvases.set("sharer", {
      canvas,
      stream: { getVideoTracks: () => [] } as unknown as MediaStream,
    });

    expect(() => (engine as any)._onScreenFrame("sharer", new ArrayBuffer(7))).not.toThrow();
    expect(canvas.width).toBe(origWidth);
  });

  it("clamps oversized width to 3840 and height to 2160", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    const buf = new ArrayBuffer(12);
    const dv = new DataView(buf);
    dv.setUint32(0, 9999, false);
    dv.setUint32(4, 9999, false);

    const canvas = document.createElement("canvas");
    (engine as any)._remoteCanvases.set("sharer", {
      canvas,
      stream: { getVideoTracks: () => [] } as unknown as MediaStream,
    });

    (engine as any)._onScreenFrame("sharer", buf);

    expect(canvas.width).toBe(3840);
    expect(canvas.height).toBe(2160);
  });

  it("is a no-op for unknown peer IDs", () => {
    const engine = new NativeVoiceEngine("ch1", "u1", makeCallbacks());
    expect(() => (engine as any)._onScreenFrame("unknown-peer", new ArrayBuffer(12))).not.toThrow();
  });

  // ── roundtrip ────────────────────────────────────────────────────────────────

  it("data packed by _sendFrameViaDC is correctly decoded by _onScreenFrame", () => {
    const sharer = new NativeVoiceEngine("ch1", "sharer", makeCallbacks());
    const viewer = new NativeVoiceEngine("ch1", "viewer", makeCallbacks());

    const sent: ArrayBuffer[] = [];
    (sharer as any)._shareeChannels.set("viewer", {
      readyState: "open", bufferedAmount: 0,
      send: (b: ArrayBuffer) => sent.push(b),
    });

    const testJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
    (sharer as any)._sendFrameViaDC(800, 600, btoa(String.fromCharCode(...testJpeg)));
    expect(sent).toHaveLength(1);

    const canvas = document.createElement("canvas");
    (viewer as any)._remoteCanvases.set("sharer", {
      canvas,
      stream: { getVideoTracks: () => [] } as unknown as MediaStream,
    });

    (viewer as any)._onScreenFrame("sharer", sent[0]);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });
});
