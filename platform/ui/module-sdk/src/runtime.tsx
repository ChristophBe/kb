import type { DescService } from "@bufbuild/protobuf";
import { type Client, createClient, type Transport } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";

/** Runtime configuration served by the web container as /config.json. */
export interface RuntimeConfig {
  /** Base URL of the Envoy gRPC-Web gateway. */
  apiBaseUrl: string;
  /** Module ids to show; all compiled-in modules when omitted. */
  enabledModules?: string[];
}

interface Runtime {
  config: RuntimeConfig;
  transport: Transport;
}

const RuntimeContext = createContext<Runtime | null>(null);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function KbRuntimeProvider({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: ReactNode;
}) {
  const runtime = useMemo<Runtime>(
    () => ({ config, transport: createGrpcWebTransport({ baseUrl: config.apiBaseUrl }) }),
    [config],
  );
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("KbRuntimeProvider is missing");
  return runtime;
}

export function useRuntimeConfig(): RuntimeConfig {
  return useRuntime().config;
}

/** Returns a typed client for a generated service descriptor. */
export function useClient<T extends DescService>(service: T): Client<T> {
  const { transport } = useRuntime();
  return useMemo(() => createClient(service, transport), [service, transport]);
}
