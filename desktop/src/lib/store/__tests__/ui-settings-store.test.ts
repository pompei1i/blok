import { describe, it, expect, beforeEach } from "vitest";
import { useUiSettingsStore } from "../ui-settings-store";

const DEFAULTS = {
  previewVideo: true,
  mirrorCamera: true,
  cameraQuality: "1080p" as const,
  noiseSuppression: false,
  echoCancellation: false,
  inputVolume: 70,
  noiseGateThreshold: 30,
  pushToTalk: false,
  inputDevice: "",
  outputDevice: "",
  compactMode: false,
  showMemberList: true,
  themeMode: "dark" as const,
  uiScale: 100,
  language: "English" as const,
  customCss: "",
};

beforeEach(() => {
  useUiSettingsStore.setState({ ...DEFAULTS });
});

// ── default values ────────────────────────────────────────────────────────────

describe("initial state", () => {
  it("has correct default inputDevice (empty = system default)", () => {
    expect(useUiSettingsStore.getState().inputDevice).toBe("");
  });

  it("has correct default outputDevice (empty = system default)", () => {
    expect(useUiSettingsStore.getState().outputDevice).toBe("");
  });

  it("has correct default inputVolume", () => {
    expect(useUiSettingsStore.getState().inputVolume).toBe(70);
  });

  it("has noise suppression off by default", () => {
    expect(useUiSettingsStore.getState().noiseSuppression).toBe(false);
  });

  it("has echo cancellation off by default", () => {
    expect(useUiSettingsStore.getState().echoCancellation).toBe(false);
  });
});

// ── setSetting ────────────────────────────────────────────────────────────────

describe("setSetting", () => {
  it("updates a boolean setting", () => {
    useUiSettingsStore.getState().setSetting("noiseSuppression", true);
    expect(useUiSettingsStore.getState().noiseSuppression).toBe(true);
  });

  it("updates a numeric setting", () => {
    useUiSettingsStore.getState().setSetting("inputVolume", 42);
    expect(useUiSettingsStore.getState().inputVolume).toBe(42);
  });

  it("updates inputDevice", () => {
    useUiSettingsStore.getState().setSetting("inputDevice", "Headset Mic (Realtek)");
    expect(useUiSettingsStore.getState().inputDevice).toBe("Headset Mic (Realtek)");
  });

  it("updates outputDevice", () => {
    useUiSettingsStore.getState().setSetting("outputDevice", "Speakers (Realtek)");
    expect(useUiSettingsStore.getState().outputDevice).toBe("Speakers (Realtek)");
  });

  it("clears inputDevice back to system default (empty string)", () => {
    useUiSettingsStore.getState().setSetting("inputDevice", "Some Device");
    useUiSettingsStore.getState().setSetting("inputDevice", "");
    expect(useUiSettingsStore.getState().inputDevice).toBe("");
  });

  it("updates themeMode", () => {
    useUiSettingsStore.getState().setSetting("themeMode", "light");
    expect(useUiSettingsStore.getState().themeMode).toBe("light");
  });

  it("updates uiScale", () => {
    useUiSettingsStore.getState().setSetting("uiScale", 110);
    expect(useUiSettingsStore.getState().uiScale).toBe(110);
  });

  it("updates noiseGateThreshold to 0 (off)", () => {
    useUiSettingsStore.getState().setSetting("noiseGateThreshold", 0);
    expect(useUiSettingsStore.getState().noiseGateThreshold).toBe(0);
  });

  it("updates customCss", () => {
    const css = ":root { --accent-red: #00ff00; }";
    useUiSettingsStore.getState().setSetting("customCss", css);
    expect(useUiSettingsStore.getState().customCss).toBe(css);
  });

  it("does not affect unrelated settings", () => {
    useUiSettingsStore.getState().setSetting("inputVolume", 50);
    const state = useUiSettingsStore.getState();
    expect(state.noiseSuppression).toBe(false);
    expect(state.echoCancellation).toBe(false);
    expect(state.themeMode).toBe("dark");
    expect(state.inputDevice).toBe("");
  });
});
