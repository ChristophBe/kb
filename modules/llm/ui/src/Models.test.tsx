import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { LlmService, ModelKind } from "@knowcel/llm-api/knowcel/llm/v1/llm_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import llm from "./index.tsx";

describe("Models", () => {
  it("shows the provider status and the models", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getUsage: () => ({ entries: [] }),
        getProviderStatus: () => ({
          provider: "ollama",
          healthy: true,
          detail: "ollama 0.12.6",
          defaultChatModel: "llama3.2",
          defaultEmbeddingModel: "nomic-embed-text",
          embeddingDimensions: 768,
        }),
        listModels: () => ({
          models: [
            { id: "llama3.2", provider: "ollama", kind: ModelKind.CHAT },
            { id: "nomic-embed-text", provider: "ollama", kind: ModelKind.EMBEDDING },
          ],
        }),
      }),
    );
    renderModule(llm, transport);
    expect(await screen.findByText("ollama 0.12.6")).toBeTruthy();
    // An older server sends no chat/embedding: both rows show the one provider.
    expect(screen.getAllByText("healthy")).toHaveLength(2);
    expect(screen.getByText("nomic-embed-text (768 dims)")).toBeTruthy();
    const models = within(await screen.findByRole("list"));
    const kinds = models.getAllByRole("listitem").map((li) => li.textContent);
    expect(kinds).toEqual(["llama3.2ollamachat", "nomic-embed-textollamaembedding"]);
  });

  it("shows the chat and the embedding provider separately", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getUsage: () => ({ entries: [] }),
        getProviderStatus: () => ({
          provider: "anthropic+ollama",
          healthy: false,
          detail: "chat: anthropic unavailable; embedding: ollama 0.12.6",
          defaultChatModel: "claude-sonnet-5-5",
          defaultEmbeddingModel: "nomic-embed-text",
          embeddingDimensions: 768,
          chat: { provider: "anthropic", healthy: false, detail: "anthropic unavailable" },
          embedding: { provider: "ollama", healthy: true, detail: "ollama 0.12.6" },
        }),
        listModels: () => ({
          models: [
            { id: "claude-sonnet-5-5", provider: "anthropic", kind: ModelKind.CHAT },
            { id: "nomic-embed-text", provider: "ollama", kind: ModelKind.EMBEDDING },
          ],
        }),
      }),
    );
    renderModule(llm, transport);
    const chat = (await screen.findByText("Chat provider")).nextElementSibling;
    expect(chat?.textContent).toBe("anthropicunavailable");
    const embedding = screen.getByText("Embedding provider").nextElementSibling;
    expect(embedding?.textContent).toBe("ollamahealthy");
    expect(
      screen.getByText("claude-sonnet-5-5", { selector: "span:not(.font-mono)" }),
    ).toBeTruthy();
  });

  it("shows why the provider can't be reached", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getUsage: () => ({ entries: [] }),
        getProviderStatus: () => ({
          provider: "ollama",
          healthy: false,
          detail: "ollama unreachable",
        }),
        listModels: () => ({ models: [] }),
      }),
    );
    renderModule(llm, transport);
    expect(await screen.findAllByText("unavailable")).toHaveLength(2);
    expect(screen.getByText("ollama unreachable")).toBeTruthy();
  });

  it("shows why the models can't be listed", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getUsage: () => ({ entries: [] }),
        getProviderStatus: () => {
          throw new ConnectError("llm service down", Code.Unavailable);
        },
        listModels: () => {
          throw new ConnectError("llm service down", Code.Unavailable);
        },
      }),
    );
    renderModule(llm, transport);
    expect((await screen.findByRole("alert")).textContent).toBe("[unavailable] llm service down");
  });

  describe("managing models", () => {
    beforeAll(polyfillDialog);

    const ADMIN = { id: "root", email: "root@x", displayName: "Root", platformAdmin: true };
    const MEMBER = { ...ADMIN, id: "mia", platformAdmin: false };
    const status = {
      provider: "ollama",
      healthy: true,
      detail: "ollama 0.12.6",
      defaultChatModel: "llama3.2",
      defaultEmbeddingModel: "nomic-embed-text",
      embeddingDimensions: 768,
    };

    it("hides pulling and deleting from everyone but platform admins", async () => {
      const transport = createRouterTransport(({ service }) =>
        service(LlmService, {
          getUsage: () => ({ entries: [] }),
          getProviderStatus: () => status,
          listModels: () => ({
            models: [{ id: "llama3.2", provider: "ollama", kind: ModelKind.CHAT }],
          }),
        }),
      );
      for (const user of [MEMBER, null]) {
        const { unmount } = renderModule(llm, transport, "/", user);
        expect(await screen.findByText("llama3.2", { selector: "span.font-mono" })).toBeTruthy();
        expect(screen.queryByLabelText("Pull a model")).toBeNull();
        expect(screen.getByText(/A platform admin manages the models/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Delete llama3.2" })).toBeNull();
        unmount();
      }
    });

    it("has no accessibility violations for admins", async () => {
      const transport = createRouterTransport(({ service }) =>
        service(LlmService, {
          getUsage: () => ({ entries: [] }),
          getProviderStatus: () => status,
          listModels: () => ({
            models: [{ id: "llama3.2", provider: "ollama", kind: ModelKind.CHAT }],
          }),
        }),
      );
      const { container } = renderModule(llm, transport, "/", ADMIN);
      await screen.findByLabelText("Pull a model");
      await screen.findByRole("button", { name: "Delete llama3.2" });
      await expectNoAxeViolations(container);
    });

    it("pulls a model with live progress and lists it afterwards", async () => {
      let pulled = false;
      let release: () => void = () => {};
      const midway = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requests: { provider: string; model: string }[] = [];
      const transport = createRouterTransport(({ service }) =>
        service(LlmService, {
          getUsage: () => ({ entries: [] }),
          getProviderStatus: () => status,
          listModels: () => ({
            models: pulled ? [{ id: "phi4", provider: "ollama", kind: ModelKind.CHAT }] : [],
          }),
          async *pullModel(req) {
            requests.push({ provider: req.provider, model: req.model });
            yield { status: "pulling abc", completed: 25n, total: 100n };
            await midway;
            pulled = true;
            yield { status: "success", done: true };
          },
        }),
      );
      renderModule(llm, transport, "/", ADMIN);
      fireEvent.change(await screen.findByLabelText("Pull a model"), { target: { value: "phi4" } });
      fireEvent.click(screen.getByRole("button", { name: "Pull" }));

      const bar = await screen.findByRole("progressbar", { name: "Pulling phi4" });
      await waitFor(() => expect((bar as HTMLProgressElement).value).toBe(25));
      expect(screen.getByText("25 %")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("pulling abc");
      release();
      expect(await screen.findByText("phi4", { selector: "span.font-mono" })).toBeTruthy();
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(requests).toEqual([{ provider: "ollama", model: "phi4" }]);
    });

    it("asks for a model name and says why a pull failed", async () => {
      const transport = createRouterTransport(({ service }) =>
        service(LlmService, {
          getUsage: () => ({ entries: [] }),
          getProviderStatus: () => status,
          listModels: () => ({ models: [] }),
          // biome-ignore lint/correctness/useYield: fails before the first step
          async *pullModel() {
            throw new ConnectError("no such model", Code.NotFound);
          },
        }),
      );
      renderModule(llm, transport, "/", ADMIN);
      const pull = await screen.findByRole("button", { name: "Pull" });
      fireEvent.click(pull);
      expect(screen.getByText("Model name must not be empty")).toBeTruthy();
      fireEvent.change(screen.getByLabelText("Pull a model"), { target: { value: "nope" } });
      fireEvent.click(pull);
      expect((await screen.findByRole("alert")).textContent).toContain(
        "The provider doesn't have this model",
      );
    });

    it("offers both providers when chat and embeddings are served apart", async () => {
      const requests: string[] = [];
      const transport = createRouterTransport(({ service }) =>
        service(LlmService, {
          getUsage: () => ({ entries: [] }),
          getProviderStatus: () => ({
            ...status,
            provider: "anthropic+ollama",
            chat: { provider: "anthropic", healthy: true },
            embedding: { provider: "ollama", healthy: true },
          }),
          listModels: () => ({ models: [] }),
          async *pullModel(req) {
            requests.push(req.provider);
            yield { status: "success", done: true };
          },
        }),
      );
      renderModule(llm, transport, "/", ADMIN);
      fireEvent.change(await screen.findByLabelText("Provider"), { target: { value: "ollama" } });
      fireEvent.change(screen.getByLabelText("Pull a model"), {
        target: { value: "nomic-embed-text" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Pull" }));
      await waitFor(() => expect(requests).toEqual(["ollama"]));
    });

    it("deletes a model after a confirmation", async () => {
      const deleted: { provider: string; model: string }[] = [];
      const transport = createRouterTransport(({ service }) =>
        service(LlmService, {
          getUsage: () => ({ entries: [] }),
          getProviderStatus: () => status,
          listModels: () => ({
            models: deleted.length
              ? []
              : [{ id: "llama3.2", provider: "ollama", kind: ModelKind.CHAT }],
          }),
          deleteModel: (req) => {
            deleted.push({ provider: req.provider, model: req.model });
            return {};
          },
        }),
      );
      renderModule(llm, transport, "/", ADMIN);
      fireEvent.click(await screen.findByRole("button", { name: "Delete llama3.2" }));
      expect(deleted).toEqual([]);
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
      expect(await screen.findByText("No models installed.")).toBeTruthy();
      expect(deleted).toEqual([{ provider: "ollama", model: "llama3.2" }]);
    });

    it("says why a delete was refused", async () => {
      const transport = createRouterTransport(({ service }) =>
        service(LlmService, {
          getUsage: () => ({ entries: [] }),
          getProviderStatus: () => status,
          listModels: () => ({
            models: [{ id: "llama3.2", provider: "ollama", kind: ModelKind.CHAT }],
          }),
          deleteModel: () => {
            throw new ConnectError("denied", Code.PermissionDenied);
          },
        }),
      );
      renderModule(llm, transport, "/", ADMIN);
      fireEvent.click(await screen.findByRole("button", { name: "Delete llama3.2" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Only platform admins can pull and delete models.",
      );
    });
  });
});
