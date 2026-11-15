import { buttonClass, IconButton } from "@knowcel/ui";
import {
  BookOpen,
  Check,
  Container,
  Copy,
  ExternalLink,
  GitBranch,
  HardDrive,
  type LucideIcon,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { SectionTitle } from "./Features.tsx";
import { GithubMark } from "./GithubMark.tsx";
import { REPO, repoPath } from "./links.ts";

/** Two commands: `task up:release` runs the latest release's published images, so nothing is built. */
const COMMANDS = [`git clone ${REPO}.git && cd knowcelium`, "task up:release -- --profile ollama"];

type Prerequisite = { icon: LucideIcon; title: string; text: string; href?: string };

/** Each links to the vendor's own install page, which picks the right steps for Linux, macOS and Windows. */
const PREREQUISITES: Prerequisite[] = [
  {
    icon: GitBranch,
    title: "Git",
    text: "Downloads Knowcelium. Any recent version will do.",
    href: "https://git-scm.com/downloads",
  },
  {
    icon: Container,
    title: "Docker with Compose",
    text: "Runs everything. Docker Desktop includes Compose; on Linux install Docker Engine with the Compose plugin.",
    href: "https://docs.docker.com/get-started/get-docker/",
  },
  {
    icon: Terminal,
    title: "Task",
    text: "A small command runner that works the same on every system.",
    href: "https://taskfile.dev/docs/installation",
  },
  {
    icon: HardDrive,
    title: "A few GB of free space",
    text: "For the images and the language models. A GPU helps but is not required.",
  },
];

/** How to get Knowcelium running, with the commands ready to copy. */
export function QuickStart() {
  return (
    <section
      id="quick-start"
      aria-labelledby="start-title"
      className="overflow-hidden px-4 py-24 sm:px-8"
    >
      <div className="relative isolate mx-auto max-w-4xl text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto size-[28rem] rounded-full bg-accent/15 blur-3xl"
        />
        <div className="flex justify-center">
          <SectionTitle
            id="start-title"
            eyebrow="Quick start"
            title="Your own Knowcelium in a few minutes"
            text="Two commands, nothing to compile: Knowcelium starts from pre-built images."
          />
        </div>
        <h3 className="mb-4 text-left text-xl font-semibold">What you need first</h3>
        <ul className="mb-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
          {PREREQUISITES.map((p) => (
            <li key={p.title} className="glass flex flex-col gap-2 rounded-card p-4">
              <p.icon className="size-5 text-accent" aria-hidden="true" />
              <p className="font-semibold">{p.title}</p>
              <p className="flex-1 text-sm text-fg-muted">{p.text}</p>
              {p.href && (
                <a
                  href={p.href}
                  className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                >
                  Install {p.title.split(" ")[0]}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">(Linux, macOS and Windows)</span>
                </a>
              )}
            </li>
          ))}
        </ul>
        <h3 className="mb-4 text-left text-xl font-semibold">Then run these two commands</h3>
        <CodeBlock lines={COMMANDS} />
        <p className="mt-4 text-left text-base text-fg-muted">
          The first start downloads the images and two language models, which takes a few minutes.
          When the logs settle, open{" "}
          <code className="font-mono text-sm text-fg">http://localhost:3000</code>.
        </p>
        <p className="mt-4 text-left text-base text-fg-muted">
          No GPU, or just trying it out? Run it without the <code>--profile ollama</code> flag and
          start with{" "}
          <code className="font-mono text-sm break-words text-fg">
            KNOWCEL_LLM_PROVIDER=fake KNOWCEL_RAG_MIN_SCORE=-1 task up:release
          </code>{" "}
          for a quick tour without a model; its answers just echo the passages they found.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={REPO} className={buttonClass("primary", "px-6 py-3 text-base")}>
            <GithubMark className="size-4" />
            Get Knowcelium on GitHub
          </a>
          <a
            href={repoPath("docs/user-manual/getting-started.md")}
            className={buttonClass("secondary", "px-6 py-3 text-base")}
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
      <pre className="overflow-x-auto p-5 pr-12 font-mono text-sm leading-7">
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
