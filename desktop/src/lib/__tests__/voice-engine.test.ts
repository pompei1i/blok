import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NativeVoiceEngine,
  getActiveNativeVoiceEngine,
  setActiveNativeVoiceEngine,
} from "../native-voice-engine";
import type { VoiceCallbacks } from "../voice-engine";

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
