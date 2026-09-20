// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type * as NextServerModule from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { HistoryView } from "@/components/history/history-view";
import { transformParamsSchema } from "@/lib/transform-contract";
import { buildServerDeps, setServerDepsForTests } from "@/server/deps";
import type { MagicHourAdapter, Providers } from "@/server/providers/types";
import { createJobsRepository, type NewJob } from "@/server/repositories/jobs";
import { createSourcesRepository } from "@/server/repositories/sources";
import { signIdentity } from "@/server/services/identity";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import HistoryPage from "./page";

// Direct-invocation tests never enter Next's own request pipeline, so
// after() throws unless it is replaced with a capture (see
// src/app/api/history/route.test.ts, which this mirrors), and cookies()
// throws for the same reason unless it is replaced with a stub that reads
// from a value this file controls.
const scheduled = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof NextServerModule>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      scheduled.push(fn);
    },
  };
});

const cookieRef = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  // "v2v_uid" mirrors IDENTITY_COOKIE (src/server/services/identity.ts);
  // hardcoded so this mock has no import-order dependency on that module.
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "v2v_uid" && cookieRef.value !== undefined
          ? { name, value: cookieRef.value }
          : undefined,
    }),
}));

// HistoryView mounts useHistoryRefresh, which fires a fetch on mount. Left
// hanging so it can never resolve mid-test and race an assertion -- these
// tests only care about what the server put in the HTML.
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  apiFetch: vi.fn(() => new Promise(() => {})),
}));

// HistoryTabs and FilterBar call useRouter()/useSearchParams(); there is no
// mounted Next app router in this direct-render test, so both are stubbed
// exactly as history-tabs.test.tsx and filter-bar.test.tsx already do.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { getDb } = setupTestDb();
const userId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const otherUserId = "9c1d2e3a-4b5c-4d6e-8f70-112233445566";

const unusedUploadcare = { getFileInfo: () => Promise.reject(new Error("unused")) };
const unusedCloudinary = { copyVideoFromUrl: () => Promise.reject(new Error("unused")) };
const unusedMagicHour: MagicHourAdapter = {
  createJob: () => Promise.reject(new Error("unused")),
  getJobDetails: () => Promise.reject(new Error("unused")),
  verifyWebhook: () => {
    throw new Error("unused");
  },
};

function useDeps() {
  const providers: Providers = {
    uploadcare: unusedUploadcare,
    cloudinary: unusedCloudinary,
    magicHour: unusedMagicHour,
  };
  setServerDepsForTests(buildServerDeps(testConfig, { getDb, providers }));
}

const baseParams = transformParamsSchema.parse({
  name: "beach clip",
  startSeconds: 0,
  endSeconds: 5,
  artStyle: "Watercolor",
});

async function insertJob(uid: string, overrides: Partial<NewJob> = {}) {
  const db = await getDb();
  const jobs = createJobsRepository(() => Promise.resolve(db));
  return jobs.insert(uid, {
    sourceId: randomUUID(),
    params: { ...baseParams },
    idempotencyKey: randomUUID(),
    status: "processing",
    phase: "queued",
    deadlineAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  });
}

function setCookie(uid: string, issuedAtSecondsAgo = 0) {
  const issuedAt = Math.floor(Date.now() / 1000) - issuedAtSecondsAgo;
  cookieRef.value = signIdentity(uid, issuedAt, testConfig.sessionCookieSecret);
}

function noCookie() {
  cookieRef.value = undefined;
}

function searchParams(
  raw: Record<string, string> = {},
): Promise<Record<string, string | string[] | undefined>> {
  return Promise.resolve(raw);
}

// Drills into the page's returned tree for the actual key React would use
// to decide whether to remount <HistoryView>. Reading `.key` directly off
// the child element (not via React.Children, which rewrites explicit keys
// with a positional prefix) so this is the literal value page.tsx computed.
function historyViewKey(element: ReactElement): unknown {
  const children = (element.props as { children: ReactNode }).children;
  const list = Array.isArray(children) ? children : [children];
  const historyView = list.find(
    (child): child is ReactElement => isValidElement(child) && child.type === HistoryView,
  );
  if (!historyView) throw new Error("HistoryPage's tree has no <HistoryView> child");
  return historyView.key;
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("jobs").deleteMany({});
  await db.collection("sources").deleteMany({});
  useDeps();
  scheduled.length = 0;
  noCookie();
});
afterEach(() => setServerDepsForTests(undefined));

