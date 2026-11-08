import type { RuntimeAuth } from "@kb/module-sdk";
import { Button, DelayedLoading, ErrorMessage, PageTitle, Spinner } from "@kb/ui";
import { Library } from "lucide-react";
import type { User, UserManager } from "oidc-client-ts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { displayName, signIn, startSession } from "./session.ts";

type State =
  | { kind: "starting" }
  | { kind: "signed-in"; user: User }
  | { kind: "redirecting"; expired: boolean }
  | { kind: "signed-out" }
  | { kind: "failed"; error: unknown };

/** The signed-in user, as the shell shows them. */
export interface Session {
  name: string;
  email?: string;
  signOut(): void;
}

const SessionContext = createContext<Session | null>(null);

/** The signed-in user; null when the shell runs without sign-in. */
export function useSession(): Session | null {
  return useContext(SessionContext);
}

/**
 * Renders `children` once the user is signed in, with the RuntimeAuth that
 * attaches their token to every call. Until then, and while the browser goes
 * to the identity provider (also after the gateway rejected the token), it
 * shows a sign-in screen instead of the app.
 */
export function AuthGate({
  manager,
  children,
}: {
  manager: UserManager;
  children: (auth: RuntimeAuth) => ReactNode;
}) {
  const [state, setState] = useState<State>({ kind: "starting" });
  const user = useRef<User | null>(null);
  const started = useRef(false);
  const leaving = useRef(false);

  const redirect = useCallback(
    (expired: boolean) => {
      if (leaving.current) return;
      leaving.current = true;
      user.current = null;
      setState({ kind: "redirecting", expired });
      manager
        .removeUser()
        .then(() => signIn(manager))
        .catch((error: unknown) => {
          leaving.current = false;
          setState({ kind: "failed", error });
        });
    },
    [manager],
  );

  useEffect(() => {
    // Renewed tokens (automaticSilentRenew) arrive here too.
    const loaded = (u: User) => {
      user.current = u;
      setState({ kind: "signed-in", user: u });
    };
    manager.events.addUserLoaded(loaded);
    // Once per page load, also under StrictMode's double effects: the
    // provider's redirect can only be completed once.
    if (!started.current) {
      started.current = true;
      startSession(manager).then(
        (u) => (u ? loaded(u) : setState({ kind: "redirecting", expired: false })),
        (error: unknown) => setState({ kind: "failed", error }),
      );
    }
    return () => manager.events.removeUserLoaded(loaded);
  }, [manager]);

  const auth = useMemo<RuntimeAuth>(
    () => ({
      accessToken: () => user.current?.access_token,
      onUnauthenticated: () => redirect(true),
    }),
    [redirect],
  );

  const signedIn = state.kind === "signed-in" ? state.user : null;
  const session = useMemo<Session | null>(
    () =>
      signedIn && {
        name: displayName(signedIn),
        email: signedIn.profile.email,
        signOut: () => {
          user.current = null;
          setState({ kind: "signed-out" });
          manager.removeUser().catch(() => {});
        },
      },
    [manager, signedIn],
  );

  if (session) {
    return <SessionContext.Provider value={session}>{children(auth)}</SessionContext.Provider>;
  }
  const retry = () => {
    leaving.current = false;
    redirect(false);
  };
  return (
    <SignInScreen>
      {state.kind === "signed-out" ? (
        <>
          <PageTitle>You're signed out</PageTitle>
          <Button onClick={retry}>Sign in</Button>
        </>
      ) : state.kind === "failed" ? (
        <>
          <PageTitle>Couldn't sign you in</PageTitle>
          <ErrorMessage error={signInError(state.error)} />
          <Button onClick={retry}>Try again</Button>
        </>
      ) : (
        <DelayedLoading>
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner label="Signing in" />
            {state.kind === "redirecting" && state.expired
              ? "Your session has expired. Signing in again…"
              : "Signing in…"}
          </p>
        </DelayedLoading>
      )}
    </SignInScreen>
  );
}

/** Plain words for the user; the provider's own message only when it sent one back. */
function signInError(error: unknown): string {
  // oidc-client-ts throws ErrorResponse (with `error`) for answers from the
  // provider, plain errors (failed fetches, missing state) otherwise.
  const answer = error as { error?: unknown; error_description?: unknown };
  if (typeof answer.error === "string") {
    return typeof answer.error_description === "string"
      ? `The sign-in was refused: ${answer.error_description}`
      : "The sign-in was refused.";
  }
  return "Sign-in isn't available right now. Try again in a moment.";
}

function SignInScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="flex items-center gap-2 font-semibold">
        <Library className="size-5 text-accent" aria-hidden="true" />
        <span className="font-mono font-medium">kb</span>
        <span className="text-fg-muted">/</span> Knowledge Base
      </p>
      {children}
    </main>
  );
}
