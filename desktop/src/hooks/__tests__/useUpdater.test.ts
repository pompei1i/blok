import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUpdater } from "@/hooks/useUpdater";

// vi.mock factories are hoisted before const declarations — use vi.hoisted to
// define the fns at hoist-time so the factory can reference them safely.
const { mockCheck, mockRelaunch } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockRelaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mockCheck }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mockRelaunch }));

// Set UPDATER_CHECK_DELAY_MS to 0 so the first attempt fires instantly in fake-timer tests.
// Retry delays stay as-is: [0, 30_000, 300_000].
vi.mock("@/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants")>();
  return { ...actual, UPDATER_CHECK_DELAY_MS: 0 };
});

const setTauri = () =>
  ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {});
const clearTauri = () =>
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

beforeEach(() => {
  vi.useFakeTimers();
  mockCheck.mockReset();
  mockRelaunch.mockReset();
  clearTauri();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── no Tauri env ──────────────────────────────────────────────────────────────

describe("no Tauri environment", () => {
  it("skips check when __TAURI_INTERNALS__ is absent", async () => {
    const { result } = renderHook(() => useUpdater());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mockCheck).not.toHaveBeenCalled();
    expect(result.current.available).toBe(false);
  });
});

// ── update available ──────────────────────────────────────────────────────────

describe("update available", () => {
  it("sets available, version and body from check result", async () => {
    setTauri();
    mockCheck.mockResolvedValue({ available: true, version: "0.4.0", body: "patch notes" });

    const { result } = renderHook(() => useUpdater());
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(result.current.available).toBe(true);
    expect(result.current.version).toBe("0.4.0");
    expect(result.current.body).toBe("patch notes");
  });

  it("maps undefined body to null", async () => {
    setTauri();
    mockCheck.mockResolvedValue({ available: true, version: "1.0.0", body: undefined });

    const { result } = renderHook(() => useUpdater());
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(result.current.body).toBeNull();
  });

  it("does not retry after finding an update", async () => {
    setTauri();
    mockCheck.mockResolvedValue({ available: true, version: "1.0.0", body: null });

    renderHook(() => useUpdater());
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(30_000));

    expect(mockCheck).toHaveBeenCalledTimes(1);
  });
});

// ── retries ───────────────────────────────────────────────────────────────────

describe("retries", () => {
  it("retries 3 times then stops when check returns null", async () => {
    setTauri();
    mockCheck.mockResolvedValue(null);

    renderHook(() => useUpdater());

    await act(() => vi.advanceTimersByTimeAsync(0));        // attempt 1
    expect(mockCheck).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(30_000));   // attempt 2
    expect(mockCheck).toHaveBeenCalledTimes(2);

    await act(() => vi.advanceTimersByTimeAsync(300_000));  // attempt 3
    expect(mockCheck).toHaveBeenCalledTimes(3);

    await act(() => vi.advanceTimersByTimeAsync(600_000));  // no 4th
    expect(mockCheck).toHaveBeenCalledTimes(3);
  });

  it("retries on error and stops after 3 attempts", async () => {
    setTauri();
    mockCheck.mockRejectedValue(new Error("network error"));

    renderHook(() => useUpdater());

    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    await act(() => vi.advanceTimersByTimeAsync(300_000));

    expect(mockCheck).toHaveBeenCalledTimes(3);

    await act(() => vi.advanceTimersByTimeAsync(600_000));
    expect(mockCheck).toHaveBeenCalledTimes(3);
  });
});

// ── dismiss ───────────────────────────────────────────────────────────────────

describe("dismiss", () => {
  it("sets available to false", async () => {
    setTauri();
    mockCheck.mockResolvedValue({ available: true, version: "1.0.0", body: null });

    const { result } = renderHook(() => useUpdater());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.available).toBe(true);

    act(() => { result.current.dismiss(); });
    expect(result.current.available).toBe(false);
  });
});

// ── installUpdate ─────────────────────────────────────────────────────────────

describe("installUpdate", () => {
  it("skips when __TAURI_INTERNALS__ is absent", async () => {
    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.installUpdate(); });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("calls downloadAndInstall then relaunch on success", async () => {
    setTauri();
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({ available: true, version: "1.0.0", body: null, downloadAndInstall });
    mockRelaunch.mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.installUpdate(); });

    expect(downloadAndInstall).toHaveBeenCalled();
    expect(mockRelaunch).toHaveBeenCalled();
    // installing stays true — in production relaunch() kills the process
    expect(result.current.installing).toBe(true);
  });

  it("sets error and clears installing when check throws", async () => {
    setTauri();
    mockCheck.mockRejectedValue(new Error("install failed"));

    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.installUpdate(); });

    expect(result.current.error).toBe("install failed");
    expect(result.current.installing).toBe(false);
  });

  it("uses fallback error string for non-Error throws", async () => {
    setTauri();
    mockCheck.mockRejectedValue("plain string error");

    const { result } = renderHook(() => useUpdater());
    await act(async () => { await result.current.installUpdate(); });

    expect(result.current.error).toBe("Update failed");
  });
});

// ── cleanup ───────────────────────────────────────────────────────────────────

describe("cleanup", () => {
  it("cancels pending timer on unmount — check is never called", async () => {
    setTauri();
    mockCheck.mockResolvedValue(null);

    const { unmount } = renderHook(() => useUpdater());
    unmount();

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mockCheck).not.toHaveBeenCalled();
  });
});
