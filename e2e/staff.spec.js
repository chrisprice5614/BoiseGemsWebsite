const { test, expect } = require("@playwright/test");
const { loginAs } = require("./helpers/auth");
const { STAFF_PAGES } = require("./helpers/routes");

test.describe("Staff tools", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "staff");
  });

  for (const path of STAFF_PAGES) {
    test(`staff can open ${path}`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res.status()).toBeLessThan(500);
      await expect(page).not.toHaveURL(/\/login(?:\/mfa)?(?:\?|$)/);
    });
  }

  test("staff cannot open admin-only roles manager", async ({ page }) => {
    await page.goto("/admin/roles");
    // Staff without manage_roles / admin_portal should be redirected or forbidden
    const url = page.url();
    const body = await page.locator("body").innerText();
    const blocked =
      !/\/admin\/roles/.test(url) ||
      /do not have permission|forbidden/i.test(body);
    expect(blocked).toBeTruthy();
  });

  test("staff messenger can create group when permitted", async ({ page }) => {
    await page.goto("/staff/members");
    await page.evaluate(() => {
      const el = document.getElementById("test-site-overlay");
      if (el) { el.hidden = true; el.style.display = "none"; }
    });
    const fab = page.locator("#bgMsgFab");
    if (await fab.count()) {
      await fab.click({ force: true });
      await expect(page.locator("#bgMsgNewGroup")).toBeVisible();
    }
  });
});
