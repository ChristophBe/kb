import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  CurationService,
  FindingKind,
  LifecycleState,
  Resolution,
} from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import curation from "./index.tsx";

const options = [
  { resolution: Resolution.KEEP, description: "Keep Policy v1 as current." },
  { resolution: Resolution.REPLACE, description: "Policy v2 replaces Policy v1." },
  { resolution: Resolution.IGNORE, description: "Dismiss this finding; nothing changes." },
];

const version = {
  id: "f1",
  kind: FindingKind.SUPERSEDED,
  documentId: "d1",
  otherDocumentId: "d2",
  summary: "Newer version of Policy v2 exists",
  documentTitle: "Policy v1",
  otherDocumentTitle: "Policy v2",
  createdAt: { seconds: 1763500000n, nanos: 0 },
  resolutions: options,
};

const reminder = {
  id: "f2",
  kind: FindingKind.REVIEW_DUE,
  documentId: "d3",
  otherDocumentId: "d3",
  summary: "Review due for Handbook",
  documentTitle: "Handbook",
  otherDocumentTitle: "Handbook",
  createdAt: { seconds: 1763500000n, nanos: 0 },
  resolutions: options.filter((o) => o.resolution !== Resolution.REPLACE),
};

/** A server that lists `open` and drops a finding once it was resolved. */
function server(open = [version, reminder]) {
  const left = [...open];
  const resolveFinding = vi.fn(({ findingId }: { findingId: string }) => {
    const i = left.findIndex((f) => f.id === findingId);
    if (i >= 0) left.splice(i, 1);
    return {};
  });
  const scoreChunks = vi.fn(() => ({
    scores: [{ documentId: "d1", score: 0.5 }],
  }));
  const listFindings = vi.fn(({ kinds }: { kinds: FindingKind[] }) => ({
    findings: left.filter((f) => kinds.length === 0 || kinds.includes(f.kind)),
    nextPageToken: "",
  }));
  const transport = createRouterTransport(({ service }) =>
    service(CurationService, { listFindings, resolveFinding, scoreChunks }),
  );
  return { transport, resolveFinding, scoreChunks, listFindings };
}

