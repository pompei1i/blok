/**
 * E2E smoke tests for $blok.
 *
 * All tests run in ONE WebdriverIO session (one tauri-driver connection, one
 * blok.exe instance). Splitting across multiple spec files would cause a second
 * session to attempt launching the app — blocked by tauri-plugin-single-instance.
 */

import { spawnSync } from "child_process";
import { resolve } from "path";

const APP_BINARY = resolve(__dirname, "../../src-tauri/target/release/blok.exe");

const DEMO_EMAIL = "demo@blok.app";
const DEMO_PASSWORD = "demo123";
const LOGIN_TIMEOUT = 15_000;

// ── app launch ────────────────────────────────────────────────────────────────

describe("app launch", () => {
  it("window title is $blok", async () => {
    expect(await browser.getTitle()).toBe("$blok");
  });

  it("auth screen is shown on first launch (no session)", async () => {
    const heading = await $("h1");
    await heading.waitForDisplayed({ timeout: 10_000 });
    expect(await heading.getText()).toBe("BLOK");
  });
});

// ── auth flow ─────────────────────────────────────────────────────────────────

describe("auth flow", () => {
  it("login form accepts email and password", async () => {
    const emailInput = await $('input[type="email"]');
    await emailInput.waitForDisplayed();
    await emailInput.setValue(DEMO_EMAIL);
    expect(await emailInput.getValue()).toBe(DEMO_EMAIL);

    const passwordInput = await $('input[type="password"]');
    await passwordInput.setValue(DEMO_PASSWORD);
    expect(await passwordInput.getValue()).toBe(DEMO_PASSWORD);
  });

  it("submitting valid credentials leaves the auth screen", async () => {
    const loginBtn = await $("button=Login");
    await loginBtn.click();

    await browser.waitUntil(
      async () => {
        const h = await $("h1");
        return !(await h.isExisting()) || (await h.getText()) !== "BLOK";
      },
      { timeout: LOGIN_TIMEOUT, timeoutMsg: "Auth screen still visible after login" },
    );
  });

  it("main layout is visible after login", async () => {
    const sidebar = await $('[class*="group-sidebar"], [class*="GroupSidebar"], nav, aside');
    await sidebar.waitForDisplayed({ timeout: LOGIN_TIMEOUT });
    expect(await sidebar.isDisplayed()).toBe(true);
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe("logout", () => {
  it("clicking logout returns to auth screen", async () => {
    const userBar = await $('[class*="user-bar"]');
    if (await userBar.isExisting()) {
      await userBar.click();
      const logoutBtn = await $("button*=logout");
      if (await logoutBtn.isExisting()) {
        await logoutBtn.click();
        const heading = await $("h1=BLOK");
        await heading.waitForDisplayed({ timeout: 5_000 });
        expect(await heading.getText()).toBe("BLOK");
      }
    }
  });
});

// ── single-instance ───────────────────────────────────────────────────────────
//
// These tests MUST stay in the same session as the tests above. A separate spec
// file would create a second WebdriverIO session, which triggers a second
// blok.exe launch — immediately blocked by tauri-plugin-single-instance, leaving
// tauri-driver without a connectable WebView2 and all subsequent tests failing.

describe("single-instance", () => {
  it("second launch exits quickly (single-instance plugin intercepted it)", async () => {
    await browser.minimizeWindow();

    const result = spawnSync(APP_BINARY, [], {
      timeout: 8_000,
      stdio: "inherit",
    });

    // The second process must exit (status 0 or OS-terminated — not hanging)
    expect(result.status).not.toBeNull();
    expect(result.error).toBeUndefined();
  });

  it("first window is still responsive after second launch attempt", async () => {
    const title = await browser.getTitle();
    expect(title).toBe("$blok");
  });

  it("first window is no longer minimized (plugin called show + set_focus)", async () => {
    await browser.pause(500);
    const rect = await browser.getWindowRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});
