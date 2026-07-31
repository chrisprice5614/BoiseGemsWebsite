const { test, expect } = require("@playwright/test");
const { loginAs, USERS, PASSWORD } = require("./helpers/auth");

test.describe("Auth", () => {
  test("login page shows email/password form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill("nobody@boisegems.test");
    await page.locator('input[name="password"]').fill("WrongPass1!");
    await page.locator('form[action="/login"] button').first().click();
    await expect(page.getByText(/invalid email\/password/i)).toBeVisible();
  });

  test("member can log in and out", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/member-portal");
    await expect(page).toHaveURL(/member-portal/);
    await page.goto("/logout");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/member-portal");
    await expect(page).not.toHaveURL(/member-portal/);
  });

  test("admin can log in (MFA bypassed in e2e)", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin-portal");
    await expect(page).toHaveURL(/admin-portal/);
    await expect(page.getByText(/administrator|admin portal|overview/i).first()).toBeVisible();
  });

  test("forgot-password page accepts email field", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.locator('input[name="email"], input[type="email"]').first()).toBeVisible();
  });

  test("register pages render", async ({ page }) => {
    for (const path of ["/register", "/register-member", "/register-parent"]) {
      const res = await page.goto(path);
      expect(res.status()).toBeLessThan(500);
      await expect(page.locator('input[name="email"], input[type="email"]').first()).toBeVisible();
    }
  });

  test("e2e credentials are present", async () => {
    expect(USERS.admin.email).toContain("@boisegems.test");
    expect(PASSWORD.length).toBeGreaterThanOrEqual(12);
  });
});
