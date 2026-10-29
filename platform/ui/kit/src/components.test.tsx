import { render } from "@testing-library/react";
import { describe, it } from "vitest";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
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
        title="Documents"
        description="All documents"
        actions={<Button>Upload</Button>}
      />,
    );
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
