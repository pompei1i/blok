import { describe, it, expect, beforeEach } from "vitest";
import { useScreenPickerStore } from "../screen-picker-store";
import { useUiSettingsStore } from "../ui-settings-store";
import type { CaptureSource } from "../screen-picker-store";

const SOURCES: CaptureSource[] = [
  { id: "screen:0", name: "Screen 1", kind: "screen" },
  { id: "window:42", name: "Some window", kind: "window" },
];

beforeEach(() => {
  useScreenPickerStore.getState().cancel();
});

describe("desktop-audio checkbox preset", () => {
  // The bug: a fresh share always opened with the audio box unticked, because
  // `initialAudio` defaulted to false rather than deferring to the remembered
  // setting — so the tick was lost every single time.
  it("leaves initialAudio unset for a fresh share so the saved setting wins", () => {
    void useScreenPickerStore.getState().requestPick(SOURCES);
    expect(useScreenPickerStore.getState().initialAudio).toBeUndefined();
  });

  it("carries the live state through a mid-share source switch", () => {
    void useScreenPickerStore.getState().requestPick(SOURCES, { initialAudio: true });
    expect(useScreenPickerStore.getState().initialAudio).toBe(true);

    useScreenPickerStore.getState().cancel();
    void useScreenPickerStore.getState().requestPick(SOURCES, { initialAudio: false });
    // Explicit false must stay false — it means "the share currently has no
    // audio", which has to beat a remembered `true`.
    expect(useScreenPickerStore.getState().initialAudio).toBe(false);
  });

  it("clears the preset again once the picker closes", () => {
    void useScreenPickerStore.getState().requestPick(SOURCES, { initialAudio: true });
    useScreenPickerStore.getState().confirm({ sourceId: "screen:0", withAudio: true });
    expect(useScreenPickerStore.getState().initialAudio).toBeUndefined();
    expect(useScreenPickerStore.getState().open).toBe(false);
  });

  it("remembers the audio choice as a persisted setting", () => {
    expect(useUiSettingsStore.getState().screenShareAudio).toBe(false);
    useUiSettingsStore.getState().setSetting("screenShareAudio", true);
    expect(useUiSettingsStore.getState().screenShareAudio).toBe(true);
    useUiSettingsStore.getState().setSetting("screenShareAudio", false);
  });
});

describe("requestPick lifecycle", () => {
  it("resolves a pending pick as cancelled when a new one starts", async () => {
    const first = useScreenPickerStore.getState().requestPick(SOURCES);
    void useScreenPickerStore.getState().requestPick(SOURCES);
    await expect(first).resolves.toBeNull();
  });

  it("resolves with the chosen source", async () => {
    const pick = useScreenPickerStore.getState().requestPick(SOURCES);
    useScreenPickerStore.getState().confirm({ sourceId: "window:42", withAudio: true });
    await expect(pick).resolves.toEqual({ sourceId: "window:42", withAudio: true });
  });
});
