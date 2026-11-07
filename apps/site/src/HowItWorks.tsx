import { Card } from "@kb/ui";
import {
  ArrowRight,
  Contrast,
  type LucideIcon,
  MessageSquare,
  ScanText,
  ShieldCheck,
  Upload,
  WifiOff,
} from "lucide-react";
import { SectionTitle } from "./Features.tsx";

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Upload,
    title: "Upload",
    text: "Drop your PDFs, Markdown and text files onto the upload area.",
  },
  {
    icon: ScanText,
    title: "kb reads them",
    text: "Each file is split into passages, and a local model captures what every passage means.",
  },
  {
    icon: MessageSquare,
    title: "Ask and search",
    text: "Search by meaning or ask in plain language; every answer comes with its sources.",
  },
];

const PROMISES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: WifiOff,
    title: "Nothing leaves your machine",
    text: "Documents, passages and conversations stay in your own deployment. Even the fonts are self-hosted.",
  },
  {
    icon: ShieldCheck,
    title: "Open and inspectable",
    text: "Every line of kb is on GitHub. Run it, read it, change it.",
  },
  {
    icon: Contrast,
    title: "Built for everyone",
    text: "Light and dark mode, full keyboard use, and colours that meet WCAG 2.2 AA in both.",
  },
];

/** The three steps from file to answer, and why it is safe to give kb your documents. */
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="px-4 py-20 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionTitle
          id="how-title"
          eyebrow="How it works"
          title="From a pile of files to answers in three steps"
        />
        <ol className="grid gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
          {STEPS.map((s, i) => (
            <Step key={s.title} n={i + 1} {...s} last={i === STEPS.length - 1} />
          ))}
        </ol>

        <div className="glass mt-16 rounded-panel p-6 sm:p-10">
          <h3 className="max-w-xl text-xl font-medium text-balance">
            Private by design. Your knowledge, on your hardware.
          </h3>
          <ul className="mt-8 grid gap-6 md:grid-cols-3">
            {PROMISES.map((p) => (
              <li key={p.title} className="flex gap-3">
                <p.icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="font-medium">{p.title}</p>
                  <p className="mt-1 text-sm text-fg-muted">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Step({
  n,
  icon: Icon,
  title,
  text,
  last,
}: {
  n: number;
  icon: LucideIcon;
  title: string;
  text: string;
  last: boolean;
}) {
  return (
    <>
      <li className="h-full">
        <Card className="flex h-full flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <span className="inline-flex size-10 items-center justify-center rounded-card bg-accent-subtle text-accent">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="font-mono text-xs text-fg-muted">0{n}</span>
          </div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-fg-muted">{text}</p>
        </Card>
      </li>
      {!last && (
        <li aria-hidden="true" className="hidden justify-center text-fg-muted md:flex">
          <ArrowRight className="size-5" />
        </li>
      )}
    </>
  );
}
