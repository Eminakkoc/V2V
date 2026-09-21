import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { E2E_WEBHOOK_SECRET } from "./env";
import {
  FAKE_JOB_NAME_TRIGGERS,
  fakeMagicHourId,
  fakeUuid,
  mockProviders,
  signWebhook,
} from "./helpers";

// Rate-limit tally (lesson L-007): RATE_LIMITS.perIp allows 30 hits per scope per 10 minutes, and
// a single bucket covers every spec and both projects, which all reach localhost as one client.
// Measured across a full two-project run: 29 upload, 22 transform, 20 signature. The upload scope
// therefore has exactly one hit to spare -- which is why the three jobs here share one uploaded
// source, and why a new spec that uploads needs this re-measured first. CI retries draw on the
// same budget: one retry of an uploading test still fits, a second pushes the scope over and
// whatever runs next gets a 429, which reads as a failure with nothing to do with rate limits.

const rendering = FAKE_JOB_NAME_TRIGGERS.statusRendering;

async function createSource(page: Page): Promise<{ sourceId: string }> {
  const response = await page.request.post("/api/upload", {
    data: { cdnUrl: `https://ucarecdn.com/${fakeUuid()}/` },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { sourceId: body.sourceId };
}

async function startJob(
  page: Page,
  sourceId: string,
  name: string,
  endSeconds: number,
  artStyle: string,
): Promise<{ id: string }> {
  const response = await page.request.post("/api/transform", {
    data: {
      sourceId,
      idempotencyKey: randomUUID(),
      params: {
        name,
        startSeconds: 0,
        endSeconds,
        fpsResolution: "HALF",
        artStyle,
        promptType: "default",
        model: "default",
        version: "default",
      },
    },
  });
  expect(response.status()).toBe(202);
  return (await response.json()).job;
}

// Takes the already-serialized body, never an object to re-serialize: the signature is over these
// exact bytes.
async function deliverComplete(page: Page, magicHourId: string) {
  const rawBody = JSON.stringify({ type: "video.completed", payload: { id: magicHourId } });
  const { signature, timestamp } = signWebhook(rawBody, E2E_WEBHOOK_SECRET);
  const response = await page.request.post("/api/webhook", {
    data: rawBody,
    headers: {
      "content-type": "application/json",
      "magic-hour-event-signature": signature,
      "magic-hour-event-timestamp": timestamp,
    },
  });
  expect(response.status()).toBe(200);
}

test("the History list server-renders its first page, filters and sorts through the URL, survives a refresh, and loads more without refetching", async ({
  page,
}) => {
  test.setTimeout(45_000);

  // Three jobs whose duration-desc order [8, 5, 3] matches neither insertion order nor its reverse,
  // so the sort can only pass if it actually ran; mockProviders keeps the completed cards'
  // Cloudinary posters from becoming real fetches.
  await mockProviders(page, fakeUuid());

  const { sourceId } = await createSource(page);
  const jobA = await startJob(page, sourceId, "Clip A", 5, "Cyberpunk");
  const jobB = await startJob(page, sourceId, "Clip B", 8, "Anime Warrior");
  const nameC = `Clip C ${rendering}`;
  await startJob(page, sourceId, nameC, 3, "Ghibli Anime");

  // A and B are pushed to "complete" by an explicit delivery rather than left to reconciliation's
  // background sweep, and C carries the rendering trigger, so every card's state is deterministic
  // rather than a matter of timing.
  await deliverComplete(page, fakeMagicHourId(jobA.id));
  await deliverComplete(page, fakeMagicHourId(jobB.id));

  await test.step("the first page arrives server-rendered", async () => {
    let blockedRequests = 0;
    await page.route("**/api/history**", (route) => {
      blockedRequests += 1;
      return route.abort();
    });

    await page.goto("/history");
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();

    // Every client fetch to /api/history is being aborted, so these cards can only have come from
    // the server-rendered HTML.
    await expect(page.getByRole("article", { name: "Clip A" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("article", { name: nameC })).toBeVisible();

    // Confirms the block actually fired at least once, rather than silently missing every request
    // via a mismatched glob.
    await expect.poll(() => blockedRequests).toBeGreaterThan(0);

    await page.unroute("**/api/history**");
  });

  async function filterRowGeometry() {
    return page.evaluate(() => {
      const triggers = [...document.querySelectorAll("[data-slot=select-trigger]")].filter(
        (el) => (el as HTMLElement).offsetParent !== null,
      );
      const list = document.querySelector("[data-slot=history-scroll]");
      return {
        boxes: triggers.map((t) => {
          const r = t.getBoundingClientRect();
          return { x: Math.round(r.x), width: Math.round(r.width) };
        }),
        labels: triggers.map((t) => (t.textContent ?? "").trim().split(":")[0]),
        scrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
        pageOverflows: document.documentElement.scrollHeight > window.innerHeight,
        listScrolls: list ? list.scrollHeight > list.clientHeight : false,
      };
    });
  }

  await test.step("a status filter narrows the list and lands in the URL", async () => {
    const populated = await filterRowGeometry();

    await page.getByRole("combobox", { name: /^Status:/ }).click();
    await page.getByRole("option", { name: "Complete" }).click();

    await expect(page).toHaveURL(/statusBucket=complete/);
    await expect(page.getByRole("article", { name: "Clip A" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("article", { name: nameC })).toHaveCount(0);

    // The selected value must not resize the control it sits in: SelectTrigger is `w-fit`, so each
    // control used to be exactly as wide as its own label and every selection shoved the ones
    // beside it sideways.
    const filtered = await filterRowGeometry();
    expect(filtered.boxes).toEqual(populated.boxes);
    expect(filtered.labels).toEqual(populated.labels);
  });

  await test.step("a refresh preserves the filter", async () => {
    await page.reload();
    await expect(page).toHaveURL(/statusBucket=complete/);
    await expect(page.getByRole("article", { name: "Clip A" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("article", { name: nameC })).toHaveCount(0);
  });

  await test.step("the duration sort reorders the list", async () => {
    // Clear the status filter first, so all three clip lengths are back in play: sorting only the
    // two "complete" rows would not be discriminating.
    await page.getByRole("combobox", { name: /^Status:/ }).click();
    await page.getByRole("option", { name: "All" }).click();
    await expect(page).not.toHaveURL(/statusBucket/);

    await page.getByRole("combobox", { name: /^Sort:/ }).click();
    await page.getByRole("option", { name: "Longest clip first" }).click();
    await expect(page).toHaveURL(/sort=duration/);
    await expect(page).toHaveURL(/dir=desc/);

    // Duration-desc of [5, 8, 3] is [8, 5, 3], which matches neither insertion order nor its
    // reverse. Each card titles itself "<name> · <art style>".
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Clip B · Anime Warrior",
      "Clip A · Cyberpunk",
      `${nameC} · Ghibli Anime`,
    ]);
  });

  await test.step("load more appends without re-fetching earlier pages", async () => {
    await page.goto("/history?limit=2");

    await expect(page.getByRole("article", { name: nameC })).toBeVisible();
    await expect(page.getByRole("article", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Clip A" })).toHaveCount(0);

    const loadMore = page.getByRole("button", { name: "Load more" });
    await expect(loadMore).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/history") && res.url().includes("cursor="),
      ),
      loadMore.click(),
    ]);
    expect(response.status()).toBe(200);
    // A load-more request always carries the cursor of the last row already on screen, proving this
    // fetched page two.
    expect(new URL(response.url()).searchParams.get("cursor")).toBeTruthy();

    await expect(page.getByRole("article", { name: nameC })).toBeVisible();
    await expect(page.getByRole("article", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Clip A" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(3);
  });

  await test.step("filtering down to no matches leaves the row's geometry alone", async () => {
    const before = await filterRowGeometry();
    // The list owns the scroll, not the document: that is what keeps the header and this filter row
    // on screen however long the list gets.
    expect(before.listScrolls).toBe(true);
    expect(before.pageOverflows).toBe(false);

    // "Taking longer" matches none of the three seeded jobs. The empty state is what says the
    // panel resolved: a bare toHaveCount(0) is also true of the skeleton this page streams behind.
    await page.goto("/history?statusBucket=taking-longer");
    await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Clip A" })).toHaveCount(0);

    const empty = await filterRowGeometry();
    expect(empty.pageOverflows).toBe(false);

    // The Sort control used to be unmounted outright when nothing matched -- the largest of the
    // jumps, and a dead end.
    expect(empty.labels).toEqual(before.labels);
    expect(empty.labels).toContain("Sort");
    expect(empty.boxes).toEqual(before.boxes);

    // Reserved whether or not the document overflows, so /history and the scrolling Create page
    // centre their content columns identically.
    expect(empty.scrollbarGutter).toBe("stable");
  });
});

test("every filter dropdown opens anchored to its own trigger", async ({ page }) => {
  await page.goto("/history");

  for (const name of ["Status", "Style"]) {
    // Scope to the visible one: FilterBar also renders a phone-only copy behind `md:hidden`.
    const trigger = page.getByRole("combobox", { name }).and(page.locator(":visible"));
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    if (!triggerBox) throw new Error(`${name} trigger has no box`);

    await trigger.click();
    const popup = page.locator("[data-slot=select-content]").first();
    await expect(popup).toBeVisible();
    const popupBox = await popup.boundingBox();
    if (!popupBox) throw new Error(`${name} popup has no box`);

    // Radix's item-aligned default placed these relative to the selected ITEM rather than the
    // trigger, which on this page collapsed to the literal top-left corner of the viewport.
    expect(popupBox.y).toBeGreaterThan(triggerBox.y);
    expect(popupBox.x).toBeGreaterThan(triggerBox.x - popupBox.width);
    expect(popupBox.x).toBeLessThan(triggerBox.x + triggerBox.width);

    // item-aligned also ignored --radix-select-content-available-height, so the 75-entry Style list
    // rendered far taller than the viewport instead of scrolling.
    const viewport = page.viewportSize();
    if (viewport) expect(popupBox.height).toBeLessThanOrEqual(viewport.height);

    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
  }
});
