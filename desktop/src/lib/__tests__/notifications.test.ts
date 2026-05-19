import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestNotificationPermission, sendDesktopNotification } from "../notifications";

// Vitest/jsdom provides `Notification` in the global scope but may not expose
// `requestPermission` as a static — we override the global for test control.

let NotificationMock: any;

beforeEach(() => {
  NotificationMock = vi.fn();
  NotificationMock.permission = "default";
  NotificationMock.requestPermission = vi.fn();
  Object.defineProperty(globalThis, "Notification", {
    value: NotificationMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── requestNotificationPermission ─────────────────────────────────────────────

describe("requestNotificationPermission", () => {
  it("returns true immediately if permission is already granted", async () => {
    NotificationMock.permission = "granted";
    const result = await requestNotificationPermission();
    expect(result).toBe(true);
    expect(NotificationMock.requestPermission).not.toHaveBeenCalled();
  });

  it("returns false immediately if permission is denied", async () => {
    NotificationMock.permission = "denied";
    const result = await requestNotificationPermission();
    expect(result).toBe(false);
    expect(NotificationMock.requestPermission).not.toHaveBeenCalled();
  });

  it("calls requestPermission when permission is 'default' and returns true on grant", async () => {
    NotificationMock.permission = "default";
    NotificationMock.requestPermission.mockResolvedValue("granted");
    const result = await requestNotificationPermission();
    expect(NotificationMock.requestPermission).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it("returns false when the user dismisses the prompt", async () => {
    NotificationMock.permission = "default";
    NotificationMock.requestPermission.mockResolvedValue("denied");
    const result = await requestNotificationPermission();
    expect(result).toBe(false);
  });

  it("returns false when Notification API is absent", async () => {
    // Temporarily remove Notification from window
    const saved = (globalThis as any).Notification;
    delete (globalThis as any).Notification;
    const result = await requestNotificationPermission();
    expect(result).toBe(false);
    (globalThis as any).Notification = saved;
  });
});

// ── sendDesktopNotification ───────────────────────────────────────────────────

describe("sendDesktopNotification", () => {
  it("creates a Notification with the given title and body", () => {
    NotificationMock.permission = "granted";
    sendDesktopNotification("Test Title", "Test Body");
    expect(NotificationMock).toHaveBeenCalledWith("Test Title", { body: "Test Body", silent: true });
  });

  it("does not create a Notification when permission is not granted", () => {
    NotificationMock.permission = "default";
    sendDesktopNotification("Title", "Body");
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("does not throw when Notification API is absent", () => {
    const saved = (globalThis as any).Notification;
    delete (globalThis as any).Notification;
    expect(() => sendDesktopNotification("Title", "Body")).not.toThrow();
    (globalThis as any).Notification = saved;
  });

  it("silently swallows constructor errors", () => {
    NotificationMock.permission = "granted";
    NotificationMock.mockImplementation(() => { throw new Error("permission denied by OS"); });
    expect(() => sendDesktopNotification("Title", "Body")).not.toThrow();
  });
});
