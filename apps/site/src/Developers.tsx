import { Badge } from "@kb/ui";
import { ArrowDown, Blocks, Braces, type LucideIcon, Workflow } from "lucide-react";
import { SectionTitle } from "./Features.tsx";
import { repoPath } from "./links.ts";

const POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Blocks,
    title: "Modules, not layers",
    text: "Each module ships its contract, backend, migrations and UI together. Adding a feature means adding a module, and the shell picks it up.",
  },
  {
    icon: Braces,
    title: "One contract, every language",
    text: "Protobuf contracts generate the Go, Python and TypeScript clients. The browser talks gRPC-Web, so types reach all the way to the UI.",
  },
  {
    icon: Workflow,
    title: "Generated wiring",
    text: "Routes, compose files, the UI registry and the import boundaries are generated from the module manifests, and CI checks they stay in sync.",
  },
];

const MODULES = [
  { id: "document", lang: "Go", text: "Documents, files, passages and vectors" },
  {
    id: "ingestion",
    lang: "Go + Python",
    text: "Uploads and the extract → chunk → embed pipeline",
  },
  { id: "chat", lang: "Python", text: "Conversations and cited, streamed answers" },
  { id: "llm", lang: "Python", text: "The one gateway to language models" },
];

/** For people who want to run, read or extend kb. */
export function Developers() {
  return (
    <section id="developers" aria-labelledby="dev-title" className="px-4 py-20 sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <SectionTitle
            id="dev-title"
            eyebrow="For developers"
            title="Small modules, clear contracts, easy to extend"
            text="kb is a modular monorepo: Go for the core services, Python for the language work, React for the interface, and gRPC between all of them."
          />
          <ul className="space-y-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <p.icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="font-medium">{p.title}</p>
                  <p className="mt-1 text-sm text-fg-muted">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm">
            <a href={repoPath("docs/architecture/overview.md")} className="text-accent underline">
              Read the architecture overview
            </a>
          </p>
        </div>

        <Architecture />
      </div>
    </section>
  );
}

/** The README's architecture diagram as themed boxes: browser → Envoy → modules → storage. */
function Architecture() {
  return (
    <figure className="glass rounded-panel p-4 sm:p-6">
      <figcaption className="sr-only">
        Architecture: the browser talks gRPC-Web to Envoy, which routes to the document, ingestion,
        chat and llm modules; they store data in Postgres with pgvector, S3 and NATS JetStream.
      </figcaption>
      <div aria-hidden="true" className="flex flex-col items-center gap-2 font-mono text-xs">
        <Box>browser</Box>
        <Arrow label="gRPC-Web" />
        <Box>envoy</Box>
        <Arrow label="gRPC" />
        <div className="grid w-full gap-2 sm:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.id} className="rounded-card border border-border bg-surface p-3 font-sans">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium text-accent">{m.id}</span>
                <Badge>{m.lang}</Badge>
              </div>
              <p className="mt-1.5 text-xs text-fg-muted">{m.text}</p>
            </div>
          ))}
        </div>
        <Arrow />
        <div className="grid w-full grid-cols-3 gap-2 text-center">
          <Box>Postgres + pgvector</Box>
          <Box>S3</Box>
          <Box>NATS JetStream</Box>
        </div>
      </div>
    </figure>
  );
}

function Box({ children }: { children: string }) {
  return (
    <span className="rounded-control border border-border bg-surface-muted px-3 py-1.5 text-fg">
      {children}
    </span>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-fg-muted">
      <ArrowDown className="size-3.5" />
      {label}
    </span>
  );
}
