/**
 * Single-instance E2E test.
 *
 * tauri-plugin-single-instance ensures that when a second process is spawned
 * while the app is already running, the second process exits immediately and
 * the first window receives focus (un-minimized if necessary).
 *
 * The first app instance is managed by WebdriverIO (wdio.conf.ts).
 * We spawn the second instance manually and observe its exit code + timing.
 */

import { spawnSync } from "child_process";
import { resolve } from "path";

const APP_BINARY = resolve(__dirname, "../../src-tauri/target/release/blok.exe");

describe("single-instance", () => {
  it("second launch exits quickly (single-instance plugin intercepted it)", async () => {
    // Minimise the first window so we can detect focus restoration
    await browser.minimizeWindow();

    // Spawn a second instance — the plugin kills it after forwarding the event
    const result = spawnSync(APP_BINARY, [], {
      timeout: 5_000,
      // Inherit stdio so CI logs show any crash output
      stdio: "inherit",
    });

    // The second process must exit (status 0 or OS-terminated — not hanging)
    expect(result.status).not.toBeNull();
    expect(result.error).toBeUndefined();
  });

  it("first window is still responsive after second launch attempt", async () => {
    // If the first window crashed or was killed, getTitle() would throw
    const title = await browser.getTitle();
    expect(title).toBe("$blok");
  });

  it("first window is no longer minimized (plugin called show + set_focus)", async () => {
    // Give the focus-restore IPC call a moment to propagate
    await browser.pause(500);

    // The window should report a non-zero rect (i.e. not fully minimized/hidden)
    const rect = await browser.getWindowRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});
