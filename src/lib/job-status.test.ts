import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "./error-codes";
import { JOB_ERROR_CODES } from "./job-status";

describe("job outcome codes", () => {
  it("names the four outcomes the status table uses", () => {
    expect([...JOB_ERROR_CODES]).toEqual([
      "MAGIC_HOUR_JOB_FAILED",
      "MAGIC_HOUR_JOB_CANCELED",
      "JOB_ABANDONED",
      "SUBMISSION_UNCONFIRMED",
    ]);
  });

  it("keeps job outcomes out of the HTTP error table", () => {
    // They label a stored record and are never an HTTP response, so they must not
    // appear in a table whose every entry carries a status and a retryability.
    for (const code of JOB_ERROR_CODES) {
      expect(ERROR_CODES as readonly string[]).not.toContain(code);
    }
  });
});
