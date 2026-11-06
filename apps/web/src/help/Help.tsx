import { Card, EmptyState, headingSlug, PageHeader, PageTitle } from "@kb/ui";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import { Link, useLocation, useParams } from "react-router";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { helpHref, type ManualPage, manualPages } from "./manual.ts";

const PROSE =
  "max-w-3xl space-y-3 leading-relaxed break-words [&_code]:font-mono [&_code]:text-sm [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-6";

/** The list of manual pages at /help. */
export function HelpIndex() {
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="kb / help" title="Help" description="How to use kb, by area." />
      <ul className="grid gap-3">
        {manualPages.map((p) => (
          <li key={p.slug}>
            <Link to={`/help/${p.slug}`} className="block rounded-card">
              <Card className="p-5 transition-[translate,box-shadow] hover:-translate-y-0.5 hover:shadow-glass">
                <span className="font-medium">{p.title}</span>
                {p.summary && <p className="mt-1 text-sm text-fg-muted">{p.summary}</p>}
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One manual page at /help/<page>, scrolled to the section in the URL hash. */
export function HelpPage() {
  const { page } = useParams();
  const { hash } = useLocation();
  const manual = manualPages.find((p) => p.slug === page);

  useEffect(() => {
    if (!manual || !hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    target.focus({ preventScroll: true });
  }, [manual, hash]);

  if (!manual) {
    return (
      <div className="max-w-3xl space-y-4">
        <BackLink />
        <EmptyState>There is no help page "{page}".</EmptyState>
      </div>
    );
  }
  return (
    <article className="max-w-3xl">
      <BackLink />
      <ManualMarkdown page={manual} />
    </article>
  );
}

function BackLink() {
  return (
    <Link
      to="/help"
      className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-muted hover:text-fg"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" /> All help pages
    </Link>
  );
}

/** The plain text of a heading's syntax tree. */
function textOf(node: ExtraProps["node"]): string {
  if (!node) return "";
  return node.children
    .map((c) => (c.type === "text" ? c.value : c.type === "element" ? textOf(c) : ""))
    .join("");
}

function Section({ level, node, children }: { level: 2 | 3; children?: ReactNode } & ExtraProps) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag
      id={headingSlug(textOf(node))}
      // Focusable so a deep link moves screen readers to the section too.
      tabIndex={-1}
      className={
        level === 2
          ? "mt-10 scroll-mt-8 text-lg font-medium text-fg outline-none"
          : "mt-6 scroll-mt-8 font-medium text-fg outline-none"
      }
    >
      {children}
    </Tag>
  );
}

const components: Components = {
  h1: ({ children }) => <PageTitle className="mb-4">{children}</PageTitle>,
  h2: (props) => <Section level={2} {...props} />,
  h3: (props) => <Section level={3} {...props} />,
  a: ({ href = "", children }) => {
    const to = helpHref(href);
    if (to.startsWith("/help") || to.startsWith("#")) {
      return (
        <Link to={to} className="text-accent underline underline-offset-2">
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {children}
      </a>
    );
  },
};

function ManualMarkdown({ page }: { page: ManualPage }) {
  return (
    <div className={PROSE}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {page.markdown}
      </Markdown>
    </div>
  );
}
