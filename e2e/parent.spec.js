const { test, expect } = require("@playwright/test");
const { loginAs } = require("./helpers/auth");
const { PARENT_PAGES } = require("./helpers/routes");

test.describe("Parent portal", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "parent");
  });

  for (const path of PARENT_PAGES) {
    test(`parent can open ${path}`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res.status()).toBeLessThan(500);
      await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  }

  test("parent cannot open admin portal", async ({ page }) => {
    await page.goto("/admin-portal");
    await expect(page).not.toHaveURL(/admin-portal/);
  });
});
