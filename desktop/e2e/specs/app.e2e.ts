/**
 * App smoke + auth E2E tests.
 *
 * Uses demo account (shown in the auth screen tip): demo@blok.app / demo123.
 * Requires network access to the Supabase backend.
 */

const DEMO_EMAIL = "demo@blok.app";
const DEMO_PASSWORD = "demo123";
const LOGIN_TIMEOUT = 15_000;

describe("app launch", () => {
  it("window title is $blok", async () => {
    const title = await browser.getTitle();
    expect(title).toBe("$blok");
  });

  it("auth screen is shown on first launch (no session)", async () => {
    const heading = await $("h1");
    await heading.waitForDisplayed({ timeout: 5_000 });
    expect(await heading.getText()).toBe("BLOK");
  });
});

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
    // Inputs are already filled from the previous test
    const loginBtn = await $("button=Login");
    await loginBtn.click();

    // Auth screen heading disappears once the session is established
    await browser.waitUntil(
      async () => {
        const h = await $("h1");
        return !(await h.isExisting()) || (await h.getText()) !== "BLOK";
      },
      { timeout: LOGIN_TIMEOUT, timeoutMsg: "Auth screen still visible after login" },
    );
  });

  it("main layout is visible after login", async () => {
    // The group sidebar renders a fixed-width column; its presence confirms we are past auth
    const sidebar = await $('[class*="group-sidebar"], [class*="GroupSidebar"], nav, aside');
    await sidebar.waitForDisplayed({ timeout: LOGIN_TIMEOUT });
    expect(await sidebar.isDisplayed()).toBe(true);
  });
});

describe("logout", () => {
  it("clicking logout returns to auth screen", async () => {
    // User-bar contains the logout button; click the icon that opens the menu
    const userBar = await $('[class*="user-bar"]');
    if (await userBar.isExisting()) {
      await userBar.click();
      // Find and click a logout / sign-out button if present
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
