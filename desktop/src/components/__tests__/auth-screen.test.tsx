import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthScreen } from "@/components/blok/auth-screen";

const { mockUseAuthStore } = vi.hoisted(() => ({
  mockUseAuthStore: vi.fn(),
}));

vi.mock("@/lib/store/auth-store", () => ({ useAuthStore: mockUseAuthStore }));

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockClearError = vi.fn();

const base = {
  login: mockLogin,
  register: mockRegister,
  isLoading: false,
  error: null,
  clearError: mockClearError,
};

beforeEach(() => {
  mockLogin.mockReset().mockResolvedValue({ success: true });
  mockRegister.mockReset().mockResolvedValue({ success: true });
  mockClearError.mockReset();
  mockUseAuthStore.mockReturnValue({ ...base });
});

// ── render ────────────────────────────────────────────────────────────────────

describe("render", () => {
  it("shows BLOK heading", () => {
    render(<AuthScreen />);
    expect(screen.getByText("BLOK")).toBeTruthy();
  });

  it("shows login form by default (email and password fields)", () => {
    render(<AuthScreen />);
    expect(screen.getByPlaceholderText("you@example.com")).toBeTruthy();
    expect(screen.getByPlaceholderText("••••••••")).toBeTruthy();
    // username field not present in login mode
    expect(screen.queryByPlaceholderText("your_username")).toBeNull();
  });
});

// ── mode switch ───────────────────────────────────────────────────────────────

describe("mode switch", () => {
  it("switches to register mode showing username and confirm-password fields", () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText("Register"));
    expect(screen.getByPlaceholderText("your_username")).toBeTruthy();
    // two password fields in register mode
    const pwFields = screen.getAllByPlaceholderText("••••••••");
    expect(pwFields).toHaveLength(2);
  });

  it("clears local error when switching modes", async () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText("Register"));
    // trigger mismatch error
    const [pwField, confirmField] = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(screen.getByPlaceholderText("your_username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "a@b.com" } });
    fireEvent.change(pwField, { target: { value: "abc123" } });
    fireEvent.change(confirmField, { target: { value: "different" } });
    fireEvent.submit(screen.getByRole("button", { name: /register/i }));
    await waitFor(() => expect(screen.getByText(/Passwords do not match/i)).toBeTruthy());
    // switch back
    fireEvent.click(screen.getByText("Login"));
    expect(screen.queryByText(/Passwords do not match/i)).toBeNull();
  });
});

// ── client-side validation ────────────────────────────────────────────────────

describe("client-side validation", () => {
  const switchToRegister = () => fireEvent.click(screen.getByText("Register"));

  it("shows password mismatch error", async () => {
    render(<AuthScreen />);
    switchToRegister();
    fireEvent.change(screen.getByPlaceholderText("your_username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "a@b.com" } });
    const [pw, confirm] = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(pw, { target: { value: "password1" } });
    fireEvent.change(confirm, { target: { value: "password2" } });
    fireEvent.submit(screen.getByRole("button", { name: /register/i }));
    await waitFor(() => expect(screen.getByText(/Passwords do not match/i)).toBeTruthy());
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("shows password too short error (< 6 chars)", async () => {
    render(<AuthScreen />);
    switchToRegister();
    fireEvent.change(screen.getByPlaceholderText("your_username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "a@b.com" } });
    const [pw, confirm] = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(pw, { target: { value: "123" } });
    fireEvent.change(confirm, { target: { value: "123" } });
    fireEvent.submit(screen.getByRole("button", { name: /register/i }));
    await waitFor(() => expect(screen.getByText(/at least 6 characters/i)).toBeTruthy());
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("shows username too short error (< 3 chars)", async () => {
    render(<AuthScreen />);
    switchToRegister();
    fireEvent.change(screen.getByPlaceholderText("your_username"), { target: { value: "ab" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "a@b.com" } });
    const [pw, confirm] = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(pw, { target: { value: "123456" } });
    fireEvent.change(confirm, { target: { value: "123456" } });
    fireEvent.submit(screen.getByRole("button", { name: /register/i }));
    await waitFor(() => expect(screen.getByText(/at least 3 characters/i)).toBeTruthy());
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

// ── submission ────────────────────────────────────────────────────────────────

describe("submission", () => {
  it("calls login with email and password in login mode", async () => {
    render(<AuthScreen />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "user@test.com" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByRole("button", { name: /login/i }));
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("user@test.com", "secret"));
  });

  it("calls register with username, email, password in register mode", async () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText("Register"));
    fireEvent.change(screen.getByPlaceholderText("your_username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "alice@test.com" } });
    const [pw, confirm] = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(pw, { target: { value: "secret123" } });
    fireEvent.change(confirm, { target: { value: "secret123" } });
    fireEvent.submit(screen.getByRole("button", { name: /register/i }));
    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith("alice", "alice@test.com", "secret123"),
    );
  });
});

// ── loading state ─────────────────────────────────────────────────────────────

describe("loading state", () => {
  it("disables submit button and shows authenticating text when isLoading", () => {
    mockUseAuthStore.mockReturnValue({ ...base, isLoading: true });
    render(<AuthScreen />);
    expect(screen.getByText(/Authenticating/i)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /authenticating/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ── server error ──────────────────────────────────────────────────────────────

describe("server error", () => {
  it("displays error from store", () => {
    mockUseAuthStore.mockReturnValue({ ...base, error: "Invalid credentials" });
    render(<AuthScreen />);
    expect(screen.getByText(/Invalid credentials/)).toBeTruthy();
  });
});
