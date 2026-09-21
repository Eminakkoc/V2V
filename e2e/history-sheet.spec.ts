import { expect, test } from "@playwright/test";

// Mobile-only (see playwright.config.ts's desktop testIgnore): the Filter
// button this spec drives lives in FilterBar's `md:hidden` block and is
// never visible on the desktop viewport.
//
// Seeds no jobs -- costs no upload or transform request, so it spends
// nothing from the shared per-IP rate-limit window e2e/history.spec.ts's
// own tally comment tracks. A fresh anonymous session already has zero
// jobs, so navigating straight to a filtered /history URL produces an
// already-filtered EMPTY list (the "No matches" state) without seeding
// anything -- exactly what this spec needs to open the sheet against.
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

  // Not merely "opens" -- the sheet genuinely reflects the URL's already-
  // active filter rather than a fresh/default one.
  await expect(dialog.getByRole("radio", { name: "Complete" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Focus trap: Tab well past the sheet's own handful of stops (close
  // button, status radiogroup, style radiogroup, include-previous checkbox
  // -- the sort control is hidden while the list is empty) and confirm
  // focus never lands outside the dialog.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(filterButton).toBeFocused();
});
