import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { IamService, TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import {
  Access,
  IngestionService,
  JobStatus,
} from "@knowcel/ingestion-api/knowcel/ingestion/v1/ingestion_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { badRequestDetail } from "@knowcel/ui/testing/errors";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ingestion from "./index.tsx";

const teams = () => ({
  teams: [{ id: "t1", name: "Platform", myRole: TeamRole.ADMIN, members: [] }],
});

describe("UrlImport", () => {
  const render = (createFromUrl: ReturnType<typeof vi.fn>) =>
    renderModule(
      ingestion,
      createRouterTransport(({ service }) => {
        // The mocks return plain objects; the service types want messages.
        service(IngestionService, {
          listJobs: () => ({ jobs: [] }),
          createFromUrl: createFromUrl as never,
        });
        service(IamService, { listMyTeams: teams });
      }),
    );
  const address = () => screen.getByLabelText("Add a web page") as HTMLInputElement;

  it("adds a public page and shows its job", async () => {
    const createFromUrl = vi.fn(() => ({
      job: { id: "j1", filename: "oysters.html", status: JobStatus.QUEUED },
    }));
    render(createFromUrl);
    await screen.findByText("No uploads yet. Drop files above to add documents.");

    fireEvent.change(address(), { target: { value: " https://example.com/oysters " } });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));

    expect(await screen.findByText("oysters.html")).toBeTruthy();
    expect(createFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/oysters",
        access: Access.PUBLIC,
        teamIds: [],
      }),
      expect.anything(),
    );
    await waitFor(() => expect(address().value).toBe(""));
  });

  it("shares the page with the chosen teams", async () => {
    const createFromUrl = vi.fn(() => ({ job: { id: "j1", filename: "a.html" } }));
    render(createFromUrl);
    await screen.findByText("No uploads yet. Drop files above to add documents.");

    fireEvent.change(address(), { target: { value: "https://example.com/a" } });
    const group = screen.getByRole("group", { name: "Who can read this page?" });
    fireEvent.click(within(group).getByRole("radio", { name: /Team/ }));
    const add = screen.getByRole("button", { name: "Add page" });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(await within(group).findByRole("checkbox", { name: "Platform" }));
    fireEvent.click(add);

    await waitFor(() => expect(createFromUrl).toHaveBeenCalled());
    expect(createFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({ access: Access.TEAM, teamIds: ["t1"] }),
      expect.anything(),
    );
  });

  it("does nothing without an address", async () => {
    const createFromUrl = vi.fn();
    render(createFromUrl);
    await screen.findByText("No uploads yet. Drop files above to add documents.");

    fireEvent.click(screen.getByRole("button", { name: "Add page" }));

    expect(createFromUrl).not.toHaveBeenCalled();
  });

  it("shows why an address was refused and keeps it", async () => {
    const createFromUrl = vi.fn(() => {
      const err = new ConnectError("invalid", Code.InvalidArgument);
      err.details.push(
        badRequestDetail([
          { field: "url", description: "Addresses on private networks are not allowed" },
        ]),
      );
      throw err;
    });
    render(createFromUrl);
    await screen.findByText("No uploads yet. Drop files above to add documents.");

    fireEvent.change(address(), { target: { value: "http://10.0.0.1/" } });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));

    const message = await screen.findByText("Addresses on private networks are not allowed");
    expect(address().getAttribute("aria-invalid")).toBe("true");
    expect(address().getAttribute("aria-describedby")).toBe(message.id);
    expect(address().value).toBe("http://10.0.0.1/");
  });

  it("explains an unreachable server", async () => {
    const createFromUrl = vi.fn(() => {
      throw new ConnectError("Failed to fetch", Code.Unavailable);
    });
    render(createFromUrl);
    await screen.findByText("No uploads yet. Drop files above to add documents.");

    fireEvent.change(address(), { target: { value: "https://example.com/" } });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));

    expect(await screen.findByText("the server couldn't be reached")).toBeTruthy();
  });
});
