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

  test("MFA is not required for member, parent, or instructional staff", async () => {
    const path = require("path");
    const Database = require("better-sqlite3");
    const rolesSystem = require("../roles-system");
    const db = new Database(path.join(__dirname, "..", "data.db"));
    const member = db.prepare("SELECT * FROM users WHERE email = ?").get(USERS.member.email);
    const parent = db.prepare("SELECT * FROM users WHERE email = ?").get(USERS.parent.email);
    const staff = db.prepare("SELECT * FROM users WHERE email = ?").get(USERS.staff.email);
    const admin = db.prepare("SELECT * FROM users WHERE email = ?").get(USERS.admin.email);
    expect(rolesSystem.userRequiresMfa(db, member)).toBe(false);
    expect(rolesSystem.userRequiresMfa(db, parent)).toBe(false);
    expect(rolesSystem.userRequiresMfa(db, staff)).toBe(false);
    expect(rolesSystem.userRequiresMfa(db, admin)).toBe(true);

    // Even if a member somehow had a requires_mfa role, non-staff/non-admin never MFA
    const fakeMemberWithRole = { ...member, admin: 0, staff: 0, parent: 0 };
    expect(rolesSystem.userRequiresMfa(db, fakeMemberWithRole)).toBe(false);
    db.close();
  });
});
