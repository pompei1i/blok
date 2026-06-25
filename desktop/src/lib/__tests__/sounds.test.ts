import { describe, it, expect, vi, afterEach } from "vitest";
import {
  playJoinSound,
  playLeaveSound,
  playWatchSound,
  playNotificationBeep,
  playMuteSound,
  playUnmuteSound,
  playRingtone,
  stopRingtone,
} from "../sounds";

// All sounds are synthesized via the Web Audio API. jsdom has no real
// AudioContext, so we install a mock and assert the oscillator wiring.

function installMockAudioContext() {
  const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const makeOsc = () => {
    const osc = {
      connect: vi.fn(),
      type: "sine" as OscillatorType,
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
    };
    oscillators.push(osc);
    return osc;
  };
  const mockCtx = {
    createOscillator: makeOsc,
    createGain: () => ({
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    }),
    destination: {},
    currentTime: 0,
    close: vi.fn(),
  };
  const orig = (window as any).AudioContext;
  (window as any).AudioContext = function () { return mockCtx; };
  return { oscillators, restore: () => { (window as any).AudioContext = orig; } };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  stopRingtone();
});

describe("voice presence cues", () => {
  it.each([
    ["playJoinSound", playJoinSound],
    ["playLeaveSound", playLeaveSound],
    ["playWatchSound", playWatchSound],
    ["playMuteSound", playMuteSound],
    ["playUnmuteSound", playUnmuteSound],
  ])("%s starts and stops an oscillator", (_name, fn) => {
    const { oscillators, restore } = installMockAudioContext();
    try {
      fn();
      expect(oscillators.length).toBeGreaterThan(0);
      expect(oscillators[0].start).toHaveBeenCalled();
      expect(oscillators[0].stop).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("does not throw when AudioContext is unavailable", () => {
    const origCtx = (window as any).AudioContext;
    const origWebkit = (window as any).webkitAudioContext;
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;
    try {
      expect(() => { playJoinSound(); playLeaveSound(); playWatchSound(); }).not.toThrow();
    } finally {
      (window as any).AudioContext = origCtx;
      (window as any).webkitAudioContext = origWebkit;
    }
  });
});

describe("playNotificationBeep", () => {
  it("creates an oscillator and calls start/stop", () => {
    const { oscillators, restore } = installMockAudioContext();
    try {
      playNotificationBeep();
      expect(oscillators[0].start).toHaveBeenCalled();
      expect(oscillators[0].stop).toHaveBeenCalled();
    } finally {
      restore();
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

describe("ringtone loop", () => {
  it("fires an initial burst immediately and repeats on an interval", () => {
    vi.useFakeTimers();
    const { oscillators, restore } = installMockAudioContext();
    try {
      playRingtone();
      const afterFirst = oscillators.length;
      expect(afterFirst).toBeGreaterThan(0);
      vi.advanceTimersByTime(2200);
      expect(oscillators.length).toBeGreaterThan(afterFirst);
    } finally {
      restore();
    }
  });

  it("stopRingtone halts further bursts", () => {
    vi.useFakeTimers();
    const { oscillators, restore } = installMockAudioContext();
    try {
      playRingtone();
      const afterFirst = oscillators.length;
      stopRingtone();
      vi.advanceTimersByTime(5000);
      expect(oscillators.length).toBe(afterFirst);
    } finally {
      restore();
    }
  });
});