describe("HistoryPage", () => {
  it("server-renders the caller's own jobs with no client fetch, and never another user's", async () => {
    await insertJob(userId, { params: { ...baseParams, name: "Mine" } });
    await insertJob(otherUserId, { params: { ...baseParams, name: "Not mine" } });
    setCookie(userId);

    const element = await HistoryPage({ searchParams: searchParams() });
    render(element);

    // apiFetch never resolves (mocked to hang), so this text can only have
    // come from the server-rendered first page.
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Not mine")).not.toBeInTheDocument();
  });

  it("renders <h1>History</h1> for a visitor with no cookie, showing the empty state rather than an error", async () => {
    const element = await HistoryPage({ searchParams: searchParams() });
    render(element);

    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No transformations yet" })).toBeInTheDocument();
  });

  it("renders <h1>History</h1> for a signed-in caller with an empty history too", async () => {
    setCookie(userId);
    const element = await HistoryPage({ searchParams: searchParams() });
    render(element);

    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
  });

  it("renders <h1>History</h1> on the Uploads tab's empty state too", async () => {
    const element = await HistoryPage({ searchParams: searchParams({ tab: "sources" }) });
    render(element);

    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No uploads yet" })).toBeInTheDocument();
  });

  it("uses verifyIdentity, not hasFreshIdentity: a cookie past the 30-day renewal window still shows its owner's history", async () => {
    await insertJob(userId, { params: { ...baseParams, name: "Old cookie, still mine" } });
    // 40 days old -- past RENEW_AFTER_SECONDS (30 days), but still a validly
    // signed cookie. hasFreshIdentity would call this stale; verifyIdentity
    // (what the page must use) still resolves it to the same user.
    setCookie(userId, 40 * 24 * 60 * 60);

    const element = await HistoryPage({ searchParams: searchParams() });
    render(element);

    expect(screen.getByText("Old cookie, still mine")).toBeInTheDocument();
  });

  it("schedules exactly one reconciliation pass for a signed-in caller, without running it", async () => {
    await insertJob(userId);
    setCookie(userId);

    await HistoryPage({ searchParams: searchParams() });

    expect(scheduled).toHaveLength(1);
  });

  it("schedules no reconciliation pass for a visitor with no cookie", async () => {
    await HistoryPage({ searchParams: searchParams() });

    expect(scheduled).toHaveLength(0);
  });

  it("offers 'Transform an upload' instead of 'Upload your first video' once the caller has an upload but no transformations", async () => {
    const db = await getDb();
    const sources = createSourcesRepository(() => Promise.resolve(db));
    await sources.insert(userId, {
      uploadcareUuid: randomUUID(),
      uploadcareCdnUrl: "https://ucarecdn.com/placeholder/",
      cloudinaryPublicId: "sources/abc",
      cloudinaryUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mov",
      format: "mov",
      bytes: 1000,
      duration: 12.5,
      width: 1080,
      height: 1920,
    });
    setCookie(userId);

    const element = await HistoryPage({ searchParams: searchParams() });
    render(element);

    expect(screen.getByRole("link", { name: "Transform an upload" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Upload your first video" })).not.toBeInTheDocument();
  });
});

describe("HistoryPage -- keys the client shell on the serialized search params", () => {
  it("computes the same key for two navigations with the same search params", async () => {
    setCookie(userId);
    const first = await HistoryPage({ searchParams: searchParams({ statusBucket: "complete" }) });
    const second = await HistoryPage({ searchParams: searchParams({ statusBucket: "complete" }) });

    expect(historyViewKey(first)).toBe(historyViewKey(second));
  });

  // dir and includePrevious are the two shaping params most likely to be
  // dropped by a well-meaning tidy-up (e.g. narrowing the key to
  // `query.tab`, which reads plausible on its own and would still pass
  // every other page test -- see the mutation check in the task report).
  it.each([
    ["dir", { dir: "asc" }],
    ["includePrevious", { includePrevious: "true" }],
    ["sort", { sort: "duration" }],
    ["statusBucket", { statusBucket: "complete" }],
    ["style", { style: "Watercolor" }],
    ["tab", { tab: "sources" }],
  ] as const)("computes a different key when %s changes", async (_name, changed) => {
    setCookie(userId);
    const base = await HistoryPage({ searchParams: searchParams({}) });
    const withChange = await HistoryPage({ searchParams: searchParams(changed) });

    expect(historyViewKey(withChange)).not.toBe(historyViewKey(base));
  });
});
