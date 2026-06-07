import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";

// ── additional mocks not covered by setup.ts ──────────────────────────────────

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ requestNotificationPermission: vi.fn().mockResolvedValue(undefined) }));

// ── smoke ─────────────────────────────────────────────────────────────────────

describe("App smoke", () => {
  it("mounts without throwing", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("shows landing page after init when no session exists", async () => {
    render(<App />);
    // supabase.auth.getUser() mock returns null → not authenticated → LandingPage
    const signInBtn = await screen.findByText(/sign in \/ register/i);
    expect(signInBtn).toBeTruthy();
  });

  it("renders into a DOM node (basic DOM sanity)", () => {
    const { container } = render(<App />);
    expect(container.firstChild).not.toBeNull();
  });
});
