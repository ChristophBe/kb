import type { KbModule } from "@kb/module-sdk";
import { buttonClass, Card, cn, PageTitle } from "@kb/ui";
import { ArrowRight, ArrowUp, Sparkles } from "lucide-react";
import { type CSSProperties, type FormEvent, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ModuleBoundary } from "./ModuleBoundary.tsx";

/** A route inside a module; `path` is relative to the module root. */
function modulePath(m: KbModule, path: string) {
  return path ? `/m/${m.id}/${path}` : `/m/${m.id}`;
}

/** Staggers the entrance (`animate-rise`); reduced motion makes it instant. */
function rise(delayMs: number): CSSProperties {
  return { animationDelay: `${delayMs}ms` };
}

/**
 * The landing page: a hero with a prompt and the main actions, then a showcase
 * of every module's feature, then the module widgets (the user's recent items
 * and the state of things) under their own heading. Everything
 * module-specific comes from `KbModule.feature` and `KbModule.widgets`.
 */
export function Home({ modules }: { modules: KbModule[] }) {
  const prompter = modules.find((m) => m.feature?.prompt);
  const actions = modules.filter((m) => m.feature && m !== prompter).slice(0, 2);
  const widgets = modules.flatMap((m) =>
    Object.entries(m.widgets ?? {}).map(([name, Widget]) => (
      <ModuleBoundary key={`${m.id}.${name}`} title={m.title} widget>
        <Widget />
      </ModuleBoundary>
    )),
  );
  const featuresId = useId();
  const widgetsId = useId();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-16 pb-8">
      <header className="relative isolate -mx-8 -mt-8 overflow-hidden px-8 pt-16 pb-12 sm:pt-24">
        <Halo />
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <p
            className="mb-6 inline-flex animate-rise items-center gap-1.5 rounded-full bg-accent-subtle px-3 py-1 text-xs font-medium text-accent"
            style={rise(0)}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            Answers with sources
          </p>
          <div className="animate-rise" style={rise(80)}>
            <PageTitle className="font-semibold tracking-tight text-balance">
              Ask your documents <span className="text-gradient">anything.</span>
            </PageTitle>
          </div>
          <p
            className="mt-5 max-w-xl animate-rise text-base text-pretty text-fg-muted"
            style={rise(160)}
          >
            kb reads everything you upload and answers in plain language, with the exact passages to
            prove it.
          </p>
          {prompter?.feature?.prompt && (
            <HomePrompt module={prompter} {...prompter.feature.prompt} />
          )}
          {actions.length > 0 && (
            <div
              className="mt-6 flex animate-rise flex-wrap justify-center gap-3"
              style={rise(320)}
            >
              {actions.map((m) =>
                m.feature ? (
                  <Link
                    key={m.id}
                    to={ctaPath(m, m.feature.cta.path)}
                    className={buttonClass("secondary", "px-5 py-2")}
                  >
                    <m.icon className="size-4" />
                    {m.feature.cta.label}
                  </Link>
                ) : null,
              )}
            </div>
          )}
        </div>
      </header>

      <section aria-labelledby={featuresId}>
        <h2 id={featuresId} className="mb-4 animate-rise text-xl font-medium" style={rise(400)}>
          One place for everything you know
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((m, i) => (
            <li key={m.id} className="animate-rise" style={rise(440 + 60 * i)}>
              <FeatureTile module={m} />
            </li>
          ))}
        </ul>
      </section>
      {widgets.length > 0 && (
        <section aria-labelledby={widgetsId}>
          <h2 id={widgetsId} className="mb-4 text-xl font-medium">
            Pick up where you left off
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">{widgets}</div>
        </section>
      )}
    </div>
  );
}

/** Decorative light behind the hero: two slowly drifting blurred blobs in the gradient's colours. */
function Halo() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 mask-b-from-60% mask-b-to-100%"
    >
      <div className="absolute top-1/3 left-1/2 size-[28rem] -translate-x-[70%] animate-glow rounded-full bg-accent/25 blur-3xl" />
      <div
        className="absolute top-1/4 left-1/2 size-[24rem] -translate-x-[10%] animate-glow rounded-full bg-accent-2/20 blur-3xl"
        style={{ animationDelay: "-7s", animationDirection: "alternate-reverse" }}
      />
    </div>
  );
}

/** The hero's main input; opens the module's `prompt.path` with the text in `?q=`. */
function HomePrompt({
  module: m,
  path,
  label,
  placeholder,
  submit: submitLabel,
}: { module: KbModule } & NonNullable<NonNullable<KbModule["feature"]>["prompt"]>) {
  const navigate = useNavigate();
  const to = modulePath(m, path);
  const [q, setQ] = useState("");
  const inputId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    navigate(query ? `${to}?${new URLSearchParams({ q: query })}` : to);
  };
  return (
    <form
      onSubmit={submit}
      style={rise(240)}
      className="glass-strong mt-10 flex w-full max-w-2xl animate-rise items-center gap-3 rounded-full py-2 pr-2 pl-6 transition-shadow focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus"
    >
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <m.icon className="size-5 shrink-0 text-accent" />
      <input
        id={inputId}
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-3 text-base placeholder:text-fg-muted focus-visible:outline-none"
      />
      <button type="submit" className={buttonClass("primary", "rounded-full px-5 py-3")}>
        {submitLabel}
        <ArrowUp className="size-4" aria-hidden="true" />
      </button>
    </form>
  );
}

function FeatureTile({ module: m }: { module: KbModule }) {
  const tile = "flex h-full flex-col gap-3 p-5";
  if (!m.feature) {
    return (
      <Link to={modulePath(m, "")} className="block h-full">
        <Card className={cn(tile, "flex-row items-center")}>
          <m.icon className="size-5 text-fg-muted" />
          <span className="font-medium">{m.title}</span>
        </Card>
      </Link>
    );
  }
  const { headline, description, cta } = m.feature;
  return (
    <Link to={ctaPath(m, cta.path)} className="block h-full">
      <Card className={tile}>
        <span className="inline-flex size-10 items-center justify-center rounded-card bg-accent-subtle text-accent">
          <m.icon className="size-5" />
        </span>
        <h3 className="font-medium">{headline}</h3>
        <p className="flex-1 text-sm text-fg-muted">{description}</p>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">
          {cta.label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </span>
      </Card>
    </Link>
  );
}

/** A feature's entry point: relative to the module root, or absolute (e.g. "/search"). */
function ctaPath(m: KbModule, path: string) {
  return path.startsWith("/") ? path : modulePath(m, path);
}
