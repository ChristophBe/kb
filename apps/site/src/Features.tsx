import { Badge, Card, ChunkStrip, type Tone } from "@knowcel/ui";
import {
  CircleHelp,
  Cpu,
  Download,
  FileText,
  type LucideIcon,
  MessageSquare,
  RefreshCw,
  Search,
  Share2,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { DotGrid } from "./Graphics.tsx";

type Feature = { icon: LucideIcon; title: string; text: string; demo: ReactNode };

const FEATURES: Feature[] = [
  {
    icon: MessageSquare,
    title: "Answers you can check",
    text: "Every answer cites the passages it is based on. Point at a number to see its source; select it to open the document right at that passage.",
    demo: (
      <p className="text-sm">
        Up to 30 days a year
        <Marker n={1} />, approved two weeks ahead
        <Marker n={2} />.
      </p>
    ),
  },
  {
    icon: Search,
    title: "Search by meaning",
    text: "Describe what you are looking for in your own words. Knowcelium finds the passages that mean it, even when they use none of your keywords.",
    demo: (
      <ul className="space-y-1.5 text-xs">
        <SearchHit title="Remote work policy 2026" chunk={4} score={0.82} />
        <SearchHit title="Travel & approvals handbook" chunk={12} score={0.74} />
        <SearchHit title="Onboarding guide" chunk={7} score={0.61} />
      </ul>
    ),
  },
  {
    icon: Upload,
    title: "Drop in your files",
    text: "Drag PDFs, Markdown or text files onto the page and follow each one until it is ready. When something fails, one click retries it.",
    demo: (
      <ul className="space-y-1.5 text-xs">
        <UploadRow name="handbook.pdf" status="Done" tone="success" />
        <UploadRow name="meeting-notes.md" status="Processing" tone="info" />
        <UploadRow name="pricing-2026.txt" status="Queued" tone="neutral" />
      </ul>
    ),
  },
  {
    icon: FileText,
    title: "Read every passage",
    text: "Knowcelium splits each document into passages. Open a document to read them in order, with the page each comes from. Search results and chat sources jump straight to theirs.",
    demo: <ChunkStrip count={42} />,
  },
  {
    icon: Cpu,
    title: "Local language models",
    text: "Search and chat run on Ollama on your own hardware by default. No API keys, no per-question bill, and nothing is sent to a cloud.",
    demo: (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="success">healthy</Badge>
        <span className="font-mono text-fg-muted">llama3.2</span>
        <span className="font-mono text-fg-muted">nomic-embed-text</span>
      </div>
    ),
  },
  {
    icon: CircleHelp,
    title: "Help that answers back",
    text: "Not sure how something works? Ask the chat. It knows Knowcelium's own manual and links you to the section it used.",
    demo: (
      <p className="text-xs">
        <span className="font-mono text-accent">[1]</span>{" "}
        <span className="font-medium">Restrict a chat to some documents</span>
        <span className="ml-2 font-mono text-fg-muted">user manual</span>
      </p>
    ),
  },
];

/** The three pillars, then the six things Knowcelium does today, each with a small piece of its UI. */
export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="relative isolate px-4 py-24 sm:px-8"
    >
      <DotGrid />
      <div className="mx-auto max-w-6xl">
        <SectionTitle
          id="features-title"
          eyebrow="Features"
          title="One backbone for what your organization knows"
          text="Stop digging through folders and PDFs. Knowcelium takes in your documents, makes them searchable and answers questions like a colleague who has read them all."
        />
        <Pillars />
        <h3 className="mt-20 mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
          What you can do today
        </h3>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <span className="inline-flex size-10 items-center justify-center rounded-card bg-accent-subtle text-accent">
                  <f.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="text-xl font-semibold tracking-tight">{f.title}</h3>
                <p className="flex-1 text-base text-fg-muted">{f.text}</p>
                <div
                  aria-hidden="true"
                  className="mt-2 rounded-control border border-border bg-canvas p-3"
                >
                  {f.demo}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const PILLARS: { icon: LucideIcon; title: string; text: string; roadmap?: boolean }[] = [
  {
    icon: Download,
    title: "Absorb",
    text: "Ingest documents today, with connectors to the systems you already use to come.",
  },
  {
    icon: Share2,
    title: "Connect",
    text: "Search by meaning, chat with sources, and an API for your other systems.",
  },
  {
    icon: RefreshCw,
    title: "Renew",
    text: "Curation and content generation tied to their sources.",
    roadmap: true,
  },
];

/** The three pillars; Renew is not built yet and says so. */
function Pillars() {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {PILLARS.map((p) => (
        <li key={p.title}>
          <Card className="flex h-full flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <span className="inline-flex size-10 items-center justify-center rounded-card bg-accent-subtle text-accent">
                <p.icon className="size-5" aria-hidden="true" />
              </span>
              {p.roadmap && <Badge tone="info">On the roadmap</Badge>}
            </div>
            <h3 className="text-xl font-semibold tracking-tight">{p.title}</h3>
            <p className="text-base text-fg-muted">{p.text}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** A section heading: mono eyebrow, title and a sentence or two. */
export function SectionTitle({
  id,
  eyebrow,
  title,
  text,
}: {
  id: string;
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="mb-12 max-w-4xl">
      <p className="mb-3 font-mono text-sm tracking-wide text-accent uppercase">{eyebrow}</p>
      <h2 id={id} className="font-bold text-balance text-3xl sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {text && <p className="mt-4 text-lg text-pretty text-fg-muted">{text}</p>}
    </div>
  );
}

function Marker({ n }: { n: number }) {
  return <span className="mx-0.5 font-mono text-xs text-accent">[{n}]</span>;
}

function SearchHit({ title, chunk, score }: { title: string; chunk: number; score: number }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      <span className="font-mono text-fg-muted">chunk {chunk}</span>
      <span className="font-mono text-accent tabular-nums">{score.toFixed(2)}</span>
    </li>
  );
}

function UploadRow({ name, status, tone }: { name: string; status: string; tone: Tone }) {
  return (
    <li className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      <Badge tone={tone}>{status}</Badge>
    </li>
  );
}
