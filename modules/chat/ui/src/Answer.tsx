import type { Citation } from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { Slot } from "@knowcel/module-sdk";
import { Check, ChevronLeft, Copy, cn, IconButton, SourceNote } from "@knowcel/ui";
import { type ComponentProps, useCallback, useId, useMemo, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import { Link } from "react-router";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const CITATION_HREF = "#citation-";
const MARKER = /\[(\d+)\]/g;

/** The part of an mdast node this file looks at. */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/**
 * Turns `[n]` in prose into links to source n. It works on the syntax tree, so
 * `[1]` in code stays code; numbers without a source stay plain text.
 */
export function remarkCitations({ count }: { count: number }) {
  const split = (value: string): MdNode[] => {
    const nodes: MdNode[] = [];
    let last = 0;
    for (const match of value.matchAll(MARKER)) {
      const n = Number(match[1]);
      if (n < 1 || n > count) continue;
      if (match.index > last) nodes.push({ type: "text", value: value.slice(last, match.index) });
      nodes.push({
        type: "link",
        url: `${CITATION_HREF}${n}`,
        children: [{ type: "text", value: match[0] }],
      });
      last = match.index + match[0].length;
    }
    if (last < value.length) nodes.push({ type: "text", value: value.slice(last) });
    return nodes;
  };
  const walk = (node: MdNode) => {
    if (!node.children || node.type === "link") return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text") return split(child.value ?? "");
      walk(child);
      return [child];
    });
  };
  return walk;
}

/** Where a source opens: its section of the user manual, or its passage in the document. */
function sourcePath(c: Citation) {
  if (c.manualPage) return `/help/${c.manualPage}#${c.manualSection}`;
  return `/m/document/${c.documentId}#chunk-${c.chunkIndex}`;
}

/** What the source is within its title: "user manual" or the passage, numbered from 1 as in search. */
function sourceDetail(c: Citation) {
  return c.manualPage ? "user manual" : `passage ${c.chunkIndex + 1}`;
}

function citationName(n: number, c: Citation) {
  return `Source ${n}: ${c.documentTitle}, ${sourceDetail(c)}`;
}

function CodeBlock(props: ComponentProps<"pre">) {
  const code = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code.current?.textContent ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative">
      <pre ref={code} {...props} />
      <IconButton
        label={copied ? "Copied" : "Copy code"}
        onClick={copy}
        className="absolute top-1 right-1 hover:bg-surface"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </IconButton>
    </div>
  );
}

function ScrollableTable(props: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  );
}

const PROSE =
  "min-w-0 space-y-2 break-words [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted [&_code]:font-mono [&_code]:text-xs [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-surface-muted [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5";

/** Lets a marker and its note highlight each other on hover and focus. */
function useHighlight() {
  const [active, setActive] = useState<number | null>(null);
  const linked = useCallback(
    (n: number) => ({
      onMouseEnter: () => setActive(n),
      onMouseLeave: () => setActive(null),
      onFocus: () => setActive(n),
      onBlur: () => setActive(null),
    }),
    [],
  );
  return { active, linked };
}

