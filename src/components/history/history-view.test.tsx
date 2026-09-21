// @vitest-environment jsdom
import {
  act,
  render as baseRender,
  screen,
  waitFor,
  within,
  type RenderOptions,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import type {
  HistoryJobsResponse,
  HistoryJobView,
  HistoryQueryInput,
  HistorySourcesResponse,
  SourceView,
} from "@/lib/history-contract";
import { JobPollingProvider } from "@/components/job/job-polling-provider";
import { transformParamsSchema } from "@/lib/transform-contract";
import { HistoryView } from "./history-view";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const searchParamsValue = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParamsValue.current,
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

const baseParams = transformParamsSchema.parse({
  name: "clip",
  startSeconds: 0,
  endSeconds: 5,
  artStyle: "Watercolor",
});

// The view reads the shared poll rather than fetching, so every case runs inside the provider that
// owns it.
function wrapper({ children }: { children: React.ReactNode }) {
  return <JobPollingProvider>{children}</JobPollingProvider>;
}

function render(ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return baseRender(ui, { ...options, wrapper });
}

let autoId = 0;

function buildJob(name: string, overrides: Partial<HistoryJobView> = {}): HistoryJobView {
  autoId += 1;
  return {
    id: `job-${autoId}`,
    sourceId: `source-${autoId}`,
    status: "complete",
    phase: "rendering",
    params: { ...baseParams, name },
    createdAt: "2026-01-01T00:00:00.000Z",
    deadlineAt: "2026-01-01T01:00:00.000Z",
    source: null,
    attempts: [],
    ...overrides,
  };
}

let sourceAutoId = 0;

function buildSource(overrides: Partial<SourceView> = {}): SourceView {
  sourceAutoId += 1;
  return {
    id: `source-${sourceAutoId}`,
    cloudinaryPublicId: `sources/${sourceAutoId}`,
    cloudinaryUrl: `https://res.cloudinary.com/demo/video/upload/v1/sources/${sourceAutoId}.mp4`,
    format: "video/mp4",
    duration: 10,
    width: 1080,
    height: 1920,
    bytes: 1_000_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    transformCount: 0,
    ...overrides,
  };
}

function buildQuery(overrides: Partial<HistoryQueryInput> = {}): HistoryQueryInput {
  return {
    tab: "jobs",
    includePrevious: false,
    sort: "createdAt",
    dir: "desc",
    limit: 20,
    changeable: false,
    ...overrides,
  };
}

function jobsResponse(
  items: HistoryJobView[],
  nextCursor: string | null = null,
): HistoryJobsResponse {
  return {
    items,
    nextCursor,
    active: { processing: 0, finalizing: 0, timedOut: 0, superseded: 0 },
  };
}

function sourcesResponse(
  items: SourceView[],
  nextCursor: string | null = null,
): HistorySourcesResponse {
  return { items, nextCursor };
}

// Every mount fires useHistoryRefresh's own on-mount tick; left never-resolving by default so it
// can never race a test's assertions or its load-more mock.
function hangingFetch() {
  fetchMock.mockImplementation(() => new Promise(() => {}));
}

beforeEach(() => {
  searchParamsValue.current = new URLSearchParams();
  hangingFetch();
});

describe("HistoryView -- the first page arrives server-rendered", () => {
  it("shows the server-provided job synchronously, before the mount poll can ever resolve", () => {
    // The changeable poll never resolves, so text present the instant render() returns cannot have
    // depended on it settling.
    render(
      <HistoryView
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([buildJob("Server rendered job")])}
        hasUploads={false}
        cloudName="demo"
      />,
    );

    expect(screen.getByText("Server rendered job")).toBeInTheDocument();
    // Skeletons are for a client-side load only, never the first paint.
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument();
  });

  it("shows the server-provided source synchronously on the Uploads tab", () => {
    render(
      <HistoryView
        tab="sources"
        query={buildQuery({ tab: "sources" })}
        initial={sourcesResponse([buildSource({ transformCount: 3 })])}
        cloudName="demo"
      />,
    );

    expect(screen.getByText("3 transformations")).toBeInTheDocument();
  });
});

