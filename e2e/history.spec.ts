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

// Rate-limit tally (lesson L-007, millwright-inspector/lessons-learned.md).
// RATE_LIMITS.perIp is 30 per scope ("upload" | "signature" | "transform")
// per 10 minutes, shared by every spec and every project against one IP
// (localhost); RATE_LIMITS.perUser is 10 per scope but resets every test (a
// fresh browser context gets a fresh anonymous v2v_uid cookie), so the
// per-IP total below is the binding constraint, not the per-user one.
//
// `grep -rn "api/upload\|api/transform\|uploadVideo\|startTransform\|submitTransform\|createSource\|startJob" e2e/*.spec.ts`,
// counted per scope and multiplied by the projects each spec actually runs
// under (desktop + mobile, unless testIgnore'd):
//
//                            upload scope      transform scope
//   upload.spec.ts             6 x2 = 12           0 x2 =  0
//   transform.spec.ts          5 x2 = 10           6 x2 = 12
//   transform-recovery.spec.ts 5 x1 =  5   (*)      6 x1 =  6   (*)
//   navigation.spec.ts         0                    0
//   a11y.spec.ts (before)      0                    0
//                             ----------           ----------
//   existing total               27                   18        (of 30 each)
//
//   (*) transform-recovery.spec.ts is already desktop-only (testIgnore on
//   the mobile project), which is the same restriction this file adds
//   itself, below.
//
// This file seeds ONE source (1 upload-scope hit) and THREE transform jobs
// against it (3 transform-scope hits) -- desktop-only, so those don't
// multiply by a second project: +1 upload, +3 transform.
//
// e2e/a11y.spec.ts's new populated-/history scan seeds one further job,
// desktop-only for the same reason: +1 upload, +1 transform.
//
//                            upload scope      transform scope
//   this file                    1                    3
//   a11y.spec.ts (populated)     1                    1
//                             ----------           ----------
//   new total                    29                   22        (of 30 each)
//
// Both land under 30 with headroom to spare (1 upload, 8 transform). Sharing
// one uploaded source across all three transform jobs here is what keeps
// the upload margin positive at all -- three separate sources would have
// spent the entire remaining upload budget and left nothing for a11y.spec.ts.

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