export function Answer({
  content,
  citations,
  conversationId,
  streaming = false,
}: {
  content: string;
  citations: Citation[];
  /** Given to what other modules add to the sources. */
  conversationId?: string;
  /** The answer isn't final yet: its sources are not listed until they are. */
  streaming?: boolean;
}) {
  const { active, linked } = useHighlight();
  const groups = useMemo(() => groupSources(citations), [citations]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (key: string, expand?: boolean) =>
      setOpen((current) => {
        const next = new Set(current);
        if (expand ?? !next.has(key)) next.add(key);
        else next.delete(key);
        return next;
      }),
    [],
  );

  // Stable across highlight changes: new components would remount the links and drop focus.
  const components = useMemo<Components>(
    () => ({
      pre: CodeBlock,
      table: ScrollableTable,
      a: ({ href, children }) => {
        const n = href?.startsWith(CITATION_HREF) ? Number(href.slice(CITATION_HREF.length)) : 0;
        const citation = citations[n - 1];
        if (citation) {
          return (
            <Link
              to={sourcePath(citation)}
              aria-label={citationName(n, citation)}
              className="font-mono text-xs hover:underline"
              onClick={() => toggle(groupKey(citation), true)}
              {...linked(n)}
            >
              {children}
            </Link>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer" className="underline">
            {children}
          </a>
        );
      },
    }),
    [citations, linked, toggle],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={PROSE}>
        <Markdown
          remarkPlugins={[remarkGfm, [remarkCitations, { count: citations.length }]]}
          rehypePlugins={[rehypeSanitize]}
          components={components}
        >
          {content}
        </Markdown>
      </div>
      {!streaming && groups.length > 0 && (
        <ul aria-label="Sources" className="space-y-1 border-t border-border pt-2">
          {groups.map((group) => (
            <SourceGroupRow
              key={group.key}
              group={group}
              open={open.has(group.key)}
              onToggle={() => toggle(group.key)}
              active={active}
              linked={linked}
              conversationId={conversationId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The passages an answer used from one document, or from the user manual as a whole. */
interface SourceGroup {
  key: string;
  title: string;
  manual: boolean;
  /** Each with its number in the answer. */
  passages: { n: number; citation: Citation }[];
}

const groupKey = (c: Citation) => (c.manualPage ? "user-manual" : `document-${c.documentId}`);

/** One group per document, in the order the answer first uses them; manual sections share one. */
function groupSources(citations: Citation[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  citations.forEach((citation, i) => {
    const key = groupKey(citation);
    const manual = Boolean(citation.manualPage);
    let group = groups.get(key);
    if (!group) {
      group = { key, title: manual ? "User manual" : citation.documentTitle, manual, passages: [] };
      groups.set(key, group);
    }
    group.passages.push({ n: i + 1, citation });
  });
  return [...groups.values()];
}

function SourceGroupRow({
  group,
  open,
  onToggle,
  active,
  linked,
  conversationId,
}: {
  group: SourceGroup;
  open: boolean;
  onToggle: () => void;
  active: number | null;
  linked: ReturnType<typeof useHighlight>["linked"];
  conversationId?: string;
}) {
  const listId = useId();
  const count = group.passages.length;
  const unit = group.manual ? "section" : "passage";
  const highlighted = group.passages.some((p) => p.n === active);
  return (
    <li
      className={cn(
        "border-l-2 pl-3 text-xs transition-colors",
        highlighted ? "border-accent" : "border-border",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
      >
        <ChevronLeft
          className={cn("size-4 shrink-0 transition-transform", open ? "-rotate-90" : "rotate-180")}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 font-medium wrap-anywhere text-fg">{group.title}</span>
        <span className="shrink-0 font-mono text-fg-muted">
          {count} {unit}
          {count === 1 ? "" : "s"}
        </span>
      </button>
      <ul id={listId} hidden={!open} className="space-y-3 pb-2">
        {group.passages.map(({ n, citation: c }) => (
          <SourceNote
            key={
              c.manualPage
                ? `${c.manualPage}#${c.manualSection}`
                : `${c.documentId}-${c.chunkIndex}`
            }
            n={n}
            active={active === n}
            detail={sourceDetail(c)}
            snippet={c.snippet}
            title={<SourceLink citation={c} {...linked(n)} />}
            // Only documents can be acted on, not sections of the user manual.
            actions={
              c.manualPage ? undefined : (
                <Slot
                  name="chat.citation.actions"
                  documentId={c.documentId}
                  chunkIndex={c.chunkIndex}
                  conversationId={conversationId}
                />
              )
            }
          />
        ))}
      </ul>
    </li>
  );
}

function SourceLink({
  citation,
  ...handlers
}: { citation: Citation } & Omit<ComponentProps<typeof Link>, "to">) {
  return (
    <Link
      to={sourcePath(citation)}
      aria-label={`${citation.documentTitle}, ${sourceDetail(citation)}`}
      className="hover:underline"
      {...handlers}
    >
      {citation.documentTitle}
    </Link>
  );
}