describe("HistoryView -- load more (jobs)", () => {
  it("appends the next page using the shipped cursor, and requests it with the current filters", async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.includes("changeable=true")) return new Promise(() => {});
      expect(path).toContain("cursor=page-2-cursor");
      expect(path).toContain("statusBucket=complete");
      return Promise.resolve(jobsResponse([buildJob("Second page job")], null));
    });

    render(
      <HistoryView
        tab="jobs"
        query={buildQuery({ statusBucket: "complete" })}
        initial={jobsResponse([buildJob("First page job")], "page-2-cursor")}
        hasUploads={false}
        cloudName="demo"
      />,
    );

    expect(screen.getByText("First page job")).toBeInTheDocument();
    const loadMore = screen.getByRole("button", { name: "Load more" });
    await act(async () => {
      loadMore.click();
    });

    await waitFor(() => expect(screen.getByText("Second page job")).toBeInTheDocument());
    expect(screen.getByText("First page job")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows the aria-hidden skeleton and aria-busy list only while a load-more request is in flight", async () => {
    let resolvePage: (value: HistoryJobsResponse) => void = () => {};
    fetchMock.mockImplementation((path: string) => {
      if (path.includes("changeable=true")) return new Promise(() => {});
      return new Promise<HistoryJobsResponse>((resolve) => {
        resolvePage = resolve;
      });
    });

    render(
      <HistoryView
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([buildJob("First page job")], "cursor-1")}
        hasUploads={false}
        cloudName="demo"
      />,
    );

    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("aria-busy", "false");

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });

    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="skeleton"]')?.closest("[aria-hidden]"),
    ).not.toBeNull();
    expect(screen.getByText("Loading history")).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      resolvePage(jobsResponse([buildJob("Second page job")], null));
    });

    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false");
  });
});

// A tick can chain a changeable poll into an `ids` follow-up, so settling it needs more than one
// hop.
async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

