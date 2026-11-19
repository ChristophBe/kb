import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  CurationService,
  ReportReason,
} from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import { type CurrentUser, CurrentUserProvider } from "@knowcel/module-sdk";
import { renderWithRuntime } from "@knowcel/module-sdk/testing";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import ReportAction from "./ReportAction.tsx";

const bob: CurrentUser = { id: "bob", email: "b@x", displayName: "Bob", platformAdmin: false };

const mine = {
  reporter: "bob",
  reason: ReportReason.OUTDATED,
  comment: "Old figures",
  createdAt: { seconds: 1798761600n, nanos: 0 },
};
const theirs = {
  reporter: "carol",
  reason: ReportReason.WRONG,
  comment: "Typo",
  createdAt: { seconds: 1798761600n, nanos: 0 },
};

function setup(reports: object[] = [], reportDocument = vi.fn((_request: object) => ({}))) {
  const transport = createRouterTransport(({ service }) =>
    service(CurationService, { listReports: () => ({ reports }), reportDocument }),
  );
  const view = renderWithRuntime(
    <CurrentUserProvider user={bob}>
      <ReportAction documentId="d1" />
    </CurrentUserProvider>,
    transport,
  );
  return { ...view, reportDocument };
}

/** The button, once the user's own report is known. */
async function button(name: string) {
  const found = (await screen.findByRole("button", { name })) as HTMLButtonElement;
  await waitFor(() => expect(found.disabled).toBe(false));
  return found;
}

describe("ReportAction", () => {
  beforeAll(polyfillDialog);

  it("reports a document with a reason and a comment, and gives the focus back", async () => {
    const { container, reportDocument } = setup();
    const opener = await button("Report");
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Report this document" });
    // What happens next is said before anything is sent.
    expect(
      within(dialog).getByText(/ranks a little lower until they have looked at it/),
    ).toBeTruthy();
    const send = within(dialog).getByRole("button", { name: "Send report" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: /Outdated/ }));
    fireEvent.change(within(dialog).getByLabelText(/Comment/), {
      target: { value: " Old figures " },
    });
    expect(send.disabled).toBe(false);
    await expectNoAxeViolations(container);
    fireEvent.click(send);
    await waitFor(() => expect(reportDocument).toHaveBeenCalledTimes(1));
    expect(reportDocument.mock.calls[0]?.[0]).toMatchObject({
      documentId: "d1",
      reason: ReportReason.OUTDATED,
      comment: "Old figures",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("shows the user's own report instead of a second form, and changes it on request", async () => {
    const { reportDocument } = setup([theirs, mine]);
    // The report among those of others is the user's own.
    fireEvent.click(await button("Reported"));
    const dialog = await screen.findByRole("dialog", { name: "You reported this document" });
    expect(within(dialog).getByText("Outdated")).toBeTruthy();
    expect(within(dialog).getByText(/Old figures/)).toBeTruthy();
    expect(within(dialog).queryByRole("radio")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Change report" }));
    const form = await screen.findByRole("dialog", { name: "Report this document" });
    // The form starts from the report.
    expect(
      (within(form).getByRole("radio", { name: /Outdated/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect((within(form).getByLabelText(/Comment/) as HTMLTextAreaElement).value).toBe(
      "Old figures",
    );
    fireEvent.click(within(form).getByRole("radio", { name: /Wrong/ }));
    fireEvent.click(within(form).getByRole("button", { name: "Save report" }));
    await waitFor(() => expect(reportDocument).toHaveBeenCalledTimes(1));
    expect(reportDocument.mock.calls[0]?.[0]).toMatchObject({ reason: ReportReason.WRONG });
  });

  it("offers the report to someone whose only reports are those of others", async () => {
    setup([theirs]);
    expect(await button("Report")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reported" })).toBeNull();
  });

  it("waits for the user's report before offering the button", async () => {
    setup([mine]);
    expect((screen.getByRole("button", { name: "Report" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await button("Reported");
  });

  it("keeps the dialog open and says why when the report can't be sent", async () => {
    const failing = vi.fn((_request: object) => {
      throw new ConnectError("down", Code.Unavailable);
    });
    setup([], failing);
    fireEvent.click(await button("Report"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Wrong/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(
      await within(dialog).findByText(
        "Documents aren't available right now. Try again in a moment.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Nothing is lost: the choice is still there to send again.
    expect((within(dialog).getByRole("radio", { name: /Wrong/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("says when the document is gone", async () => {
    const gone = vi.fn((_request: object) => {
      throw new ConnectError("no", Code.NotFound);
    });
    setup([], gone);
    fireEvent.click(await button("Report"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Other/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(await within(dialog).findByText("This document is no longer available.")).toBeTruthy();
  });
});
