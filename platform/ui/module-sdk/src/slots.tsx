import {
  Component,
  type ComponentType,
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useContext,
  useMemo,
} from "react";
import type { ModuleManifest, SlotContribution, SlotName, SlotProps } from "./types.ts";
import { useIsPlatformAdmin } from "./user.tsx";

interface Entry {
  /** Where it comes from: the module's position, then its position in the module. */
  id: string;
  contribution: SlotContribution;
}

const SlotsContext = createContext<readonly Entry[]>([]);

/**
 * Makes the modules' slot contributions available to the `Slot`s below. The
 * shell wraps the app in it with the enabled modules.
 */
export function SlotsProvider({
  modules,
  children,
}: {
  modules: readonly ModuleManifest[];
  children: ReactNode;
}) {
  const entries = useMemo(
    () =>
      modules.flatMap((m, i) =>
        (m.slots ?? []).map((contribution, j) => ({ id: `${i}:${j}`, contribution })),
      ),
    [modules],
  );
  return <SlotsContext.Provider value={entries}>{children}</SlotsContext.Provider>;
}

type Loaded = ComponentType<object>;

// One lazy component per contribution, so a rerender doesn't load it again.
const loaded = new WeakMap<SlotContribution, Loaded>();

function componentOf(contribution: SlotContribution): Loaded {
  let component = loaded.get(contribution);
  if (!component) {
    component = lazy(contribution.load as () => Promise<{ default: Loaded }>);
    loaded.set(contribution, component);
  }
  return component;
}

/**
 * Shows nothing when a contribution fails to load or render, so the page and
 * the other contributions keep working. The failure is logged, and the
 * contribution is loaded again the next time the slot is shown.
 */
class Contained extends Component<
  { contribution: SlotContribution; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`slot ${this.props.contribution.slot}: a contribution failed`, error);
    loaded.delete(this.props.contribution);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function position(order: number | undefined) {
  return order ?? Number.POSITIVE_INFINITY;
}

/**
 * The place where other modules' components for slot `name` render, with the
 * slot's props. Put it where the page wants them, e.g. in its action bar; it
 * renders nothing while no enabled module fills the slot. Contributions
 * appear by their `order`, then in module order, and each is contained: one
 * that fails doesn't take the page or the other contributions with it.
 */
export function Slot<N extends SlotName>({ name, ...props }: { name: N } & SlotProps[N]) {
  const entries = useContext(SlotsContext);
  const isPlatformAdmin = useIsPlatformAdmin();
  const mine = useMemo(
    () =>
      entries
        .filter(
          (e) =>
            e.contribution.slot === name &&
            (isPlatformAdmin || !e.contribution.requiresPlatformAdmin),
        )
        .sort((a, b) => {
          const [x, y] = [position(a.contribution.order), position(b.contribution.order)];
          return x === y ? 0 : x < y ? -1 : 1;
        }),
    [entries, name, isPlatformAdmin],
  );
  return (
    <>
      {mine.map(({ id, contribution }) => {
        const Contribution = componentOf(contribution);
        return (
          <Contained key={id} contribution={contribution}>
            <Suspense fallback={null}>
              <Contribution {...props} />
            </Suspense>
          </Contained>
        );
      })}
    </>
  );
}
