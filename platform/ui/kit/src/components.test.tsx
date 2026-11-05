import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Area,
  Badge,
  Button,
  Card,
  ChunkStrip,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
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
      <Area>
        <nav aria-label="Sections">Content</nav>
      </Area>,
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
