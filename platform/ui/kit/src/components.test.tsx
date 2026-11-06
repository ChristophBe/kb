import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Area,
  Badge,
  Button,
  buttonClass,
  Card,
  ChunkStrip,
  EmptyState,
  ErrorMessage,
  IconButton,
  Input,
  navItemClass,
  PageHeader,
  RelativeTime,
  SourceNote,
  Spinner,
  Textarea,
  type Tone,
} from "./components.tsx";
import { expectNoAxeViolations } from "./testing/axe.ts";

describe("kit components have no axe violations", () => {
  it("Button", async () => {
    const { container } = render(
      <>
        {(["primary", "secondary", "ghost", "danger"] as const).map((variant) => (
          <Button key={variant} variant={variant}>
            Save
          </Button>
        ))}
        <Button disabled>Disabled</Button>
        <Button aria-label="Delete document">
          <svg aria-hidden="true" />
        </Button>
      </>,
    );
    await expectNoAxeViolations(container);
  });

  it("IconButton", async () => {
    const { container } = render(
      <>
        <IconButton label="Download">
          <svg />
        </IconButton>
        <IconButton label="Delete document" tone="danger">
          <svg />
        </IconButton>
      </>,
    );
    await expectNoAxeViolations(container);
  });

  it("links styled with buttonClass and navItemClass", async () => {
    const { container } = render(
      <nav aria-label="Sections">
        <a href="/search" className={buttonClass("secondary")}>
          Search
        </a>
        <a href="/documents" aria-current="page" className={navItemClass(true)}>
          Documents
        </a>
        <a href="/chat" className={navItemClass(false)}>
          Chat
        </a>
      </nav>,
    );
    await expectNoAxeViolations(container);
  });

  it("Card", async () => {
    const { container } = render(
      <Card>
        <p>Content</p>
      </Card>,
    );
    await expectNoAxeViolations(container);
  });

  it("Area", async () => {
    const { container } = render(
      <>
        <Area>
          <nav aria-label="Sections">Content</nav>
        </Area>
        <Area tone="secondary">
          <nav aria-label="Conversations">List</nav>
        </Area>
      </>,
    );
    await expectNoAxeViolations(container);
  });

  it("Input and Textarea with labels", async () => {
    const { container } = render(
      <form>
        <label htmlFor="title">Title</label>
        <Input id="title" />
        <label htmlFor="question">Question</label>
        <Textarea id="question" />
      </form>,
    );
    await expectNoAxeViolations(container);
  });

  it("Badge", async () => {
    const tones: Tone[] = ["neutral", "info", "success", "warning", "danger"];
    const { container } = render(
      <div>
        {tones.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>,
    );
    await expectNoAxeViolations(container);
  });

  it("PageHeader", async () => {
    const { container } = render(
      <PageHeader
        eyebrow="kb / documents"
        title="Documents"
        description="All documents"
        actions={<Button>Upload</Button>}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it("SourceNote", async () => {
    const { container } = render(
      <ul aria-label="Sources">
        <SourceNote
          n={1}
          title="Quarterly report"
          detail="chunk 3"
          snippet="Revenue grew."
          active
        />
      </ul>,
    );
    await expectNoAxeViolations(container);
  });

  it("ChunkStrip", async () => {
    const { container } = render(<ChunkStrip count={42} marked={[0, 7]} />);
    await expectNoAxeViolations(container);
  });

  it("EmptyState", async () => {
    const { container } = render(<EmptyState>No documents yet.</EmptyState>);
    await expectNoAxeViolations(container);
  });

  it("ErrorMessage", async () => {
    const { container } = render(<ErrorMessage error={new Error("Couldn't load documents")} />);
    await expectNoAxeViolations(container);
  });

  it("Spinner", async () => {
    const { container } = render(<Spinner label="Loading documents" />);
    await expectNoAxeViolations(container);
  });

  it("RelativeTime", async () => {
    const { container } = render(<RelativeTime time={{ seconds: 1_700_000_000n }} />);
    await expectNoAxeViolations(container);
  });
});

describe("RelativeTime", () => {
  it("shows the age with the absolute time as tooltip", () => {
    const seconds = BigInt(Math.floor(Date.now() / 1000) - 5 * 60);
    render(<RelativeTime time={{ seconds }} />);
    const time = screen.getByText("5 minutes ago");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("dateTime")).toBe(new Date(Number(seconds) * 1000).toISOString());
    expect(time.getAttribute("title")).toBe(new Date(Number(seconds) * 1000).toLocaleString());
  });

  it("renders nothing without a time", () => {
    const { container } = render(<RelativeTime time={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("IconButton", () => {
  it("is named by its label and hides the icon", () => {
    render(
      <IconButton label="Dismiss notification">
        <svg data-testid="icon" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Dismiss notification" });
    expect(button.getAttribute("title")).toBe("Dismiss notification");
    expect(screen.getByTestId("icon").closest("[aria-hidden]")).not.toBeNull();
  });
});

describe("ChunkStrip", () => {
  it("states the chunk and citation counts as text", () => {
    const { container } = render(<ChunkStrip count={8} marked={[1, 1, 4]} />);
    expect(container.textContent).toBe("8 chunks, 2 cited");
    expect(container.querySelectorAll("[data-marked]")).toHaveLength(2);
  });

  it("uses the singular and draws no ticks without chunks", () => {
    expect(render(<ChunkStrip count={1} />).container.textContent).toBe("1 chunk");
    const empty = render(<ChunkStrip count={0} />).container;
    expect(empty.textContent).toBe("0 chunks");
    expect(empty.querySelector("[aria-hidden]")).toBeNull();
  });

  it("buckets long documents without losing marks", () => {
    const { container } = render(<ChunkStrip count={500} marked={[499]} />);
    const ticks = container.querySelector("[aria-hidden]")?.children;
    expect(ticks).toHaveLength(48);
    expect(ticks?.[47]?.hasAttribute("data-marked")).toBe(true);
  });
});
