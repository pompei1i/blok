import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { playSound, stopSound, playNotificationBeep, _clearSoundCacheForTesting } from "../sounds";

// Use real HTMLAudioElement from jsdom and spy on its prototype methods.
// This avoids vi.stubGlobal("Audio", ...) which does not reliably intercept
// new Audio() calls in the jsdom environment used by vitest.

beforeEach(() => {
  _clearSoundCacheForTesting();
  // Prevent jsdom from throwing on play() — it has no media support.
  vi.spyOn(HTMLAudioElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

// ── playSound ──────────────────────────────────────────────────────────────────

describe("playSound", () => {
  it("returns an HTMLAudioElement with the correct source URL", () => {
    const el = playSound("join");
    expect(el).toBeInstanceOf(HTMLAudioElement);
    expect((el as HTMLAudioElement).src).toContain("/sounds/join.mp3");
  });

  it("sets volume to 0.4 on the returned element", () => {
    const el = playSound("join") as HTMLAudioElement;
    expect(el.volume).toBe(0.4);
  });

  it("calls play() once per invocation", () => {
    playSound("join");
    expect(HTMLAudioElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("reuses the same HTMLAudioElement on repeated calls for the same name", () => {
    const el1 = playSound("join");
    const el2 = playSound("join");
    expect(el1).toBe(el2);
    expect(HTMLAudioElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("stops previous playback before each play — pause called for every call", () => {
    const pauseSpy = vi.spyOn(HTMLAudioElement.prototype, "pause");
    playSound("join");
    playSound("join");
    expect(pauseSpy).toHaveBeenCalledTimes(2);
  });

  it("sets loop=true when the loop argument is true", () => {
    const el = playSound("ringtone", true) as HTMLAudioElement;
    expect(el.loop).toBe(true);
  });

  it("loop defaults to false when the argument is omitted", () => {
    const el = playSound("join") as HTMLAudioElement;
    expect(el.loop).toBe(false);
  });

  it("returns null when a sound operation throws", () => {
    // Make pause() throw synchronously to exercise the catch block.
    vi.spyOn(HTMLAudioElement.prototype, "pause").mockImplementation(() => {
      throw new Error("audio hardware error");
    });
    expect(playSound("join")).toBeNull();
  });
});

// ── stopSound ──────────────────────────────────────────────────────────────────

describe("stopSound", () => {
  it("pauses the element and resets currentTime to 0", () => {
    playSound("join"); // populate the cache
    // Spy on pause AFTER the first play so we start at call count 0.
    const pauseSpy = vi.spyOn(HTMLAudioElement.prototype, "pause");
    stopSound("join");
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("is a no-op and does not throw when the sound has never been played", () => {
    expect(() => stopSound("leave")).not.toThrow();
  });
});

// ── playNotificationBeep ───────────────────────────────────────────────────────

describe("playNotificationBeep", () => {
  it("creates an AudioContext oscillator and calls start/stop", () => {
    const startSpy = vi.fn();
    const stopSpy = vi.fn();
    const mockOsc = {
      connect: vi.fn(),
      type: "sine" as OscillatorType,
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      start: startSpy,
      stop: stopSpy,
    };
    const mockGain = {
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
    const mockCtx = {
      createOscillator: () => mockOsc,
      createGain: () => mockGain,
      destination: {},
      currentTime: 0,
      close: vi.fn(),
    };

    const orig = (window as any).AudioContext;
    (window as any).AudioContext = function () { return mockCtx; };
    try {
      playNotificationBeep();
      expect(startSpy).toHaveBeenCalled();
      expect(stopSpy).toHaveBeenCalled();
      expect(mockOsc.connect).toHaveBeenCalledWith(mockGain);
    } finally {
      (window as any).AudioContext = orig;
    }
  });

  it("is a no-op and does not throw when AudioContext is unavailable", () => {
    const origCtx = (window as any).AudioContext;
    const origWebkit = (window as any).webkitAudioContext;
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;
    try {
      expect(() => playNotificationBeep()).not.toThrow();
    } finally {
      (window as any).AudioContext = origCtx;
      (window as any).webkitAudioContext = origWebkit;
    }
  });
});
