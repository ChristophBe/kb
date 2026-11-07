import { Badge, Card, ChunkStrip, type Tone } from "@kb/ui";
import {
  CircleHelp,
  Cpu,
  FileText,
  type LucideIcon,
  MessageSquare,
  Search,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";

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
    text: "Describe what you are looking for in your own words. kb finds the passages that mean it, even when they use none of your keywords.",
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
    text: "kb splits each document into passages. Open a document to read them in order, with the page each comes from. Search results and chat sources jump straight to theirs.",
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
    text: "Not sure how something works? Ask the chat. It knows kb's own manual and links you to the section it used.",
    demo: (
      <p className="text-xs">
        <span className="font-mono text-accent">[1]</span>{" "}
        <span className="font-medium">Restrict a chat to some documents</span>
        <span className="ml-2 font-mono text-fg-muted">user manual</span>
      </p>
    ),
  },
];

/** The six things kb does, each with a small piece of its UI. */
export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="px-4 py-20 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionTitle
          id="features-title"
          eyebrow="Features"
          title="Everything you know, one question away"
          text="Stop digging through folders and PDFs. kb keeps your documents in one place and lets you search them and ask them questions like you would ask a colleague who has read them all."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <span className="inline-flex size-10 items-center justify-center rounded-card bg-accent-subtle text-accent">
                  <f.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-medium">{f.title}</h3>
                <p className="flex-1 text-sm text-fg-muted">{f.text}</p>
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
    <div className="mb-10 max-w-2xl">
      <p className="mb-2 font-mono text-xs text-accent">{eyebrow}</p>
      <h2 id={id} className="text-2xl font-medium text-balance">
        {title}
      </h2>
      {text && <p className="mt-3 text-base text-pretty text-fg-muted">{text}</p>}
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
