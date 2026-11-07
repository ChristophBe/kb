import { buttonClass, PageTitle } from "@kb/ui";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ChatDemo } from "./ChatDemo.tsx";
import { GithubMark } from "./GithubMark.tsx";
import { delay, REPO } from "./links.ts";

/** Headline, pitch and the two calls to action, above a live-looking chat answer. */
export function Hero() {
  return (
    <header className="relative isolate overflow-hidden px-4 pt-16 pb-20 sm:px-8 sm:pt-24">
      <Halo />
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <p
          className="mb-6 inline-flex animate-rise items-center gap-1.5 rounded-full bg-accent-subtle px-3 py-1 text-xs font-medium text-accent"
          style={delay(0)}
        >
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Open source · runs on your own machine
        </p>
        <div className="animate-rise" style={delay(80)}>
          <PageTitle className="font-semibold tracking-tight text-balance">
            Ask your documents <span className="text-gradient">anything.</span>
          </PageTitle>
        </div>
        <p
          className="mt-5 max-w-xl animate-rise text-base text-pretty text-fg-muted"
          style={delay(160)}
        >
          kb reads the PDFs, Markdown and text files you give it, finds passages by meaning, and
          answers your questions in plain language, with the exact passages to prove it. Your
          documents never leave your machine.
        </p>
        <div className="mt-8 flex animate-rise flex-wrap justify-center gap-3" style={delay(240)}>
          <a href="#quick-start" className={buttonClass("primary", "px-5 py-2.5")}>
            Get started
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
          <a href={REPO} className={buttonClass("secondary", "px-5 py-2.5")}>
            <GithubMark className="size-4" />
            View on GitHub
          </a>
        </div>
      </div>
      <div className="mx-auto mt-14 max-w-4xl animate-rise" style={delay(360)}>
        <ChatDemo />
      </div>
    </header>
  );
}

/** Decorative light behind the hero, as on the app's home page. */
function Halo() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 mask-b-from-60% mask-b-to-100%"
    >
      <div className="absolute top-1/4 left-1/2 size-[32rem] -translate-x-[70%] animate-glow rounded-full bg-accent/25 blur-3xl" />
      <div
        className="absolute top-[15%] left-1/2 size-[28rem] -translate-x-[10%] animate-glow rounded-full bg-accent-2/20 blur-3xl"
        style={{ animationDelay: "-7s", animationDirection: "alternate-reverse" }}
      />
    </div>
  );
}
