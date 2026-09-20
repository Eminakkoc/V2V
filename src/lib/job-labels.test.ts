import { describe, expect, it } from "vitest";
import { labelFor } from "./job-labels";
import { JOB_PHASES, JOB_STATUSES } from "./job-status";

describe("labelFor", () => {
  it("labels a queued job", () => {
    expect(labelFor({ status: "processing", phase: "queued" })).toEqual({
      label: "Queued",
      tone: "pending",
    });
  });

  it("labels a job being confirmed with Magic Hour", () => {
    expect(labelFor({ status: "processing", phase: "submitting" })).toEqual({
      label: "Confirming with Magic Hour",
      tone: "pending",
    });
  });

  it("labels a rendering job", () => {
    expect(labelFor({ status: "processing", phase: "rendering" })).toEqual({
      label: "Rendering",
      tone: "active",
    });
  });

  it("labels a finalizing job regardless of phase", () => {
    expect(labelFor({ status: "finalizing", phase: "queued" })).toEqual({
      label: "Saving result",
      tone: "active",
    });
  });

  it("labels a complete job", () => {
    expect(labelFor({ status: "complete", phase: "rendering" })).toEqual({
      label: "Complete",
      tone: "done",
    });
  });

  it("labels a Magic Hour job failure with the error message", () => {
    expect(
      labelFor({
        status: "failed",
        phase: "rendering",
        errorCode: "MAGIC_HOUR_JOB_FAILED",
        errorMessage: "Out of credits",
      }),
    ).toEqual({ label: "Failed: Out of credits", tone: "error" });
  });

  it("labels a job cancelled in Magic Hour", () => {
    expect(
      labelFor({ status: "failed", phase: "rendering", errorCode: "MAGIC_HOUR_JOB_CANCELED" }),
    ).toEqual({ label: "Cancelled in Magic Hour", tone: "error" });
  });

  it("labels a timed-out job", () => {
    expect(labelFor({ status: "timed_out", phase: "rendering" })).toEqual({
      label: "Taking longer than expected. Still checking",
      tone: "pending",
    });
  });

  it("hides a superseded job's label from the main status display", () => {
    expect(labelFor({ status: "superseded", phase: "rendering" })).toEqual({
      label: "Superseded",
      tone: "pending",
      hidden: true,
    });
  });

  it("labels an abandoned job that stopped being polled", () => {
    expect(
      labelFor({ status: "abandoned", phase: "rendering", errorCode: "JOB_ABANDONED" }),
    ).toEqual({
      label: "Stopped checking. Still added if Magic Hour finishes it",
      tone: "error",
    });
  });

  it("labels an abandoned job that never confirmed submission", () => {
    expect(
      labelFor({ status: "abandoned", phase: "rendering", errorCode: "SUBMISSION_UNCONFIRMED" }),
    ).toEqual({
      label: "Lost contact with Magic Hour. Still added if it finishes",
      tone: "error",
    });
  });

  it("has a label for every status and phase combination that can occur", () => {
    for (const status of JOB_STATUSES) {
      for (const phase of JOB_PHASES) {
        expect(() => labelFor({ status, phase })).not.toThrow();
        expect(labelFor({ status, phase }).label.length).toBeGreaterThan(0);
      }
    }
  });
});
