import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore, normalizeUsername } from "../auth-store";

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null, initialized: false });
});

// ── clearError ────────────────────────────────────────────────────────────────

describe("clearError", () => {
  it("sets error to null", () => {
    useAuthStore.setState({ error: "Something went wrong" });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });

  it("is a no-op when error is already null", () => {
    useAuthStore.setState({ error: null });
    expect(() => useAuthStore.getState().clearError()).not.toThrow();
    expect(useAuthStore.getState().error).toBeNull();
  });
});

// ── normalizeUsername ─────────────────────────────────────────────────────────

describe("normalizeUsername", () => {
  it("lowercases input", () => {
    expect(normalizeUsername("Alice")).toBe("alice");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeUsername("  bob  ")).toBe("bob");
  });

  it("replaces spaces with underscores", () => {
    expect(normalizeUsername("john doe")).toBe("john_doe");
  });

  it("removes non-alphanumeric characters except underscore", () => {
    expect(normalizeUsername("hello!@#world")).toBe("helloworld");
  });

  it("truncates to 24 characters", () => {
    const long = "a".repeat(30);
    expect(normalizeUsername(long)).toHaveLength(24);
  });

  it("returns 'user' for an empty string", () => {
    expect(normalizeUsername("")).toBe("user");
  });

  it("returns 'user' for a string of only invalid characters", () => {
    expect(normalizeUsername("!!!")).toBe("user");
  });

  it("preserves underscores", () => {
    expect(normalizeUsername("hello_world")).toBe("hello_world");
  });

  it("collapses multiple spaces into a single underscore-separated run", () => {
    // "foo   bar" → trim → replace /\s+/g with '_' → "foo_bar"
    expect(normalizeUsername("foo   bar")).toBe("foo_bar");
  });
});
