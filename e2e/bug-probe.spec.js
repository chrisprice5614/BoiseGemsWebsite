const { test, expect } = require("@playwright/test");
const { loginAs, USERS, PASSWORD } = require("./helpers/auth");

/**
 * Broader feature probes meant to surface 5xx / broken flows.
 * Failures here are reported as app bugs.
 */

async function statusOf(page, path) {
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  return res ? res.status() : 0;
}

test.describe("Bug probe - extra routes & flows", () => {
  test("/tour is removed", async ({ page }) => {
    const status = await statusOf(page, "/tour");
    expect(status).toBe(404);
  });

  test("edit-event requires authentication", async ({ page }) => {
    await page.goto("/edit-event/1", { waitUntil: "domcontentloaded" });
    // mustBeAdmin redirects anonymous users away from the edit form
    await expect(page).not.toHaveURL(/edit-event/);
  });

  test("GET /register-fan redirects to register hub", async ({ page }) => {
    await page.goto("/register-fan", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/register\/?$/);
  });

  test("/merch and /shop redirect to /store", async ({ page }) => {
    for (const path of ["/merch", "/shop"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/store\/?$/);
    }
  });

  test("/check-email page loads", async ({ page }) => {
    const status = await statusOf(page, "/check-email");
    expect(status).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("/check-registration returns JSON for email lookup", async ({ request }) => {
    const res = await request.get(
      `/check-registration?email=${encodeURIComponent(USERS.member.email)}`
    );
    expect(res.status()).toBeLessThan(500);
    const body = await res.json();
    expect(body.emailTaken).toBe(true);
  });

  test("/check-registration for unused email", async ({ request }) => {
    const res = await request.get(
      "/check-registration?email=brand-new-e2e-" + Date.now() + "@boisegems.test"
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.emailTaken).toBe(false);
  });

  test("admin add-event and news/new load", async ({ page }) => {
    await loginAs(page, "admin");
    for (const path of ["/add-event", "/news/new", "/news-admin", "/events-admin"]) {
      const status = await statusOf(page, path);
      expect(status, `${path} status ${status}`).toBeLessThan(500);
      await expect(page).not.toHaveURL(/\/login(?:\/mfa)?(?:\?|$)/);
    }
  });

  test("admin edit-event with bogus id does not 5xx", async ({ page }) => {
    await loginAs(page, "admin");
    const status = await statusOf(page, "/edit-event/99999999");
    expect(status).toBeLessThan(500);
  });

  test("staff can log in to staff tools", async ({ page }) => {
    await loginAs(page, "staff");
    const status = await statusOf(page, "/staff/members");
    expect(status).toBeLessThan(500);
    await expect(page).toHaveURL(/staff\/members/);
  });

  test("parent can log in to parent portal", async ({ page }) => {
    await loginAs(page, "parent");
    const status = await statusOf(page, "/parent-portal");
    expect(status).toBeLessThan(500);
    await expect(page).toHaveURL(/parent-portal/);
  });

  test("fan can log in to fan portal", async ({ page }) => {
    await loginAs(page, "fan");
    const status = await statusOf(page, "/fan-portal");
    expect(status).toBeLessThan(500);
    await expect(page).toHaveURL(/fan-portal/);
  });
});

test.describe("Bug probe - registration validation", () => {
  test("member register rejects weak password", async ({ page }) => {
    await page.goto("/register-member");
    await page.locator('input[name="firstname"]').fill("Weak");
    await page.locator('input[name="lastname"]').fill("Pass");
    await page.locator('input[name="phone"]').fill("(208) 555-0100");
    await page.locator('input[name="email"]').fill(`weak-pass-${Date.now()}@boisegems.test`);
    await page.locator('input[name="password"]').fill("short");
    await page.locator('input[name="passwordRetype"]').fill("short");
    // birthday / other required fields if present
    const dob = page.locator('input[name="birthday"], input[name="dob"], input[type="date"]').first();
    if (await dob.count()) {
      await dob.fill("2005-01-15");
    }
    await page.locator('form button[type="submit"], form input[type="submit"]').first().click();
    await expect(page.locator("body")).toContainText(/password|12|upper|lower|digit|special|character/i);
  });

  test("member register rejects duplicate email", async ({ page }) => {
    await page.goto("/register-member");
    await page.locator('input[name="firstname"]').fill("Dup");
    await page.locator('input[name="lastname"]').fill("Email");
    await page.locator('input[name="phone"]').fill("(208) 555-0101");
    await page.locator('input[name="email"]').fill(USERS.member.email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('input[name="passwordRetype"]').fill(PASSWORD);
    const dob = page.locator('input[name="birthday"], input[name="dob"], input[type="date"]').first();
    if (await dob.count()) {
      await dob.fill("2005-01-15");
    }
    await page.locator('form button[type="submit"], form input[type="submit"]').first().click();
    await expect(page.locator("body")).toContainText(/already|taken|exist|registered|in use/i);
  });

  test("parent register page can submit and reject weak password", async ({ page }) => {
    await page.goto("/register-parent");
    await page.locator('input[name="firstname"]').fill("Weak");
    await page.locator('input[name="lastname"]').fill("Parent");
    await page.locator('input[name="phone"]').fill("(208) 555-0102");
    await page.locator('input[name="email"]').fill(`weak-parent-${Date.now()}@boisegems.test`);
    await page.locator('input[name="password"]').fill("password");
    await page.locator('input[name="passwordRetype"]').fill("password");
    await page.locator('form button[type="submit"], form input[type="submit"]').first().click();
    await expect(page.locator("body")).toContainText(/password|12|upper|lower|digit|special|character/i);
  });

  test("fan/register hub still offers account type choices", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("body")).toContainText(/member|parent|fan/i);
  });
});
