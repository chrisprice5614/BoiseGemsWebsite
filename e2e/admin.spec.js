const { test, expect } = require("@playwright/test");
const { loginAs } = require("./helpers/auth");
const { ADMIN_PAGES } = require("./helpers/routes");

test.describe("Admin portal & tools", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  for (const path of ADMIN_PAGES) {
    test(`admin can open ${path}`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res, `missing response for ${path}`).toBeTruthy();
      expect(res.status(), `${path} should not 5xx`).toBeLessThan(500);
      // Some admin tools redirect within the admin area; just ensure we stay authenticated
      // and do not bounce to the public login page.
      await expect(page).not.toHaveURL(/\/login(?:\/mfa)?(?:\?|$)/);
    });
  }

  test("admin portal sections render", async ({ page }) => {
    await page.goto("/admin-portal");
    await expect(page.getByText(/Members|Contracts|System|Overview/i).first()).toBeVisible();
  });

  test("roles page lists Corps and Independent variants", async ({ page }) => {
    await page.goto("/admin/roles");
    await expect(page.getByRole("heading", { name: /roles/i })).toBeVisible();
    await expect(page.getByText(/Instructional staff \(Corps\)/i)).toBeVisible();
    await expect(page.getByText(/Instructional staff \(Independent\)/i)).toBeVisible();
  });

  test("season settings page loads", async ({ page }) => {
    await page.goto("/admin/season");
    await expect(page.locator('input[name="current_season"]')).toBeVisible();
    await expect(page.locator('input[name="season_end_date"]')).toBeVisible();
  });

  test("edit users page loads search UI", async ({ page }) => {
    await page.goto("/edit-users");
    await expect(page.locator('form[action="/edit-users"], input[name="search"]').first()).toBeVisible();
  });

  test("monitoring page loads", async ({ page }) => {
    await page.goto("/admin/monitoring");
    await expect(page.getByText(/monitoring|health|backup|error/i).first()).toBeVisible();
  });
});
