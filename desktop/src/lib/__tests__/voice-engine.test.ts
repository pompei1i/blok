import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NativeVoiceEngine,
  getActiveNativeVoiceEngine,
  setActiveNativeVoiceEngine,
} from "../native-voice-engine";
import type { VoiceCallbacks } from "../voice-types";
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

  // ── transport connection state ──────────────────────────────────────────────

  /** The rtc event channel handed to rtc_start during join(). */
  function rtcEvents(): (buf: ArrayBuffer) => void {
    const call = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "rtc_start");
    const channel = (call?.[1] as { onEvent: { onmessage: (buf: ArrayBuffer) => void } }).onEvent;
    return (buf) => channel.onmessage(buf);
  }

  function connState(peerId: string, state: number): ArrayBuffer {
    const id = new TextEncoder().encode(peerId);
    const frame = new Uint8Array(4 + id.length);
    frame.set([0x02, state, id.length & 0xff, id.length >> 8]);
    frame.set(id, 4);
    return frame.buffer;
  }

  it("lists a peer once its transport connects, even without a presence entry", async () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    await engine.join();
    (engine as any)._ensureRtcPeer("peer1");

    rtcEvents()(connState("peer1", 1));

    expect(engine.isPeerConnected("peer1")).toBe(true);
    expect(cb.onParticipantJoin).toHaveBeenCalledWith("peer1", false);
  });

  it("ignores a connected event for a peer it never set up", async () => {
    const cb = makeCallbacks();
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    await engine.join();

    rtcEvents()(connState("stranger", 1));

    expect(engine.isPeerConnected("stranger")).toBe(false);
    expect(cb.onParticipantJoin).not.toHaveBeenCalled();
  });

  it("reports a lost connection once, on failed or closed", async () => {
    const cb = { ...makeCallbacks(), onPeerConnectionLost: vi.fn() };
    const engine = new NativeVoiceEngine("ch1", "u1", cb);
    await engine.join();
    (engine as any)._ensureRtcPeer("peer1");
    const emit = rtcEvents();

    emit(connState("peer1", 1));
    emit(connState("peer1", 2)); // disconnected: transient, still counts
    expect(engine.isPeerConnected("peer1")).toBe(true);

    emit(connState("peer1", 3));
    emit(connState("peer1", 4));
    expect(engine.isPeerConnected("peer1")).toBe(false);
    expect(cb.onPeerConnectionLost).toHaveBeenCalledTimes(1);
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