describe("Findings", () => {
  beforeAll(polyfillDialog);

  it("lists the findings with links to their documents, the score and what each answer does", async () => {
    const { transport } = server();
    const { container } = renderModule(curation, transport);
    const list = await screen.findByRole("list", { name: "Findings" });
    expect(within(list).getByText("Newer version of Policy v2 exists")).toBeTruthy();
    expect(within(list).getByText("Newer version")).toBeTruthy();
    expect(within(list).getByRole("link", { name: "Policy v1" }).getAttribute("href")).toBe(
      "/m/document/d1",
    );
    expect(within(list).getByRole("link", { name: "Policy v2" }).getAttribute("href")).toBe(
      "/m/document/d2",
    );
    // A reminder is about one document.
    expect(within(list).getAllByRole("link", { name: "Handbook" })).toHaveLength(1);
    expect(await within(list).findByText(/Relevance 50 %/)).toBeTruthy();
    const keep = within(list).getByRole("button", { name: "Keep Policy v1" });
    expect(keep.getAttribute("aria-describedby")).toBeTruthy();
    expect(within(list).getByText("Policy v2 replaces Policy v1.")).toBeTruthy();
    // A review reminder has no replace.
    expect(within(list).queryByRole("button", { name: "Replace Handbook" })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("keeps a document at once, tells so and moves the focus to the list's heading", async () => {
    const { transport, resolveFinding, scoreChunks } = server();
    renderModule(curation, transport);
    fireEvent.click(await screen.findByRole("button", { name: "Keep Policy v1" }));
    await waitFor(() =>
      expect(resolveFinding).toHaveBeenCalledWith(
        expect.objectContaining({ findingId: "f1", resolution: Resolution.KEEP }),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(screen.queryByText("Newer version of Policy v2 exists")).toBeNull());
    expect(screen.getByText("Review due for Handbook")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Findings" }));
    // The scores are asked for again, as resolving changes them.
    await waitFor(() => expect(scoreChunks.mock.calls.length).toBeGreaterThan(1));
  });

  it("asks before replacing, naming the effect, and does nothing on cancel", async () => {
    const { transport, resolveFinding } = server();
    renderModule(curation, transport);
    fireEvent.click(await screen.findByRole("button", { name: "Replace Policy v1" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace Policy v1?" });
    expect(within(dialog).getByText("Policy v2 replaces Policy v1.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(resolveFinding).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Replace Policy v1" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Replace document" }),
    );
    await waitFor(() => expect(resolveFinding).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Newer version of Policy v2 exists")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Findings" }));
  });

  it("shows an empty list as consistent documents", async () => {
    const { transport } = server([]);
    const { container } = renderModule(curation, transport);
    expect(await screen.findByText("No findings. Your documents look consistent.")).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("says so when the findings can't be loaded and loads them again on request", async () => {
    let fail = true;
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, {
        listFindings: () => {
          if (fail) throw new ConnectError("down", Code.Unavailable);
          return { findings: [], nextPageToken: "" };
        },
        scoreChunks: () => ({ scores: [] }),
      }),
    );
    renderModule(curation, transport);
    expect(
      await screen.findByText("Documents aren't available right now. Try again in a moment."),
    ).toBeTruthy();
    fail = false;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(await screen.findByText("No findings. Your documents look consistent.")).toBeTruthy();
  });

  it("shows a failed resolution at its finding and refreshes the list when it is gone", async () => {
    const left = [version];
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, {
        listFindings: () => ({ findings: left, nextPageToken: "" }),
        scoreChunks: () => ({ scores: [] }),
        resolveFinding: () => {
          left.length = 0;
          throw new ConnectError("done", Code.FailedPrecondition);
        },
      }),
    );
    renderModule(curation, transport);
    fireEvent.click(await screen.findByRole("button", { name: "Ignore Policy v1" }));
    await waitFor(() => expect(screen.queryByText("Newer version of Policy v2 exists")).toBeNull());
    expect(await screen.findByText("No findings. Your documents look consistent.")).toBeTruthy();
  });

  it("keeps a finding and says why when resolving it fails", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, {
        listFindings: () => ({ findings: [version], nextPageToken: "" }),
        scoreChunks: () => ({ scores: [] }),
        resolveFinding: () => {
          throw new ConnectError("down", Code.Unavailable);
        },
      }),
    );
    renderModule(curation, transport);
    fireEvent.click(await screen.findByRole("button", { name: "Keep Policy v1" }));
    expect(
      await screen.findByText("Documents aren't available right now. Try again in a moment."),
    ).toBeTruthy();
    expect(screen.getByText("Newer version of Policy v2 exists")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Keep Policy v1" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("loads more findings on request, and keeps looking when a page held none the user may see", async () => {
    const listFindings = vi.fn(({ pageToken }: { pageToken: string }) => {
      if (pageToken === "") return { findings: [], nextPageToken: "p2" };
      if (pageToken === "p2") return { findings: [version], nextPageToken: "p3" };
      return { findings: [reminder], nextPageToken: "" };
    });
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, { listFindings, scoreChunks: () => ({ scores: [] }) }),
    );
    renderModule(curation, transport);
    expect(await screen.findByText("Newer version of Policy v2 exists")).toBeTruthy();
    expect(screen.queryByText("No findings. Your documents look consistent.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Review due for Handbook")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("shows only the titles when the document module is off", async () => {
    const { transport } = server([version]);
    renderModule(curation, transport, "/", null, undefined, ["curation"]);
    const list = await screen.findByRole("list", { name: "Findings" });
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
    expect(within(list).getByText("Policy v1")).toBeTruthy();
  });

  it("doesn't ask again and again when the next page can't be loaded", async () => {
    const listFindings = vi.fn(({ pageToken }: { pageToken: string }) => {
      if (pageToken === "") return { findings: [], nextPageToken: "p2" };
      throw new ConnectError("down", Code.Unavailable);
    });
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, { listFindings, scoreChunks: () => ({ scores: [] }) }),
    );
    renderModule(curation, transport);
    expect(
      await screen.findByText("Documents aren't available right now. Try again in a moment."),
    ).toBeTruthy();
    const calls = listFindings.mock.calls.length;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(listFindings).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the relevance shown while it loads more findings", async () => {
    const listFindings = vi.fn(({ pageToken }: { pageToken: string }) =>
      pageToken === ""
        ? { findings: [version], nextPageToken: "p2" }
        : { findings: [reminder], nextPageToken: "" },
    );
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scoreChunks = vi.fn(async ({ documentIds }: { documentIds: string[] }) => {
      if (documentIds.length > 1) await slow;
      return { scores: [{ documentId: "d1", score: 0.5 }] };
    });
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, { listFindings, scoreChunks }),
    );
    renderModule(curation, transport);
    expect(await screen.findByText(/Relevance 50 %/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Review due for Handbook")).toBeTruthy();
    // The scores of the longer list are still on their way.
    expect(screen.getByText(/Relevance 50 %/)).toBeTruthy();
    release();
  });

  it("closes the dialog and says so when a finding to replace is already gone", async () => {
    const left = [version];
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, {
        listFindings: () => ({ findings: left, nextPageToken: "" }),
        scoreChunks: () => ({ scores: [] }),
        resolveFinding: () => {
          left.length = 0;
          throw new ConnectError("done", Code.FailedPrecondition);
        },
      }),
    );
    renderModule(curation, transport);
    fireEvent.click(await screen.findByRole("button", { name: "Replace Policy v1" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Replace document" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("No findings. Your documents look consistent.")).toBeTruthy();
  });

  it("offers only the ways to close a finding that it knows, and no empty second document", async () => {
    const odd = {
      ...version,
      otherDocumentId: "",
      resolutions: [{ resolution: Resolution.UNSPECIFIED, description: "?" }, ...options],
    };
    const { transport } = server([odd]);
    renderModule(curation, transport);
    const list = await screen.findByRole("list", { name: "Findings" });
    expect(within(list).getAllByRole("button")).toHaveLength(3);
    expect(within(list).getAllByRole("link")).toHaveLength(1);
  });

  it("closes a finding only once at a time", async () => {
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const resolveFinding = vi.fn(async () => {
      await gate;
      return {};
    });
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, {
        listFindings: () => ({ findings: [version, reminder], nextPageToken: "" }),
        scoreChunks: () => ({ scores: [] }),
        resolveFinding,
      }),
    );
    renderModule(curation, transport);
    const ignore = await screen.findByRole("button", { name: "Ignore Policy v1" });
    fireEvent.click(ignore);
    await waitFor(() => expect((ignore as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Ignore Handbook" }));
    // The other finding is not held back by the first.
    await waitFor(() => expect(resolveFinding).toHaveBeenCalledTimes(2));
    finish();
  });

  it("shows the approval state of a finding's document and narrows the list by it and by review", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, {
        listFindings: ({ kinds }) => ({
          findings: [version, reminder].filter((f) => kinds.length === 0 || kinds.includes(f.kind)),
          nextPageToken: "",
        }),
        scoreChunks: () => ({
          scores: [
            {
              documentId: "d1",
              score: 0.5,
              lifecycle: { state: LifecycleState.DEPRECATED, owner: "alice" },
            },
            {
              documentId: "d3",
              score: 0.9,
              lifecycle: { state: LifecycleState.APPROVED, owner: "alice" },
            },
          ],
        }),
      }),
    );
    renderModule(curation, transport);
    const list = await screen.findByRole("list", { name: "Findings" });
    expect(await within(list).findByText("Deprecated")).toBeTruthy();
    expect(within(list).getByText("Approved")).toBeTruthy();

    // Review due only: the reminder stays.
    fireEvent.click(screen.getByRole("checkbox", { name: "Review due only" }));
    await waitFor(() => expect(screen.queryByText("Newer version of Policy v2 exists")).toBeNull());
    expect(await screen.findByText("Review due for Handbook")).toBeTruthy();

    // And only for documents that are deprecated: nothing is left.
    fireEvent.change(screen.getByRole("combobox", { name: "Approval state" }), {
      target: { value: String(LifecycleState.DEPRECATED) },
    });
    expect(await screen.findByText("No findings match these filters.")).toBeTruthy();

    // Back to review due only, for a state with a reminder.
    fireEvent.change(screen.getByRole("combobox", { name: "Approval state" }), {
      target: { value: String(LifecycleState.APPROVED) },
    });
    expect(await screen.findByText("Review due for Handbook")).toBeTruthy();

    // Without findings due for review the page says no document needs one.
    fireEvent.change(screen.getByRole("combobox", { name: "Approval state" }), {
      target: { value: String(LifecycleState.UNSPECIFIED) },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Review due only" }));
    expect(await screen.findByText("Newer version of Policy v2 exists")).toBeTruthy();
  });

  it("says no document needs review, and shows everything again on request", async () => {
    const { transport } = server([version]);
    renderModule(curation, transport);
    await screen.findByText("Newer version of Policy v2 exists");
    fireEvent.click(screen.getByRole("checkbox", { name: "Review due only" }));
    expect(await screen.findByText("No documents need review.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all findings" }));
    expect(await screen.findByText("Newer version of Policy v2 exists")).toBeTruthy();
    expect(screen.queryByText("No findings. Your documents look consistent.")).toBeNull();
  });

  it("asks the service for the findings due for review, and doesn't page through everything while the states are missing", async () => {
    const listFindings = vi.fn(({ pageToken }: { pageToken: string; kinds: FindingKind[] }) => ({
      findings: [version],
      nextPageToken: pageToken === "" ? "p2" : pageToken === "p2" ? "p3" : "",
    }));
    const transport = createRouterTransport(({ service }) =>
      service(CurationService, {
        listFindings,
        scoreChunks: () => {
          throw new ConnectError("down", Code.Unavailable);
        },
      }),
    );
    renderModule(curation, transport);
    await screen.findByText("Newer version of Policy v2 exists");
    fireEvent.click(screen.getByRole("checkbox", { name: "Review due only" }));
    await waitFor(() =>
      expect(listFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ kinds: [FindingKind.REVIEW_DUE] }),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Review due only" }));
    await screen.findByText("Newer version of Policy v2 exists");

    // By state, with the states out of reach: it says so and doesn't fetch page after page.
    fireEvent.change(screen.getByRole("combobox", { name: "Approval state" }), {
      target: { value: String(LifecycleState.APPROVED) },
    });
    expect(
      await screen.findByText("Approval states aren't available right now. Try again in a moment."),
    ).toBeTruthy();
    const calls = listFindings.mock.calls.length;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(listFindings).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
