const { test, expect } = require("@playwright/test");
const { loginAs } = require("./helpers/auth");
const { FAN_PAGES } = require("./helpers/routes");

test.describe("Fan portal", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "fan");
  });

  for (const path of FAN_PAGES) {
    test(`fan can open ${path}`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res.status()).toBeLessThan(500);
      await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  }

  test("fan is redirected away from member portal", async ({ page }) => {
    await page.goto("/member-portal");
    await expect(page).not.toHaveURL(/member-portal/);
  });
});
