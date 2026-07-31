const { expect } = require("@playwright/test");
const { PASSWORD, USERS } = require("./seed-users");

async function dismissTestSiteOverlay(page) {
  const overlay = page.locator("#test-site-overlay");
  if (await overlay.count()) {
    const visible = await overlay.isVisible().catch(() => false);
    if (visible) {
      const btn = overlay.locator("button, [data-confirm], #confirm-yes, .confirm-yes").first();
      if (await btn.count()) {
        await btn.click({ force: true }).catch(() => {});
      }
      await page.evaluate(() => {
        const el = document.getElementById("test-site-overlay");
        if (el) {
          el.hidden = true;
          el.style.display = "none";
        }
      }).catch(() => {});
    }
  }
}

async function loginAs(page, role) {
  const account = USERS[role];
  if (!account) throw new Error(`Unknown e2e role: ${role}`);

  await page.goto("/login");
  await dismissTestSiteOverlay(page);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form[action="/login"] button[type="submit"]').click();

  // MFA should be bypassed in e2e (E2E_BYPASS_MFA)
  try {
    await expect(page).not.toHaveURL(/\/login(\/mfa)?$/, { timeout: 15000 });
  } catch (err) {
    throw new Error(`Login as ${role} failed; ended on ${page.url()}`);
  }
  await dismissTestSiteOverlay(page);
}

async function expectOk(page, path, { heading, text } = {}) {
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res, `No response for ${path}`).toBeTruthy();
  expect(res.status(), `${path} status`).toBeLessThan(500);
  if (heading) {
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 10000 });
  }
  if (text) {
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 10000 });
  }
  return res;
}

async function expectRedirectAway(page, path, notUrl) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(notUrl);
}

module.exports = {
  loginAs,
  expectOk,
  expectRedirectAway,
  dismissTestSiteOverlay,
  PASSWORD,
  USERS,
};
