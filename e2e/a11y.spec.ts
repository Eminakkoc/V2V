import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { dropZone } from "./helpers";

// Axe measures the settled page. On "/" the drop zone's buttons stay disabled
// until the uploader's dynamic import resolves, and axe reports their muted
// disabled palette as a contrast violation if it runs first. WCAG 1.4.3 exempts
// inactive components, so waiting measures the state the bar actually applies
// to instead of racing the import.
const pages: { path: string; settled: (page: Page) => Promise<void> }[] = [
  {
    path: "/",
    settled: (page) => expect(dropZone(page).getByRole("button").first()).toBeEnabled(),
  },
  {
    path: "/history",
    settled: (page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible(),
  },
];

for (const { path, settled } of pages) {
  test(`${path} has no WCAG 2.1 A/AA violations`, async ({ page }) => {
    await page.goto(path);
    await settled(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
