import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineBanner } from "@/components/blok/offline-banner";

// navigator.onLine is read-only — override it with a configurable descriptor.
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

beforeEach(() => {
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

// ── online ────────────────────────────────────────────────────────────────────

describe("online", () => {
  it("renders nothing when navigator.onLine is true", () => {
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });
});

// ── offline at mount ──────────────────────────────────────────────────────────

describe("offline at mount", () => {
  it("shows the offline banner when navigator.onLine is false", () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(screen.getByText(/no internet connection/i)).toBeTruthy();
  });
});

// ── dynamic events ────────────────────────────────────────────────────────────

describe("dynamic events", () => {
  it("shows banner when window fires 'offline' event", () => {
    render(<OfflineBanner />);
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByText(/no internet connection/i)).toBeTruthy();
  });

  it("hides banner when window fires 'online' event after going offline", () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(screen.getByText(/no internet connection/i)).toBeTruthy();
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByText(/no internet connection/i)).toBeNull();
  });

  it("removes event listeners on unmount (no error)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<OfflineBanner />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});
