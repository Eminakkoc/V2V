import { describe, expect, it } from "vitest";
import { webhookEventSchema } from "@/server/services/webhook-event";
import { testConfig } from "@/test/env";
import createResponseFixture from "./__fixtures__/magic-hour/create-response.json";
import eventCompletedFixture from "./__fixtures__/magic-hour/event-video-completed.json";
import eventErroredFixture from "./__fixtures__/magic-hour/event-video-errored.json";
import eventStartedFixture from "./__fixtures__/magic-hour/event-video-started.json";
import getDetailsCompleteFixture from "./__fixtures__/magic-hour/get-details-complete.json";
import { createMagicHourAdapter } from "./magic-hour";
import type { CreateJobInput } from "./types";

const createInput: CreateJobInput = {
  jobId: "507f1f77bcf86cd799439011",
  videoUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mp4",
  params: {
    name: "real-transform smoke test",
    startSeconds: 0,
    endSeconds: 8,
    fpsResolution: "HALF",
    artStyle: "Cyberpunk",
    promptType: "default",
    model: "default",
    version: "default",
  },
};

const eventFixtures = {
  started: eventStartedFixture,
  completed: eventCompletedFixture,
  errored: eventErroredFixture,
};

// Skipped until DEP-003 runs: these fixtures are shaped from the SDK's type
// declarations, not recorded from a real Magic Hour response. Passing against
// invented shapes would assert nothing. The operator replaces the JSON with real
// payloads and removes the .skip — see docs/superpowers/plans/ Task 14.
describe("magic hour fixture conformance", () => {
  it.skip("parses the recorded real create response", async () => {
    const adapter = createMagicHourAdapter(testConfig.magicHour, {
      create: async () => createResponseFixture,
    });
    const result = await adapter.createJob(createInput);
    expect(result).toEqual({ magicHourId: createResponseFixture.id });
  });

  it.skip("parses the recorded real completed details", async () => {
    const adapter = createMagicHourAdapter(testConfig.magicHour, {
      get: async () => getDetailsCompleteFixture,
    });
    const details = await adapter.getJobDetails(getDetailsCompleteFixture.id);
    expect(details.status).toBe("complete");
    expect(details.creditsCharged).toBe(getDetailsCompleteFixture.creditsCharged);
    expect(details.downloads).toEqual(getDetailsCompleteFixture.downloads);
  });

  it.skip.each(["started", "completed", "errored"] as const)(
    "parses the recorded real video.%s event",
    (kind) => {
      const parsed = webhookEventSchema.parse(eventFixtures[kind]);
      expect(parsed.type).toBe(`video.${kind}`);
      expect(parsed.payload.id).toBe(getDetailsCompleteFixture.id);
    },
  );
});
