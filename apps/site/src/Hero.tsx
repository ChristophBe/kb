import { buttonClass } from "@knowcel/ui";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ChatDemo } from "./ChatDemo.tsx";
import { GithubMark } from "./GithubMark.tsx";
import { delay, REPO } from "./links.ts";

/** Headline, pitch and the two calls to action beside a recording of the product at work. */
export function Hero() {
  return (
    <header className="relative isolate overflow-x-clip px-4 pt-12 pb-20 sm:px-8 sm:pt-20">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center lg:gap-14">
        <div className="flex flex-col items-start text-left">
          <p
            className="mb-8 inline-flex animate-rise items-center gap-2 rounded-full bg-accent-subtle px-4 py-1.5 text-sm font-medium text-accent"
            style={delay(0)}
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Open source · runs on your own infrastructure
          </p>
          <div className="animate-rise" style={delay(80)}>
            <h1 className="font-bold text-balance text-fg text-3xl sm:text-4xl lg:text-5xl">
              Everything your organization knows, <span className="text-gradient">connected.</span>
            </h1>
          </div>
          <p
            className="mt-6 max-w-xl animate-rise text-lg text-pretty text-fg-muted sm:text-xl"
            style={delay(160)}
          >
            Knowcelium grows into the systems you already use, connects what they know, and answers
            your people and your tools in plain language, with the passages to prove it. Open
            source, modular, and on your own infrastructure.
          </p>
          <div className="mt-8 flex animate-rise flex-wrap gap-3" style={delay(240)}>
            <a href="#quick-start" className={buttonClass("primary", "px-6 py-3 text-base")}>
              Get started
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
            <a href={REPO} className={buttonClass("secondary", "px-6 py-3 text-base")}>
              <GithubMark className="size-4" />
              View on GitHub
            </a>
          </div>
        </div>
        <div className="relative isolate min-w-0 animate-rise" style={delay(360)}>
          <Glow />
          <ChatDemo />
        </div>
      </div>
    </header>
  );
}

/** Decorative light that glows from behind the demo. */
function Glow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-16 -z-10">
      <div className="absolute top-0 left-0 size-[22rem] animate-glow rounded-full bg-accent/20 blur-3xl" />
      <div
        className="absolute right-0 bottom-0 size-[20rem] animate-glow rounded-full bg-accent-2/15 blur-3xl"
        style={{ animationDelay: "-7s", animationDirection: "alternate-reverse" }}
      />
    </div>
  );
}