// Takes the already-serialized body, never an object to re-serialize: the
// signature is over these exact bytes (mirrors transform-recovery.spec.ts).
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

  // Three jobs, one shared source, distinct clip lengths that neither match
  // insertion order [5, 8, 3] nor its reverse [3, 8, 5] under a duration-desc
  // sort -- the sorted order [8, 5, 3] (Clip B, Clip A, Clip C) is the only
  // arrangement that proves the sort actually ran rather than falling back
  // to a createdAt ordering that would happen to look plausible too.
  // Clip A and Clip B end up "Complete" below, and their cards render a
  // <video poster> pointing at Cloudinary (see video-pair.tsx); without this
  // the browser would attempt a real fetch against a URL only the fake
  // provider knows about.
  await mockProviders(page, fakeUuid());

  const { sourceId } = await createSource(page);
  const jobA = await startJob(page, sourceId, "Clip A", 5, "Cyberpunk");
  const jobB = await startJob(page, sourceId, "Clip B", 8, "Anime Warrior");
  const nameC = `Clip C ${rendering}`;
  await startJob(page, sourceId, nameC, 3, "Ghibli Anime");

  // A and B are pushed to "complete" by an explicit webhook delivery rather
  // than left to reconciliation's background pass: GET /api/history now
  // schedules a reconciliation sweep on every request (see reconcile.ts),
  // and the fake provider's default status is already "complete", so an
  // unforced job would complete at some non-deterministic point relative to
  // this test's own assertions. Delivering directly removes that race for
  // A and B. C carries FAKE_JOB_NAME_TRIGGERS.statusRendering and is never
  // delivered, so getJobDetails always reports "rendering" for it --
  // mapProviderStatus keeps that as status "processing" no matter how many
  // times reconciliation re-checks it, so it stays non-terminal for the
  // whole test deterministically, not just by luck of timing.
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

    // All three cards are already in the DOM even though every possible
    // client fetch to /api/history is being aborted -- the first page can
    // only have come from the server-rendered HTML, not a client fetch.
    await expect(page.getByRole("region", { name: "Clip A" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("region", { name: nameC })).toBeVisible();

    // Confirms the block actually fired at least once (useHistoryRefresh's
    // mount effect requests /api/history?changeable=true) rather than
    // silently missing every request via a mismatched glob.
    await expect.poll(() => blockedRequests).toBeGreaterThan(0);

    await page.unroute("**/api/history**");
  });

  // IR-008. Rides along on the rows this test already seeded -- it adds no
  // /api/upload or /api/transform hit of its own, and the states it needs
  // (populated, then filtered to nothing) are ones the steps below reach
  // anyway.
  async function filterRowGeometry() {
    return page.evaluate(() => {
      const triggers = [...document.querySelectorAll("[data-slot=select-trigger]")].filter(
        (el) => (el as HTMLElement).offsetParent !== null,
      );
      return {
        boxes: triggers.map((t) => {
          const r = t.getBoundingClientRect();
          return { x: Math.round(r.x), width: Math.round(r.width) };
        }),
        labels: triggers.map((t) => (t.textContent ?? "").trim().split(":")[0]),
        scrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
        overflows: document.documentElement.scrollHeight > window.innerHeight,
      };
    });
  }

  await test.step("a status filter narrows the list and lands in the URL", async () => {
    const populated = await filterRowGeometry();

    await page.getByRole("combobox", { name: /^Status:/ }).click();
    await page.getByRole("option", { name: "Complete" }).click();

    await expect(page).toHaveURL(/statusBucket=complete/);
    await expect(page.getByRole("region", { name: "Clip A" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("region", { name: nameC })).toHaveCount(0);

    // The selected value must not resize the control it sits in. SelectTrigger
    // is `w-fit`, so each control used to be exactly as wide as its own label
    // ("Status: All" 108px, "Status: Failed" 130px, "Status: Complete" 153px)
    // and every selection shoved the controls to its right sideways.
    const filtered = await filterRowGeometry();
    expect(filtered.boxes).toEqual(populated.boxes);
    expect(filtered.labels).toEqual(populated.labels);
  });

  await test.step("a refresh preserves the filter", async () => {
    await page.reload();
    await expect(page).toHaveURL(/statusBucket=complete/);
    await expect(page.getByRole("region", { name: "Clip A" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("region", { name: nameC })).toHaveCount(0);
  });

  await test.step("the duration sort reorders the list", async () => {
    // Clear the status filter first so all three clip lengths are back in
    // play -- sorting only the two "complete" rows would not be
    // discriminating (two rows sort the same way regardless of which field
    // is used).
    await page.getByRole("combobox", { name: /^Status:/ }).click();
    await page.getByRole("option", { name: "All" }).click();
    await expect(page).not.toHaveURL(/statusBucket/);

    await page.getByRole("combobox", { name: /^Sort:/ }).click();
    await page.getByRole("option", { name: "Longest clip first" }).click();
    await expect(page).toHaveURL(/sort=duration/);
    await expect(page).toHaveURL(/dir=desc/);

    // Duration-desc of [5, 8, 3] is [8, 5, 3] -- Clip B, Clip A, Clip C --
    // which matches neither insertion order [A, B, C] nor its reverse
    // [C, B, A].
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Clip B", "Clip A", nameC]);
  });

  await test.step("load more appends without re-fetching earlier pages", async () => {
    await page.goto("/history?limit=2");

    // Newest first (the default sort): Clip C, then Clip B; Clip A is on
    // page two.
    await expect(page.getByRole("region", { name: nameC })).toBeVisible();
    await expect(page.getByRole("region", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Clip A" })).toHaveCount(0);

    const loadMore = page.getByRole("button", { name: "Load more" });
    await expect(loadMore).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/history") && res.url().includes("cursor="),
      ),
      loadMore.click(),
    ]);
    expect(response.status()).toBe(200);
    // A load-more request always carries the cursor of the last row already
    // on screen -- proving this fetched page two, not page one over again.
    expect(new URL(response.url()).searchParams.get("cursor")).toBeTruthy();

    // The two rows from page one are still there, and the third has been
    // appended, not swapped in by a fresh fetch from the start.
    await expect(page.getByRole("region", { name: nameC })).toBeVisible();
    await expect(page.getByRole("region", { name: "Clip B" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Clip A" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(3);
  });

  await test.step("filtering down to no matches leaves the row's geometry alone", async () => {
    const before = await filterRowGeometry();
    expect(before.overflows).toBe(true);

    // "Taking longer" matches none of the three seeded jobs.
    await page.goto("/history?statusBucket=taking-longer");
    await expect(page.getByRole("region", { name: "Clip A" })).toHaveCount(0);

    const empty = await filterRowGeometry();
    expect(empty.overflows).toBe(false);

    // The Sort control used to be unmounted outright when nothing matched --
    // the largest of the jumps, and a dead end, since the control you would
    // use to re-slice the list was the one that disappeared.
    expect(empty.labels).toEqual(before.labels);
    expect(empty.labels).toContain("Sort");
    expect(empty.boxes).toEqual(before.boxes);

    // The page went from overflowing to not, which is what used to take the
    // scrollbar away and shift every centred container -- the header
    // included -- by the scrollbar's width.
    expect(empty.scrollbarGutter).toBe("stable");
  });
});

// IR-007. Costs nothing against the rate-limit tally above: it seeds nothing
// and never calls /api/upload or /api/transform. The filter controls render
// whether or not the list has rows, which is all this needs.
test("every filter dropdown opens anchored to its own trigger", async ({ page }) => {
  await page.goto("/history");

  for (const name of ["Status", "Style"]) {
    // Scope to the visible one: FilterBar also renders a phone-only copy
    // behind `md:hidden`, whose trigger exists in the DOM at every viewport.
    const trigger = page.getByRole("combobox", { name }).and(page.locator(":visible"));
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    if (!triggerBox) throw new Error(`${name} trigger has no box`);

    await trigger.click();
    const popup = page.locator("[data-slot=select-content]").first();
    await expect(popup).toBeVisible();
    const popupBox = await popup.boundingBox();
    if (!popupBox) throw new Error(`${name} popup has no box`);

    // Radix's "item-aligned" default placed these relative to the selected
    // ITEM, not the trigger, and on this page that collapsed to the literal
    // top-left corner of the viewport: popup (0,0) against a trigger at
    // (144,237). Anchored, the popup opens just below its own trigger and
    // overlaps it horizontally.
    expect(popupBox.y).toBeGreaterThan(triggerBox.y);
    expect(popupBox.x).toBeGreaterThan(triggerBox.x - popupBox.width);
    expect(popupBox.x).toBeLessThan(triggerBox.x + triggerBox.width);

    // item-aligned also ignored --radix-select-content-available-height, so
    // the 75-entry Style list rendered 2128px tall against a 720px viewport
    // instead of scrolling.
    const viewport = page.viewportSize();
    if (viewport) expect(popupBox.height).toBeLessThanOrEqual(viewport.height);

    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
  }
});
