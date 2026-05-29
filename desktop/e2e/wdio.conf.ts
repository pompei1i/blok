/**
 * E2E test runner for $blok (Tauri app) using WebdriverIO + tauri-driver.
 *
 * Prerequisites (one-time setup):
 *   cargo install tauri-driver          # WebDriver server that wraps msedgedriver on Windows
 *   cd desktop && npm run tauri build   # produces src-tauri/target/release/blok.exe
 *   cd desktop/e2e && npm install
 *
 * Run:
 *   cd desktop && npm run test:e2e
 */

import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import type { Options } from "@wdio/types";

// Path to the compiled Tauri binary (relative to this config file)
const APP_BINARY = resolve(__dirname, "../src-tauri/target/release/blok.exe");

let tauriDriver: ChildProcess;

export const config: Options.Testrunner = {
  specs: ["./specs/**/*.e2e.ts"],
  // Single worker: all spec files share ONE session → one blok.exe instance.
  // Multiple sessions would trigger tauri-plugin-single-instance and break the
  // second session's WebView2 connection.
  maxInstances: 1,

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  capabilities: [
    {
      maxInstances: 1,
      // "chrome" triggers tauri-driver's WebView2/chromium path on Windows
      browserName: "chrome",
      "tauri:options": {
        application: APP_BINARY,
      },
      acceptInsecureCerts: true,
    },
  ] as any[],

  logLevel: "warn",
  reporters: ["spec"],

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 30_000,
  },

  // Wait for the Tauri WebView2 to fully load the React app before any test runs.
  //
  // tauri-driver may attach to the WebView2 container handle rather than the
  // browsing context that has the app content. We iterate all window handles
  // to find the one with a non-empty title, then wait for it to load.
  async before() {
    await browser.waitUntil(
      async () => {
        try {
          // Iterate all open handles — one of them is the app content page.
          const handles = await browser.getWindowHandles();
          for (const h of handles) {
            await browser.switchToWindow(h);
            const title = await browser.getTitle();
            if (title !== "") return true;
          }
          return false;
        } catch {
          return false;
        }
      },
      { timeout: 60_000, interval: 2_000, timeoutMsg: "Tauri app window not found within 60 s" },
    );
  },

  // Start tauri-driver before the test session
  onPrepare() {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
    });
  },

  // Kill tauri-driver after all tests complete
  onComplete() {
    tauriDriver?.kill();
  },
};
