import { buttonClass, IconButton } from "@kb/ui";
import { BookOpen, Check, Copy } from "lucide-react";
import { useState } from "react";
import { SectionTitle } from "./Features.tsx";
import { GithubMark } from "./GithubMark.tsx";
import { REPO, repoPath } from "./links.ts";

/** The README's quick start; keep the two in step. */
const COMMANDS = [
  `git clone ${REPO}.git && cd kb`,
  "alias task='go tool -modfile=tools/go.mod task'   # or install go-task",
  "task setup                      # go/uv/pnpm dependencies",
  "task up -- --profile ollama     # full stack incl. Ollama",
  "open http://localhost:3000",
];

/** How to get kb running, with the commands ready to copy. */
export function QuickStart() {
  return (
    <section
      id="quick-start"
      aria-labelledby="start-title"
      className="overflow-hidden px-4 py-20 sm:px-8"
    >
      <div className="relative isolate mx-auto max-w-3xl text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto size-[28rem] rounded-full bg-accent/15 blur-3xl"
        />
        <div className="flex justify-center">
          <SectionTitle
            id="start-title"
            eyebrow="Quick start"
            title="Your own knowledge base in a few minutes"
            text="You need Go, uv, Node with pnpm, and Docker. The first start downloads a chat model and an embedding model for Ollama."
          />
        </div>
        <CodeBlock lines={COMMANDS} />
        <p className="mt-4 text-sm text-fg-muted">
          No GPU, or just trying it out? Start with{" "}
          <code className="font-mono text-xs text-fg">
            KB_LLM_PROVIDER=fake KB_RAG_MIN_SCORE=-1 task up
          </code>{" "}
          for a quick tour without a model; its answers just echo the passages they found.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={REPO} className={buttonClass("primary", "px-5 py-2.5")}>
            <GithubMark className="size-4" />
            Get kb on GitHub
          </a>
          <a
            href={repoPath("docs/user-manual/getting-started.md")}
            className={buttonClass("secondary", "px-5 py-2.5")}
          >
            <BookOpen className="size-4" aria-hidden="true" />
            Read the user manual
          </a>
        </div>
      </div>
    </section>
  );
}

function CodeBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    // Copy the commands without their comments, so they paste straight into a shell.
    const text = lines.map((l) => l.replace(/\s+#.*$/, "")).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the commands can still be selected by hand.
    }
  };
  return (
    <div className="glass relative rounded-card text-left">
      <pre className="overflow-x-auto p-4 pr-12 font-mono text-xs leading-6">
        {lines.map((l) => {
          const [, cmd, comment] = l.match(/^(.*?)(\s+#.*)?$/) ?? [];
          return (
            <div key={l}>
              <span className="text-fg-muted select-none">$ </span>
              {cmd}
              {comment && <span className="text-fg-muted">{comment}</span>}
            </div>
          );
        })}
      </pre>
      <IconButton
        label={copied ? "Copied" : "Copy commands"}
        className="absolute top-2 right-2"
        onClick={copy}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </IconButton>
    </div>
  );
}
