import { expect, test } from "@playwright/test";

// Mobile-only: the Filter button lives in FilterBar's `md:hidden` block, and seeding nothing
// already gives the "No matches" state this spec opens the sheet against.
test("the mobile filter sheet reflects the active filter, traps focus, closes on Escape, and returns focus to the Filter button", async ({
  page,
}) => {
  await page.goto("/history?statusBucket=complete");
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();

  const filterButton = page.getByRole("button", { name: "Filter" });
  await expect(filterButton).toBeVisible();
  await filterButton.click();

  const dialog = page.getByRole("dialog", { name: "Filters" });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByRole("radio", { name: "Complete" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Focus trap: Tab well past the sheet's own handful of stops and confirm focus never lands
  // outside the dialog.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(filterButton).toBeFocused();
});
