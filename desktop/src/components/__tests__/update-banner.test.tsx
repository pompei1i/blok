import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdateBanner } from "@/components/blok/update-banner";

const { mockUseUpdater } = vi.hoisted(() => ({
  mockUseUpdater: vi.fn(),
}));

vi.mock("@/hooks/useUpdater", () => ({ useUpdater: mockUseUpdater }));

const mockInstallUpdate = vi.fn();
const mockDismiss = vi.fn();

const base = {
  available: false,
  version: null,
  body: null,
  installing: false,
  error: null,
  installUpdate: mockInstallUpdate,
  dismiss: mockDismiss,
};

beforeEach(() => {
  mockInstallUpdate.mockReset();
  mockDismiss.mockReset();
  mockUseUpdater.mockReturnValue({ ...base });
});

// ── hidden ────────────────────────────────────────────────────────────────────

describe("hidden", () => {
  it("renders nothing when not available and no error", () => {
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });
});

// ── update available ──────────────────────────────────────────────────────────

describe("update available", () => {
  it("shows version text", () => {
    mockUseUpdater.mockReturnValue({ ...base, available: true, version: "1.2.3" });
    render(<UpdateBanner />);
    expect(screen.getByText(/update available — v1\.2\.3/)).toBeTruthy();
  });

  it("shows body notes when provided", () => {
    mockUseUpdater.mockReturnValue({ ...base, available: true, version: "1.0.0", body: "bug fixes" });
    render(<UpdateBanner />);
    expect(screen.getByText("bug fixes")).toBeTruthy();
  });

  it("install button calls installUpdate", () => {
    mockUseUpdater.mockReturnValue({ ...base, available: true, version: "1.0.0" });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByText("install & relaunch"));
    expect(mockInstallUpdate).toHaveBeenCalledTimes(1);
  });

  it("install button disabled and shows 'installing...' while installing", () => {
    mockUseUpdater.mockReturnValue({ ...base, available: true, version: "1.0.0", installing: true });
    render(<UpdateBanner />);
    const btn = screen.getByText("installing...") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("dismiss button calls dismiss", () => {
    mockUseUpdater.mockReturnValue({ ...base, available: true, version: "1.0.0" });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByText("×"));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});

// ── error state ───────────────────────────────────────────────────────────────

describe("error state", () => {
  it("shows error message", () => {
    mockUseUpdater.mockReturnValue({ ...base, error: "network timeout" });
    render(<UpdateBanner />);
    expect(screen.getByText(/network timeout/)).toBeTruthy();
  });

  it("hides install button when error is set", () => {
    mockUseUpdater.mockReturnValue({ ...base, error: "failed" });
    render(<UpdateBanner />);
    expect(screen.queryByText("install & relaunch")).toBeNull();
  });

  it("still shows dismiss button on error", () => {
    mockUseUpdater.mockReturnValue({ ...base, error: "failed" });
    render(<UpdateBanner />);
    expect(screen.getByText("×")).toBeTruthy();
  });
});
