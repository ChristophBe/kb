import { cn, SourceNote } from "@kb/ui";
import { ArrowUp } from "lucide-react";
import { Fragment, useState } from "react";
import { delay } from "./links.ts";

type Source = { title: string; detail: string; snippet: string };

const QUESTION = "How long can I work remotely from abroad, and who has to approve it?";

/** The answer as text runs and citation numbers, so it can stream in word by word. */
const ANSWER: (string | number)[] = [
  "You can work from abroad for up to 30 working days per calendar year",
  1,
  ". Each stay needs your team lead's approval at least two weeks before you travel, and stays longer than 10 days also need a check by HR",
  2,
  ". Both policies apply to every country outside the EU.",
];

const SOURCES: Source[] = [
  {
    title: "Remote work policy 2026",
    detail: "chunk 4",
    snippet:
      "Employees may work from a country other than their country of employment for a maximum of 30 working days per calendar year…",
  },
  {
    title: "Travel & approvals handbook",
    detail: "chunk 12",
    snippet:
      "Requests are approved by the team lead no later than 14 days before departure. Stays over 10 days are additionally reviewed by HR…",
  },
];

/** How long each streamed word takes to appear. */
const WORD_MS = 45;
const ANSWER_START_MS = 700;

/**
 * A chat exchange as kb shows it: the question, an answer with citation
 * numbers and the sources beside it. Numbers and sources highlight each other
 * on hover and focus, as in the app. The answer streams in with CSS only, so
 * the prerendered page already contains all of it.
 */
export function ChatDemo() {
  const [active, setActive] = useState<number | null>(null);
  let word = 0;
  const words = ANSWER.map((part, i) => {
    if (typeof part === "number") {
      const n = part;
      const source = SOURCES[n - 1];
      return (
        <button
          key={i}
          type="button"
          aria-label={`Source ${n}: ${source?.title}, ${source?.detail}`}
          className={cn(
            "mx-0.5 animate-stream rounded-sm px-0.5 font-mono text-xs text-accent hover:underline",
            active === n && "bg-accent-subtle",
          )}
          style={delay(ANSWER_START_MS + WORD_MS * word++)}
          onMouseEnter={() => setActive(n)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(n)}
          onBlur={() => setActive(null)}
          onClick={() => setActive(n)}
        >
          [{n}]
        </button>
      );
    }
    return (
      <Fragment key={i}>
        {part.split(/(?= )/).map((w, j) => (
          <span
            key={j}
            className="animate-stream"
            style={delay(ANSWER_START_MS + WORD_MS * word++)}
          >
            {w}
          </span>
        ))}
      </Fragment>
    );
  });
  const sourcesAt = ANSWER_START_MS + WORD_MS * word;

  return (
    <figure className="glass relative flex flex-col gap-4 rounded-panel p-4 text-left sm:p-6">
      <figcaption className="flex items-center gap-2 font-mono text-xs text-fg-muted">
        <span className="flex gap-1" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </span>
        <span className="ml-2">kb / chat — an example answer</span>
      </figcaption>

      <div className="flex justify-end">
        <p className="max-w-[85%] animate-rise rounded-card bg-accent-subtle px-4 py-2 text-base">
          {QUESTION}
        </p>
      </div>

      <div className="@container rounded-card border border-border bg-surface px-4 py-3 text-base">
        <div className="grid gap-x-6 gap-y-4 @xl:grid-cols-[minmax(0,1fr)_13rem]">
          <p className="min-w-0">{words}</p>
          <ul aria-label="Sources" className="animate-rise space-y-3" style={delay(sourcesAt)}>
            {SOURCES.map((s, i) => (
              <SourceNote
                key={s.title}
                n={i + 1}
                title={
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onMouseEnter={() => setActive(i + 1)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i + 1)}
                    onBlur={() => setActive(null)}
                  >
                    {s.title}
                  </button>
                }
                detail={s.detail}
                snippet={s.snippet}
                active={active === i + 1}
              />
            ))}
          </ul>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="glass-strong flex items-center gap-3 rounded-panel py-2 pr-2 pl-5 text-base text-fg-muted"
      >
        <span className="flex-1">Ask something…</span>
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent text-on-accent">
          <ArrowUp className="size-4" />
        </span>
      </div>
    </figure>
  );
}
