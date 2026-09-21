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

// IR-009. Seeds nothing and calls neither /api/upload nor /api/transform, so
// it costs nothing against the shared rate-limit tally in history.spec.ts.
test("every page's content column shares its edges with the header", async ({ page }) => {
  for (const path of ["/", "/history"]) {
    await page.goto(path);

    const edges = await page.evaluate(() => {
      const box = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.x), right: Math.round(r.right) };
      };
      return {
        header: box(document.querySelector("header > div")),
        main: box(document.querySelector("main > div")),
      };
    });

    // The Create page was the only one on max-w-6xl, so its content overhung
    // the nav above it by exactly 64px each side (64..1216 against the
    // header's 128..1152) while /history lined up with it perfectly. The
    // requirement is that they agree, whatever the shared value turns out to
    // be -- so this compares them to each other rather than to a number.
    expect(edges.header, `${path} header`).not.toBeNull();
    expect(edges.main, `${path} main`).not.toBeNull();
    expect(edges.main, `${path} content column vs header`).toEqual(edges.header);
  }
});
