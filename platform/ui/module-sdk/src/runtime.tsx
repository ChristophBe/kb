import type { DescService } from "@bufbuild/protobuf";
import {
  type Client,
  Code,
  ConnectError,
  createClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { SearchContext } from "./types.ts";

/** Runtime configuration served by the web container as /config.json. */
export interface RuntimeConfig {
  /** Base URL of the Envoy gRPC-Web gateway. */
  apiBaseUrl: string;
  /** Module ids to show; all compiled-in modules when omitted. */
  enabledModules?: string[];
  /** The OIDC provider the shell signs in with; without it calls carry no token. */
  auth?: { issuer: string; clientId: string };
}

/** How the transport authenticates calls; the shell implements it. */
export interface RuntimeAuth {
  /** The current access token, sent as `authorization: Bearer <token>`. */
  accessToken(): string | undefined;
  /** Called when the gateway rejects a call as UNAUTHENTICATED, e.g. with an expired token. */
  onUnauthenticated(): void;
}

/**
 * Attaches the access token to every call and reports UNAUTHENTICATED
 * rejections, including those of a stream after its first message.
 */
export function authInterceptor(auth: RuntimeAuth): Interceptor {
  const rejected = (err: unknown) => {
    if (ConnectError.from(err).code === Code.Unauthenticated) auth.onUnauthenticated();
    return err;
  };
  return (next) => async (req) => {
    const token = auth.accessToken();
    if (token) req.header.set("authorization", `Bearer ${token}`);
    let res: Awaited<ReturnType<typeof next>>;
    try {
      res = await next(req);
    } catch (err) {
      throw rejected(err);
    }
    if (!res.stream) return res;
    const messages = res.message;
    return {
      ...res,
      message: (async function* () {
        try {
          yield* messages;
        } catch (err) {
          throw rejected(err);
        }
      })(),
    };
  };
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
  auth,
  transport,
  client = queryClient,
  children,
}: {
  config: RuntimeConfig;
  /** Authenticates the gRPC-Web transport's calls; keep it stable across renders. */
  auth?: RuntimeAuth;
  /** Replaces the gRPC-Web transport, e.g. with an in-memory one in tests. */
  transport?: Transport;
  /** Replaces the shared query cache, e.g. with a fresh one per test. */
  client?: QueryClient;
  children: ReactNode;
}) {
  const runtime = useMemo<Runtime>(
    () => ({
      config,
      transport:
        transport ??
        createGrpcWebTransport({
          baseUrl: config.apiBaseUrl,
          interceptors: auth ? [authInterceptor(auth)] : [],
        }),
    }),
    [config, auth, transport],
  );
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
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

/** The context the shell passes to every `SearchProvider.search` call. */
export function useSearchContext(): SearchContext {
  const { transport } = useRuntime();
  return useMemo(() => ({ client: (service) => createClient(service, transport) }), [transport]);
}
