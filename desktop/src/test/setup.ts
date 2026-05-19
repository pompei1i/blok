import { vi } from "vitest";

// ── Tauri mocks ───────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(null),
}));

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
  send: vi.fn().mockResolvedValue({}),
  track: vi.fn().mockResolvedValue({}),
  presenceState: vi.fn().mockReturnValue({}),
};

const mockQuery = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  then: vi.fn(),
};

// Make every chainable method return the query object itself
Object.keys(mockQuery).forEach((key) => {
  if (key !== "single" && key !== "maybeSingle" && key !== "then") {
    (mockQuery as Record<string, unknown>)[key] = vi.fn().mockReturnValue(mockQuery);
  }
});

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    channel: vi.fn().mockReturnValue(mockChannel),
    removeChannel: vi.fn().mockResolvedValue({}),
    from: vi.fn().mockReturnValue(mockQuery),
  },
}));

// Expose mockQuery so tests can configure per-test return values
(globalThis as Record<string, unknown>).__mockSupabaseQuery = mockQuery;
(globalThis as Record<string, unknown>).__mockChannel = mockChannel;
