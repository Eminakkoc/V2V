// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateFlowSettings } from "@/components/create/create-flow";
import { posterUrl } from "@/lib/cloudinary-urls";
import type { UploadResponse } from "@/lib/upload-contract";
import { buildServerDeps, setServerDepsForTests } from "@/server/deps";
import type { MagicHourAdapter, Providers } from "@/server/providers/types";
import { createSourcesRepository } from "@/server/repositories/sources";
import { signIdentity } from "@/server/services/identity";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import CreatePage from "./page";

// Direct-invocation test: cookies() throws outside Next's own request pipeline unless stubbed with
// a value this file controls.
const cookieRef = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "v2v_uid" && cookieRef.value !== undefined
          ? { name, value: cookieRef.value }
          : undefined,
    }),
}));

// CreateFlow pulls in the real Uploadcare widget, so the child is stubbed to capture exactly what
// page.tsx handed it.
const captured = vi.hoisted(() => ({
  props: undefined as
    { settings: CreateFlowSettings; initialSource?: UploadResponse | null } | undefined,
}));
vi.mock("@/components/create/create-flow", () => ({
  CreateFlow: (props: { settings: CreateFlowSettings; initialSource?: UploadResponse | null }) => {
    captured.props = props;
    return null;
  },
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

async function insertSource(uid: string) {
  const db = await getDb();
  const sources = createSourcesRepository(() => Promise.resolve(db));
  return sources.insert(uid, {
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
}

function setCookie(uid: string) {
  cookieRef.value = signIdentity(
    uid,
    Math.floor(Date.now() / 1000),
    testConfig.sessionCookieSecret,
  );
}

function noCookie() {
  cookieRef.value = undefined;
}

function searchParams(
  raw: Record<string, string> = {},
): Promise<Record<string, string | string[] | undefined>> {
  return Promise.resolve(raw);
}

async function renderWithSourceId(sourceId?: string) {
  const element = await CreatePage({
    searchParams: searchParams(sourceId === undefined ? {} : { sourceId }),
  });
  render(element);
  return captured.props?.initialSource;
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("sources").deleteMany({});
  useDeps();
  captured.props = undefined;
  noCookie();
});
afterEach(() => setServerDepsForTests(undefined));

describe("CreatePage", () => {
  it("preloads a valid, owned source and hands CreateFlow the same uploaded shape /api/upload would have, skipping the upload step", async () => {
    const source = await insertSource(userId);
    setCookie(userId);

    const initialSource = await renderWithSourceId(source.id);

    expect(initialSource).toEqual({
      sourceId: source.id,
      sourceVideo: {
        cloudinaryPublicId: source.cloudinaryPublicId,
        cloudinaryUrl: source.cloudinaryUrl,
        format: source.format,
        bytes: source.bytes,
        duration: source.duration,
        width: source.width,
        height: source.height,
      },
      posterUrl: posterUrl(testConfig.cloudinary.cloudName, source.cloudinaryPublicId),
    } satisfies UploadResponse);
  });

  // All four cases must be indistinguishable: swapping the owner-scoped findById for an unscoped
  // one would resolve another user's id while the rest stay null, and fail this equality.
  it("falls back to the same empty-upload state (no initial source, no error) whether the id is absent, malformed, unknown, or someone else's", async () => {
    const othersSource = await insertSource(otherUserId);
    setCookie(userId);

    const withNoId = await renderWithSourceId(undefined);
    const withMalformedId = await renderWithSourceId("not-an-object-id");
    const withUnknownId = await renderWithSourceId(new ObjectId().toHexString());
    const withAnotherUsersId = await renderWithSourceId(othersSource.id);

    expect(withNoId).toBeFalsy();
    expect(withMalformedId).toEqual(withNoId);
    expect(withUnknownId).toEqual(withNoId);
    expect(withAnotherUsersId).toEqual(withNoId);
  });

  it("falls back to the empty upload state for a visitor with no identity cookie, even for an id they'd otherwise own", async () => {
    const source = await insertSource(userId);
    noCookie();

    const initialSource = await renderWithSourceId(source.id);

    expect(initialSource).toBeFalsy();
  });

  it("hands CreateFlow no initial source when the URL carries no sourceId", async () => {
    const element = await CreatePage({ searchParams: searchParams({}) });
    render(element);

    expect(captured.props).toBeTruthy();
    expect(captured.props?.initialSource).toBeFalsy();
  });
});
