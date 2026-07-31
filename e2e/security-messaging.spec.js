const { test, expect } = require("@playwright/test");
const { loginAs } = require("./helpers/auth");

test.describe("Roles, security & messaging APIs", () => {
  test("unauthenticated messaging APIs return 401", async ({ request }) => {
    const summary = await request.get("/api/web/messages/summary");
    expect(summary.status()).toBe(401);
  });

  test("admin messaging summary includes capabilities", async ({ page, request }) => {
    await loginAs(page, "admin");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await request.get("/api/web/messages/summary", {
      headers: { Cookie: cookieHeader },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBeTruthy();
    expect(json.capabilities.createGroup).toBeTruthy();
    expect(json.capabilities.audiences.length).toBeGreaterThan(0);
  });

  test("member cannot create conversations via API", async ({ page, request }) => {
    await loginAs(page, "member");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await request.post("/api/web/messages/conversations", {
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
      },
      data: { memberIds: [1], title: "Nope" },
    });
    expect(res.status()).toBe(403);
  });

  test("admin audit log and login history pages load", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/audit-log");
    await expect(page.getByRole("heading", { name: /audit/i })).toBeVisible();
    await page.goto("/admin/login-history");
    await expect(page.getByRole("heading", { name: /login history/i })).toBeVisible();
  });

  test("admin can open create custom role form", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/roles/new");
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.getByText(/Create & name group chats|Messaging/i).first()).toBeVisible();
  });
});