describe("HistoryView -- a load-more row still receives live refresh (Finding 1 regression)", () => {
  it("updates a load-more row's status once the changeable poll reports it, while further pages remain exhausted", async () => {
    vi.useFakeTimers();
    try {
      const firstPageJob = buildJob("First page job", { status: "processing" });
      const loadedOlder = buildJob("Loaded via load more", {
        status: "timed_out",
        createdAt: "2025-01-01T00:00:00.000Z",
      });
      const loadedOlderComplete: HistoryJobView = { ...loadedOlder, status: "complete" };

      fetchMock.mockImplementation((path: string) => {
        if (path.includes("changeable=true")) return Promise.resolve(jobsResponse([firstPageJob]));
        return new Promise(() => {});
      });

      render(
        <HistoryView
          tab="jobs"
          query={buildQuery()}
          initial={jobsResponse([firstPageJob], "cursor-1")}
          hasUploads={false}
          cloudName="demo"
        />,
      );
      await flushMicrotasks();

      fetchMock.mockImplementation((path: string) => {
        if (path.includes("changeable=true")) return new Promise(() => {});
        return Promise.resolve(jobsResponse([loadedOlder], null));
      });
      await act(async () => {
        screen.getByRole("button", { name: "Load more" }).click();
      });
      await flushMicrotasks();

      expect(screen.getByText("Loaded via load more")).toBeInTheDocument();
      expect(screen.getByText(/Taking longer than expected/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

      // The account-wide poll no longer reports the load-more row, which is exactly what triggers
      // the one-off `ids` follow-up carrying its real status.
      fetchMock.mockImplementation((path: string) => {
        if (path.includes("changeable=true")) return Promise.resolve(jobsResponse([firstPageJob]));
        if (path.includes("ids="))
          return Promise.resolve(jobsResponse([loadedOlderComplete], null));
        return new Promise(() => {});
      });
      act(() => vi.advanceTimersByTime(3_000));
      await flushMicrotasks();

      // The load-more row never gets stuck on "Taking longer" just because it arrived after the
      // first page.
      expect(screen.queryByText(/Taking longer than expected/)).not.toBeInTheDocument();
      expect(screen.getByText("Complete")).toBeInTheDocument();
      expect(screen.getByText("Loaded via load more")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("HistoryView -- load more (sources)", () => {
  it("appends the next page of sources using the shipped cursor", async () => {
    fetchMock.mockImplementation((path: string) => {
      expect(path).toContain("tab=sources");
      expect(path).toContain("cursor=sources-cursor");
      return Promise.resolve(sourcesResponse([buildSource()], null));
    });

    render(
      <HistoryView
        tab="sources"
        query={buildQuery({ tab: "sources" })}
        initial={sourcesResponse([buildSource()], "sources-cursor")}
        cloudName="demo"
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const loadMore = screen.getByRole("button", { name: "Load more" });
    await act(async () => {
      loadMore.click();
    });

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("HistoryView -- empty states", () => {
  it("Transformations: points to Upload when there are no uploads yet", () => {
    render(
      <HistoryView
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([])}
        hasUploads={false}
        cloudName="demo"
      />,
    );
    expect(screen.getByRole("heading", { name: "No transformations yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload your first video" })).toBeInTheDocument();
  });

  it("Transformations: offers Transform an upload once uploads already exist", () => {
    render(
      <HistoryView
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([])}
        hasUploads={true}
        cloudName="demo"
      />,
    );
    expect(screen.getByRole("link", { name: "Transform an upload" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Upload your first video" })).not.toBeInTheDocument();
  });

  it("Transformations: shows No matches, not No transformations yet, once a filter is active", () => {
    render(
      <HistoryView
        tab="jobs"
        query={buildQuery({ statusBucket: "failed" })}
        initial={jobsResponse([])}
        hasUploads={false}
        cloudName="demo"
      />,
    );
    expect(screen.getByRole("heading", { name: "No matches" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "No transformations yet" }),
    ).not.toBeInTheDocument();
  });

  it("Uploads: shows No uploads yet when there are no sources", () => {
    render(
      <HistoryView
        tab="sources"
        query={buildQuery({ tab: "sources" })}
        initial={sourcesResponse([])}
        cloudName="demo"
      />,
    );
    expect(screen.getByRole("heading", { name: "No uploads yet" })).toBeInTheDocument();
  });
});

describe("HistoryView -- tab wiring", () => {
  it("selects the Transformations tab when tab='jobs'", () => {
    render(
      <HistoryView
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([buildJob("A job")])}
        hasUploads={false}
        cloudName="demo"
      />,
    );
    expect(screen.getByRole("tab", { name: "Transformations" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("selects the Uploaded videos tab when tab='sources'", () => {
    render(
      <HistoryView
        tab="sources"
        query={buildQuery({ tab: "sources" })}
        initial={sourcesResponse([buildSource()])}
        cloudName="demo"
      />,
    );
    expect(screen.getByRole("tab", { name: "Uploaded videos" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

// The page, not HistoryView, keys the shell on the serialized search params, so these tests choose
// the `key` on each render the same way page.tsx would.
describe("HistoryView -- keying the shell on the search params", () => {
  it("a changed key remounts the shell: loaded pages, the cursor and the poll all restart from the new first page", async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.includes("changeable=true")) return new Promise(() => {});
      return Promise.resolve(jobsResponse([buildJob("A, page 2")], null));
    });

    const { rerender } = render(
      <HistoryView
        key="query-a"
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([buildJob("A, page 1")], "cursor-a")}
        hasUploads={false}
        cloudName="demo"
      />,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    await waitFor(() => expect(screen.getByText("A, page 2")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

    fetchMock.mockImplementation(() => new Promise(() => {}));
    rerender(
      <HistoryView
        key="query-b"
        tab="jobs"
        query={buildQuery({ statusBucket: "complete" })}
        initial={jobsResponse([buildJob("B, page 1")], "cursor-b")}
        hasUploads={false}
        cloudName="demo"
      />,
    );

    // Both of query A's rows are gone -- the "clears the loaded pages" requirement, not merely new
    // props being rendered.
    expect(screen.queryByText("A, page 1")).not.toBeInTheDocument();
    expect(screen.queryByText("A, page 2")).not.toBeInTheDocument();
    expect(screen.getByText("B, page 1")).toBeInTheDocument();
    // The cursor restarted from query B's own first page; had the old, exhausted cursor survived,
    // this button would be missing.
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("contrast: re-rendering the SAME key keeps the loaded pages and the cursor -- the reset is the remount, not a props-watching effect", async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.includes("changeable=true")) return new Promise(() => {});
      return Promise.resolve(jobsResponse([buildJob("A, page 2")], null));
    });

    const { rerender } = render(
      <HistoryView
        key="same-key"
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([buildJob("A, page 1")], "cursor-a")}
        hasUploads={false}
        cloudName="demo"
      />,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    await waitFor(() => expect(screen.getByText("A, page 2")).toBeInTheDocument());

    rerender(
      <HistoryView
        key="same-key"
        tab="jobs"
        query={buildQuery({ statusBucket: "complete" })}
        initial={jobsResponse([buildJob("B, page 1")], "cursor-b")}
        hasUploads={false}
        cloudName="demo"
      />,
    );

    // Same key, so no remount: the load-more page and the exhausted cursor both survive, because
    // nothing here watches the props to clear them. The reset in the test above comes from the key
    // change alone -- page 1 is only ever the rows the server render last handed over.
    expect(screen.getByText("A, page 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(screen.getByText("B, page 1")).toBeInTheDocument();
  });
});

describe("HistoryView -- scoping (never another user's rows)", () => {
  it("renders only the jobs it was given -- HistoryView has no id of its own to fetch by", () => {
    render(
      <HistoryView
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([buildJob("Mine")])}
        hasUploads={false}
        cloudName="demo"
      />,
    );
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Someone else's")).not.toBeInTheDocument();
  });
});

describe("HistoryView -- previous attempts nest under their owning job", () => {
  it("renders a job's attempts inside its own PreviousAttempts disclosure", () => {
    const attempt: HistoryJobView["attempts"][number] = {
      id: "attempt-1",
      sourceId: "source-1",
      status: "failed",
      phase: "rendering",
      params: { ...baseParams, name: "Attempt one" },
      createdAt: "2025-12-31T00:00:00.000Z",
      deadlineAt: "2025-12-31T01:00:00.000Z",
    };
    render(
      <HistoryView
        tab="jobs"
        query={buildQuery()}
        initial={jobsResponse([buildJob("Latest attempt", { attempts: [attempt] })])}
        hasUploads={false}
        cloudName="demo"
      />,
    );

    expect(screen.getByText(/Previous attempts \(1\)/)).toBeInTheDocument();
    within(screen.getByRole("article", { name: /Latest attempt/ }));
  });
});
