import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdateBanner } from "@/components/blok/update-banner";

const { mockUseUpdater } = vi.hoisted(() => ({
  mockUseUpdater: vi.fn(),
}));

vi.mock("@/hooks/useUpdater", () => ({ useUpdater: mockUseUpdater }));

const mockInstallUpdate = vi.fn();

const base = {
  available: false,
  version: null,
  body: null,
  installing: false,
  error: null,
  installUpdate: mockInstallUpdate,
  dismiss: vi.fn(),
};

beforeEach(() => {
  mockInstallUpdate.mockReset();
  mockUseUpdater.mockReturnValue({ ...base });
});

// ── hidden ────────────────────────────────────────────────────────────────────

describe("hidden", () => {
  it("renders nothing when idle (not installing, no error)", () => {
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when an update is merely available — auto-install handles it", () => {
    mockUseUpdater.mockReturnValue({ ...base, available: true, version: "1.2.3" });
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });
});

// ── installing ────────────────────────────────────────────────────────────────

describe("installing", () => {
  it("shows installing status with version", () => {
    mockUseUpdater.mockReturnValue({ ...base, installing: true, version: "1.2.3" });
    const { container } = render(<UpdateBanner />);
    expect(container.textContent).toContain("1.2.3");
  });

  it("shows no retry button while installing", () => {
    mockUseUpdater.mockReturnValue({ ...base, installing: true, version: "1.2.3" });
    render(<UpdateBanner />);
    expect(screen.queryByText("install & relaunch")).toBeNull();
  });
});

// ── error state ───────────────────────────────────────────────────────────────

describe("error state", () => {
  it("shows error message", () => {
    mockUseUpdater.mockReturnValue({ ...base, error: "network timeout" });
    render(<UpdateBanner />);
    expect(screen.getByText(/network timeout/)).toBeTruthy();
  });

  it("retry button calls installUpdate", () => {
    mockUseUpdater.mockReturnValue({ ...base, error: "failed" });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByText("install & relaunch"));
    expect(mockInstallUpdate).toHaveBeenCalledTimes(1);
  });
});
