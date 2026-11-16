import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { LlmService } from "@knowcel/llm-api/knowcel/llm/v1/llm_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import llm from "./index.tsx";

const status = {
  provider: "ollama",
  healthy: true,
  detail: "ollama 0.12.6",
  defaultChatModel: "llama3.2",
  defaultEmbeddingModel: "nomic-embed-text",
  embeddingDimensions: 768,
};
const ADMIN = { id: "root", email: "root@x", displayName: "Root", platformAdmin: true };

function transportWith(getUsage: () => object) {
  return createRouterTransport(({ service }) =>
    service(LlmService, {
      getProviderStatus: () => status,
      listModels: () => ({ models: [] }),
      getUsage,
    }),
  );
}

describe("Usage", () => {
  it("shows the tokens per day, model and module", async () => {
    const days: number[] = [];
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getProviderStatus: () => status,
        listModels: () => ({ models: [] }),
        getUsage: (req) => {
          days.push(req.days);
          return {
            entries: [
              {
                date: "2026-11-16",
                provider: "ollama",
                model: "llama3.2",
                callerModule: "chat",
                requests: 3n,
                inputTokens: 12345n,
                outputTokens: 678n,
              },
              {
                date: "2026-11-15",
                provider: "ollama",
                model: "llama3.2",
                callerModule: "chat",
                requests: 1n,
                inputTokens: 10n,
                outputTokens: 20n,
              },
            ],
          };
        },
      }),
    );
    const { container } = renderModule(llm, transport);

    const table = await screen.findByRole("table", { name: "Usage" });
    const rows = within(table)
      .getAllByRole("row")
      .map((r) => r.textContent);
    expect(rows[1]).toBe(`2026-11-16llama3.2chat3${(12345).toLocaleString()}678`);
    expect(rows[2]).toBe("2026-11-15llama3.2chat11020");
    expect(days).toEqual([30]);
    expect(screen.queryByText(/by all users/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("says whose usage platform admins see", async () => {
    renderModule(
      llm,
      transportWith(() => ({ entries: [] })),
      "/",
      ADMIN,
    );
    expect(await screen.findByText(/by all users/)).toBeTruthy();
    expect(await screen.findByText("No usage yet.")).toBeTruthy();
  });

  it("shows why the usage can't be read", async () => {
    renderModule(
      llm,
      transportWith(() => {
        throw new ConnectError("database down", Code.Unavailable);
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("[unavailable] database down");
    expect(screen.queryByText("No usage yet.")).toBeNull();
  });
});
