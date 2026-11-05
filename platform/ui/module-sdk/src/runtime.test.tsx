import { create, createFileRegistry } from "@bufbuild/protobuf";
import type { GenService } from "@bufbuild/protobuf/codegenv2";
import {
  EmptySchema,
  FileDescriptorProtoSchema,
  file_google_protobuf_empty,
} from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KbRuntimeProvider, useClient, useRuntimeConfig } from "./runtime.tsx";

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
        ],
      },
    ],
  }),
  (name) => (name === "google/protobuf/empty.proto" ? file_google_protobuf_empty : undefined),
);
const HealthService = registry.getService("test.HealthService") as GenService<{
  check: { methodKind: "unary"; input: typeof EmptySchema; output: typeof EmptySchema };
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
