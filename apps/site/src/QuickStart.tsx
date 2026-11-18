import { buttonClass, IconButton } from "@knowcel/ui";
import {
  BookOpen,
  Check,
  ChevronDown,
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

const CLONE = `git clone ${REPO}.git && cd knowcelium`;

type Provider = { title: string; text: string; commands: string[] };

/** Each is a complete start-up, like COMMANDS; the shell variables are read by `task up:release`. */
const PROVIDERS: Provider[] = [
  {
    title: "Claude (Anthropic)",
    text: "Claude writes the chat answers. Anthropic has no embedding models, so search and document processing keep using Ollama.",
    commands: [
      CLONE,
      "export KNOWCEL_CHAT_PROVIDER=anthropic",
      "export KNOWCEL_EMBEDDING_PROVIDER=ollama",
      "export KNOWCEL_ANTHROPIC_API_KEY=sk-ant-...  # your Anthropic API key",
      "task up:release -- --profile ollama",
    ],
  },
  {
    title: "OpenAI",
    text: "OpenAI serves both chat and embeddings, so nothing runs locally and no Ollama is started.",
    commands: [
      CLONE,
      "export KNOWCEL_LLM_PROVIDER=openai",
      "export KNOWCEL_OPENAI_API_KEY=sk-...  # your OpenAI API key",
      "task up:release",
    ],
  },
  {
    title: "LM Studio, vLLM or another OpenAI-compatible server",
    text: "Point Knowcelium at a server you run yourself. This example is LM Studio on the host; name the chat and embedding models it has loaded. Leave the API key out if the server does not check one.",
    commands: [
      CLONE,
      "export KNOWCEL_LLM_PROVIDER=openai",
      "export KNOWCEL_OPENAI_URL=http://host.docker.internal:1234/v1",
      "export KNOWCEL_OPENAI_CHAT_MODEL=your-chat-model",
      "export KNOWCEL_OPENAI_EMBEDDING_MODEL=your-embedding-model",
      "export KNOWCEL_OPENAI_SEND_DIMENSIONS=false  # for servers that reject a vector length",
      "task up:release",
    ],
  },
];

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
        <h3 className="mt-10 mb-2 text-left text-xl font-semibold">
          Prefer another model provider?
        </h3>
        <p className="mb-4 text-left text-base text-fg-muted">
          Ollama is the default. To use a hosted or self-run model instead, open its section and run
          those commands in place of the two above.
        </p>
        <div className="space-y-3">
          {PROVIDERS.map((p) => (
            <details key={p.title} className="glass group rounded-card text-left">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-card p-4 font-semibold [&::-webkit-details-marker]:hidden">
                {p.title}
                <ChevronDown
                  className="size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="px-4 pb-4">
                <p className="mb-3 text-base text-fg-muted">{p.text}</p>
                <CodeBlock lines={p.commands} />
              </div>
            </details>
          ))}
        </div>
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
