import { create, createFileRegistry } from "@bufbuild/protobuf";
import type { GenService } from "@bufbuild/protobuf/codegenv2";
import {
  EmptySchema,
  FileDescriptorProtoSchema,
  file_google_protobuf_empty,
} from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authInterceptor,
  KbRuntimeProvider,
  type RuntimeAuth,
  useClient,
  useRuntimeConfig,
} from "./runtime.tsx";

// platform/ must not import module APIs, so the tests bring their own service.
const registry = createFileRegistry(
  create(FileDescriptorProtoSchema, {
    name: "test/health.proto",
    package: "test",
    dependency: ["google/protobuf/empty.proto"],
    syntax: "proto3",
    service: [
      {
        name: "HealthService",
        method: [
          {
            name: "Check",
            inputType: ".google.protobuf.Empty",
            outputType: ".google.protobuf.Empty",
          },
          {
            name: "Watch",
            inputType: ".google.protobuf.Empty",
            outputType: ".google.protobuf.Empty",
            serverStreaming: true,
          },
        ],
      },
    ],
  }),
  (name) => (name === "google/protobuf/empty.proto" ? file_google_protobuf_empty : undefined),
);
const HealthService = registry.getService("test.HealthService") as GenService<{
  check: { methodKind: "unary"; input: typeof EmptySchema; output: typeof EmptySchema };
  watch: { methodKind: "server_streaming"; input: typeof EmptySchema; output: typeof EmptySchema };
}>;

const config = { apiBaseUrl: "http://gateway", enabledModules: ["chat"] };

describe("KbRuntimeProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provides the runtime config", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <KbRuntimeProvider config={config}>{children}</KbRuntimeProvider>
    );
    const { result } = renderHook(() => useRuntimeConfig(), { wrapper });
    expect(result.current).toBe(config);
  });

  it("gives clients that call through the transport", async () => {
    const check = vi.fn(() => create(EmptySchema));
    const transport = createRouterTransport(({ service }) => service(HealthService, { check }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <KbRuntimeProvider config={config} transport={transport}>
        {children}
      </KbRuntimeProvider>
    );
    const { result } = renderHook(() => useClient(HealthService), { wrapper });
    await result.current.check({});
    expect(check).toHaveBeenCalledOnce();
  });

  it("keeps the client while the transport stays the same", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <KbRuntimeProvider config={config}>{children}</KbRuntimeProvider>
    );
    const { result, rerender } = renderHook(() => useClient(HealthService), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("uses the given query client", () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <KbRuntimeProvider config={config} client={client}>
        {children}
      </KbRuntimeProvider>
    );
    const { result } = renderHook(() => useQueryClient(), { wrapper });
    expect(result.current).toBe(client);
  });

  it("is required by the runtime hooks", () => {
    // React logs the error thrown during render.
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useRuntimeConfig())).toThrow("KbRuntimeProvider is missing");
    expect(() => renderHook(() => useClient(HealthService))).toThrow(
      "KbRuntimeProvider is missing",
    );
  });
});

describe("authInterceptor", () => {
  function setup(
    impl: Parameters<typeof createRouterTransport>[0],
    token: string | null = "t0k3n",
  ) {
    const auth: RuntimeAuth = {
      accessToken: () => token ?? undefined,
      onUnauthenticated: vi.fn(),
    };
    const transport = createRouterTransport(impl, {
      transport: { interceptors: [authInterceptor(auth)] },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <KbRuntimeProvider config={config} transport={transport}>
        {children}
      </KbRuntimeProvider>
    );
    const { result } = renderHook(() => useClient(HealthService), { wrapper });
    return { auth, client: result.current };
  }

  it("sends the access token as a bearer token", async () => {
    let header: string | null = null;
    const { client } = setup(({ service }) =>
      service(HealthService, {
        check: (_req, ctx) => {
          header = ctx.requestHeader.get("authorization");
          return create(EmptySchema);
        },
      }),
    );
    await client.check({});
    expect(header).toBe("Bearer t0k3n");
  });

  it("sends no authorization header without a token", async () => {
    let header: string | null = "unset";
    const { client } = setup(
      ({ service }) =>
        service(HealthService, {
          check: (_req, ctx) => {
            header = ctx.requestHeader.get("authorization");
            return create(EmptySchema);
          },
        }),
      null,
    );
    await client.check({});
    expect(header).toBeNull();
  });

  it("reports a call rejected as UNAUTHENTICATED", async () => {
    const { auth, client } = setup(({ service }) =>
      service(HealthService, {
        check: () => {
          throw new ConnectError("Jwt is expired", Code.Unauthenticated);
        },
      }),
    );
    await expect(client.check({})).rejects.toThrow("Jwt is expired");
    expect(auth.onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("reports a stream rejected as UNAUTHENTICATED", async () => {
    const { auth, client } = setup(({ service }) =>
      service(HealthService, {
        // biome-ignore lint/correctness/useYield: the stream fails before its first message.
        async *watch() {
          throw new ConnectError("Jwt is missing", Code.Unauthenticated);
        },
      }),
    );
    await expect(async () => {
      for await (const _ of client.watch({})) {
        // drain
      }
    }).rejects.toThrow("Jwt is missing");
    expect(auth.onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("leaves other errors to the caller", async () => {
    const { auth, client } = setup(({ service }) =>
      service(HealthService, {
        check: () => {
          throw new ConnectError("down", Code.Unavailable);
        },
      }),
    );
    await expect(client.check({})).rejects.toThrow("down");
    expect(auth.onUnauthenticated).not.toHaveBeenCalled();
  });
});
