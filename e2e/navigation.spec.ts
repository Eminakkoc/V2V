import { expect, test } from "@playwright/test";

test("the top bar moves between Create and History", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Create" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
});

test("a first visit receives the identity cookie", async ({ page, context }) => {
  await page.goto("/");
  await expect
    .poll(async () => (await context.cookies()).some((cookie) => cookie.name === "v2v_uid"))
    .toBe(true);
});
