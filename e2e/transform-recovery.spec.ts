import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_WEBHOOK_SECRET } from "./env";
import {
  FAKE_JOB_NAME_TRIGGERS,
  FAKE_UUID_PREFIXES,
  fakeJobName,
  fakeMagicHourId,
  fakeUuid,
  signWebhook,
} from "./helpers";

// Deliberately API-only: these recovery branches have no UI affordance and no viewport dependence,
// so running on one project keeps them off the shared per-IP rate-limit window.

const MAX_CLIP_SECONDS = 30;

type Job = {
  id: string;
  status: string;
  phase: string;
  output?: { cloudinaryUrl: string };
  errorCode?: string;
};

async function createSource(
  request: APIRequestContext,
  uuid = fakeUuid(),
): Promise<{ sourceId: string; duration: number }> {
  const response = await request.post("/api/upload", {
    data: { cdnUrl: `https://ucarecdn.com/${uuid}/` },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { sourceId: body.sourceId, duration: body.sourceVideo.duration };
}

async function postTransform(
  request: APIRequestContext,
  sourceId: string,
  name: string,
  endSeconds = 5,
) {
  return request.post("/api/transform", {
    data: {
      sourceId,
      idempotencyKey: randomUUID(),
      params: {
        name,
        startSeconds: 0,
        endSeconds,
        fpsResolution: "HALF",
        artStyle: "Watercolor",
        promptType: "default",
        model: "default",
        version: "default",
      },
    },
  });
}

async function startJob(request: APIRequestContext, sourceId: string, name: string): Promise<Job> {
  const response = await postTransform(request, sourceId, name);
  expect(response.status()).toBe(202);
  return (await response.json()).job;
}

// Takes the already-serialized body, never an object to re-serialize: the signature is over these
// exact bytes.
async function deliver(request: APIRequestContext, payload: Record<string, unknown>) {
  const rawBody = JSON.stringify({ type: "video.completed", payload });
  const { signature, timestamp } = signWebhook(rawBody, E2E_WEBHOOK_SECRET);
  return request.post("/api/webhook", {
    data: rawBody,
    headers: {
      "content-type": "application/json",
      "magic-hour-event-signature": signature,
      "magic-hour-event-timestamp": timestamp,
    },
  });
}

async function readJob(request: APIRequestContext, jobId: string): Promise<Job> {
  const response = await request.get("/api/history");
  expect(response.status()).toBe(200);
  const { items } = await response.json();
  const job = items.find((item: Job) => item.id === jobId);
  expect(job, `job ${jobId} missing from history`).toBeTruthy();
  return job;
}

test.describe("finalize storage failures", () => {
  test("a retryable Cloudinary failure answers 500, keeps the job recoverable, and a redelivery completes it", async ({
    request,
  }) => {
    const { sourceId } = await createSource(request);
    const job = await startJob(request, sourceId, `clip ${FAKE_JOB_NAME_TRIGGERS.copyFailsOnce}`);
    const magicHourId = fakeMagicHourId(job.id, FAKE_UUID_PREFIXES.failsOnce);

    // The copy fails retryably, so the claim must be released and the 500 is what invites Magic
    // Hour to redeliver.
    const first = await deliver(request, { id: magicHourId });
    expect(first.status()).toBe(500);
    expect(await first.json()).toEqual({ status: "transient" });

    const afterFailure = await readJob(request, job.id);
    expect(afterFailure.status).toBe("processing");
    expect(afterFailure.output).toBeUndefined();
    expect(afterFailure.errorCode).toBeUndefined();

    // A background reconciliation pass could also finalize this job, and the single-claim guarantee
    // means only one path performs the copy -- so this pins that the job recovers, not which path
    // did it.
    const second = await deliver(request, { id: magicHourId });
    expect(second.status()).toBe(200);

    const completed = await readJob(request, job.id);
    expect(completed.status).toBe("complete");
    expect(completed.output?.cloudinaryUrl).toContain("/video/upload/");
  });

  test("a permanent Cloudinary failure marks the job failed and stops redelivery", async ({
    request,
  }) => {
    const { sourceId } = await createSource(request);
    const job = await startJob(request, sourceId, `clip ${FAKE_JOB_NAME_TRIGGERS.copyUnreadable}`);
    const magicHourId = fakeMagicHourId(job.id, FAKE_UUID_PREFIXES.unreadable);

    const response = await deliver(request, { id: magicHourId });
    // 200, not 500: the failure is terminal, so asking for a redelivery would only repeat it.
    expect(response.status()).toBe(200);

    const failed = await readJob(request, job.id);
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("CLOUDINARY_UPLOAD_FAILED");
    expect(failed.output).toBeUndefined();

    expect((await deliver(request, { id: magicHourId })).status()).toBe(200);
  });
});

test.describe("lost provider id recovery", () => {
  test("a job whose create answer was lost is recovered by the v2v:<jobId> name and completes", async ({
    request,
  }) => {
    const { sourceId } = await createSource(request);
    const name = `clip ${FAKE_JOB_NAME_TRIGGERS.createUncertain}`;
    // An *uncertain* create failure leaves the job alive with no magicHourId -- the only state the
    // name fallback can recover from.
    const job = await startJob(request, sourceId, name);
    expect(job.status).toBe("processing");
    expect(job.phase).toBe("submitting");

    // The provider's own id, which this job has never seen, so findByMagicHourId must miss and the
    // name must be the only way back.
    const magicHourId = `mh-live-${randomUUID()}`;
    const response = await deliver(request, { id: magicHourId, name: fakeJobName(job.id, name) });
    expect(response.status()).toBe(200);

    const completed = await readJob(request, job.id);
    expect(completed.status).toBe("complete");
    expect(completed.output?.cloudinaryUrl).toContain("/video/upload/");
  });

  test("two concurrent deliveries for a lost provider id attach once and finalize once", async ({
    request,
  }) => {
    const { sourceId } = await createSource(request);
    const name = `clip ${FAKE_JOB_NAME_TRIGGERS.createUncertain}`;
    const job = await startJob(request, sourceId, name);
    const payload = { id: `mh-live-${randomUUID()}`, name: fakeJobName(job.id, name) };

    const [a, b] = await Promise.all([deliver(request, payload), deliver(request, payload)]);

    // Whichever delivery loses the attach or the claim answers 409; neither may fail outright, and
    // neither may 500.
    for (const status of [a.status(), b.status()]) {
      expect([200, 409]).toContain(status);
    }
    expect([a.status(), b.status()]).toContain(200);

    // The assertion that matters: two 200s over a job nothing matched would look identical to
    // success without this.
    const completed = await readJob(request, job.id);
    expect(completed.status).toBe("complete");
    expect(completed.output?.cloudinaryUrl).toContain("/video/upload/");
  });
});

test("MAX_CLIP_SECONDS binds on a source longer than the cap", async ({ request }) => {
  const { sourceId, duration } = await createSource(
    request,
    fakeUuid(FAKE_UUID_PREFIXES.longSource),
  );
  // The cap is only reachable when the source outlives it; on the default fake source the duration
  // check always binds first.
  expect(duration).toBeGreaterThan(MAX_CLIP_SECONDS);

  const tooLong = await postTransform(request, sourceId, "long clip", MAX_CLIP_SECONDS + 1);
  expect(tooLong.status()).toBe(400);
  expect((await tooLong.json()).error.code).toBe("CLIP_TOO_LONG");

  const atCap = await postTransform(request, sourceId, "long clip", MAX_CLIP_SECONDS);
  expect(atCap.status()).toBe(202);
});
