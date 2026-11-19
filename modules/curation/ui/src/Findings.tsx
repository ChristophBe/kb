import {
  CurationService,
  type Finding,
  FindingKind,
  type Lifecycle,
  LifecycleState,
  type Report,
  Resolution,
  type ResolutionOption,
} from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import {
  keepPreviousData,
  toast,
  useClient,
  useCurrentUser,
  useInfiniteQuery,
  useModuleEnabled,
  useMutation,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import {
  Badge,
  Button,
  brandText,
  Card,
  CheckCircle2,
  ConfirmDialog,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  formatTime,
  PageHeader,
  SkeletonRows,
  type Tone,
} from "@knowcel/ui";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { findingIsGone, findingsError, resolveError } from "./errors.ts";
import { STATES, stateInfo } from "./lifecycle/states.ts";
import { useUserNames } from "./lifecycle/useUserNames.ts";
import { reasonLabel } from "./reports/reasons.ts";

const PAGE_SIZE = 25;
// ScoreChunks takes at most this many documents at once.
const SCORE_BATCH = 100;

const KINDS: Record<number, { label: string; tone: Tone }> = {
  [FindingKind.DUPLICATE]: { label: "Duplicate", tone: "neutral" },
  [FindingKind.SUPERSEDED]: { label: "Newer version", tone: "info" },
  [FindingKind.CONFLICT]: { label: "Conflict", tone: "danger" },
  [FindingKind.REVIEW_DUE]: { label: "Review due", tone: "warning" },
  [FindingKind.REPORTED]: { label: "Reported", tone: "warning" },
};

const RESOLUTIONS: Record<number, string> = {
  [Resolution.KEEP]: "Keep",
  [Resolution.REPLACE]: "Replace",
  [Resolution.IGNORE]: "Ignore",
  [Resolution.DEPRECATE]: "Deprecate",
};

/** What a button that closes a finding says; reports have words of their own. */
function optionLabel(kind: FindingKind, resolution: Resolution): string {
  if (kind === FindingKind.REPORTED) {
    if (resolution === Resolution.IGNORE) return "Dismiss reports";
    if (resolution === Resolution.DEPRECATE) return "Deprecate document";
  }
  return RESOLUTIONS[resolution] ?? "";
}

/** The toast after a finding was closed. */
function resolvedMessage(finding: Finding, resolution: Resolution): string {
  switch (resolution) {
    case Resolution.KEEP:
      return `Kept ${finding.documentTitle}`;
    case Resolution.REPLACE:
      return `${finding.otherDocumentTitle} now replaces ${finding.documentTitle}`;
    case Resolution.DEPRECATE:
      return `${finding.documentTitle} deprecated`;
    default:
      return finding.kind === FindingKind.REPORTED ? "Reports dismissed" : "Finding ignored";
  }
}

/** Replacing and deprecating change how a document ranks, so they ask first. */
function asksFirst(resolution: Resolution): boolean {
  return resolution === Resolution.REPLACE || resolution === Resolution.DEPRECATE;
}

interface Choice {
  finding: Finding;
  option: ResolutionOption;
}

/**
 * The findings about the user's documents (duplicates, newer versions,
 * contradictions, reviews that are due), each with the ways to close it.
 */
export function Findings() {
  const client = useClient(CurationService);
  const queryClient = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState<Choice | null>(null);
  // What the dialog showed last, so it keeps its words while it closes.
  const shown = useRef<Choice | null>(null);
  if (confirming) shown.current = confirming;
  const [failures, setFailures] = useState<Record<string, Error>>({});
  // Narrow the findings loaded to those due for review, or about documents in one approval state.
  const [reviewOnly, setReviewOnly] = useState(false);
  const [stateFilter, setStateFilter] = useState<LifecycleState>(LifecycleState.UNSPECIFIED);
  // The findings being closed; each can only be closed once at a time.
  const [closing, setClosing] = useState<ReadonlySet<string>>(new Set());

  const findings = useInfiniteQuery({
    queryKey: ["findings", { reviewOnly }],
    // Narrowing the list keeps what is shown until the narrowed list is there.
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      client.listFindings({
        pageSize: PAGE_SIZE,
        pageToken: pageParam,
        kinds: reviewOnly ? [FindingKind.REVIEW_DUE] : [],
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextPageToken || undefined,
  });
  const loaded = findings.data?.pages.flatMap((p) => p.findings) ?? [];
  const documentIds = [...new Set(loaded.map((f) => f.documentId))].sort();
  const scores = useQuery({
    queryKey: ["finding-scores", documentIds],
    enabled: documentIds.length > 0,
    // The scores shown stay while those of a longer list load.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const found = new Map<string, { score: number; lifecycle?: Lifecycle }>();
      for (let i = 0; i < documentIds.length; i += SCORE_BATCH) {
        const { scores } = await client.scoreChunks({
          documentIds: documentIds.slice(i, i + SCORE_BATCH),
        });
        for (const s of scores) found.set(s.documentId, { score: s.score, lifecycle: s.lifecycle });
      }
      return found;
    },
  });

  const filtered = reviewOnly || stateFilter !== LifecycleState.UNSPECIFIED;
  // The states come with the scores, so the list can only be narrowed by one once they are known.
  const byState = stateFilter !== LifecycleState.UNSPECIFIED;
  const items = loaded.filter(
    (f) => !byState || scores.data?.get(f.documentId)?.lifecycle?.state === stateFilter,
  );
  // A page can hold none of the findings the user may see, or none the filters let through,
  // and still have a next one.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = findings;
  useEffect(() => {
    const ready = !byState || scores.isSuccess;
    if (
      ready &&
      items.length === 0 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError
    ) {
      void fetchNextPage();
    }
  }, [
    byState,
    scores.isSuccess,
    items.length,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  const resolve = useMutation({
    mutationFn: ({ finding, option }: Choice) =>
      client.resolveFinding({ findingId: finding.id, resolution: option.resolution }),
    onMutate: ({ finding }) => setClosing((c) => new Set(c).add(finding.id)),
    onSettled: (_data, _err, { finding }) =>
      setClosing((c) => {
        const rest = new Set(c);
        rest.delete(finding.id);
        return rest;
      }),
    onSuccess: async (_, { finding, option }) => {
      setConfirming((c) => (c?.finding.id === finding.id ? null : c));
      toast.success(resolvedMessage(finding, option.resolution));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["findings"] }),
        queryClient.invalidateQueries({ queryKey: ["finding-scores"] }),
      ]);
      // The row the focus was on is gone: leave it at the top of the list, not on <body>.
      heading.current?.focus();
    },
    onError: async (err, { finding }) => {
      const failure = resolveError(err) ?? new Error("Failed");
      if (findingIsGone(err)) {
        // Its row is about to leave the list, so say it in a toast and close the dialog.
        setConfirming((c) => (c?.finding.id === finding.id ? null : c));
        toast.error(failure.message);
        await queryClient.invalidateQueries({ queryKey: ["findings"] });
        return;
      }
      setFailures((f) => ({ ...f, [finding.id]: failure }));
    },
  });

  const choose = (choice: Choice) => {
    if (closing.has(choice.finding.id)) return;
    setFailures((f) => {
      const { [choice.finding.id]: _, ...rest } = f;
      return rest;
    });
    // Replacing or deprecating makes the document rank lower in answers, so it asks first.
    if (asksFirst(choice.option.resolution)) setConfirming(choice);
    else resolve.mutate(choice);
  };

  return (
    <div>
      <PageHeader
        eyebrow={brandText("knowcelium / checks")}
        title="Document checks"
        description="Documents that repeat, replace or contradict each other, documents that are due for review and documents people have reported. Close a finding to keep answers consistent."
      />
      <h2 ref={heading} tabIndex={-1} className="sr-only">
        Findings
      </h2>
      {(loaded.length > 0 || filtered) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex min-h-6 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={reviewOnly}
              onChange={(e) => setReviewOnly(e.target.checked)}
            />
            Review due only
          </label>
          <label className="flex items-center gap-2 text-sm">
            Approval state
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(Number(e.target.value))}
              className="rounded-control border border-border-strong bg-surface px-2 py-1.5 text-sm hover:border-fg-muted"
            >
              <option value={LifecycleState.UNSPECIFIED}>Any</option>
              {STATES.map(({ state, info }) => (
                <option key={state} value={state}>
                  {info.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {findings.isPending ? (
        <DelayedLoading>
          <SkeletonRows label="Loading findings" />
        </DelayedLoading>
      ) : findings.error ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorMessage error={findingsError(findings.error)} />
          <Button variant="secondary" onClick={() => void findings.refetch()}>
            Try again
          </Button>
        </div>
      ) : items.length > 0 ? (
        <>
          <ul aria-label="Findings" className="flex flex-col gap-4">
            {items.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                score={scores.data?.get(f.documentId)?.score}
                lifecycle={scores.data?.get(f.documentId)?.lifecycle}
                pending={closing.has(f.id)}
                failure={failures[f.id]}
                onChoose={choose}
              />
            ))}
          </ul>
          {hasNextPage && (
            <div className="mt-4">
              <Button
                variant="secondary"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      ) : byState && scores.isError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorMessage
            error={new Error("Approval states aren't available right now. Try again in a moment.")}
          />
          <Button variant="secondary" onClick={() => void scores.refetch()}>
            Try again
          </Button>
        </div>
      ) : hasNextPage || isFetchingNextPage ? (
        <DelayedLoading>
          <SkeletonRows label="Loading findings" />
        </DelayedLoading>
      ) : filtered ? (
        <EmptyState
          icon={CheckCircle2}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setReviewOnly(false);
                setStateFilter(LifecycleState.UNSPECIFIED);
              }}
            >
              Show all findings
            </Button>
          }
        >
          {reviewOnly && stateFilter === LifecycleState.UNSPECIFIED
            ? "No documents need review."
            : "No findings match these filters."}
        </EmptyState>
      ) : (
        <EmptyState icon={CheckCircle2}>No findings. Your documents look consistent.</EmptyState>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={`${shown.current?.option.resolution === Resolution.DEPRECATE ? "Deprecate" : "Replace"} ${shown.current?.finding.documentTitle ?? ""}?`}
        confirmLabel={
          shown.current?.option.resolution === Resolution.DEPRECATE
            ? "Deprecate document"
            : "Replace document"
        }
        pending={resolve.isPending}
        error={confirming ? failures[confirming.finding.id]?.message : undefined}
        onConfirm={() => confirming && resolve.mutate(confirming)}
        onCancel={() => setConfirming(null)}
        fallbackFocus={heading}
      >
        <p>{shown.current?.option.description}</p>
        {shown.current?.option.resolution === Resolution.DEPRECATE && (
          <p className="mt-2">
            Chat stops using this document in its answers and sources. You can change its approval
            state again later.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function FindingCard({
  finding: f,
  score,
  lifecycle,
  pending,
  failure,
  onChoose,
}: {
  finding: Finding;
  score: number | undefined;
  lifecycle: Lifecycle | undefined;
  pending: boolean;
  failure: Error | undefined;
  onChoose: (choice: Choice) => void;
}) {
  const kind = KINDS[f.kind];
  const id = useId();
  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {kind && <Badge tone={kind.tone}>{kind.label}</Badge>}
          {lifecycle && stateInfo(lifecycle.state) && (
            <Badge tone={stateInfo(lifecycle.state)?.tone}>
              {stateInfo(lifecycle.state)?.label}
            </Badge>
          )}
          <h3 className="min-w-0 font-medium wrap-anywhere">{f.summary}</h3>
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          {f.otherDocumentId === f.documentId || f.otherDocumentId === "" ? (
            <DocumentLink id={f.documentId}>{f.documentTitle}</DocumentLink>
          ) : (
            <>
              <DocumentLink id={f.documentId}>{f.documentTitle}</DocumentLink> and{" "}
              <DocumentLink id={f.otherDocumentId}>{f.otherDocumentTitle}</DocumentLink>
            </>
          )}
          {" · "}
          Found {formatTime(f.createdAt)}
          {score !== undefined && ` · Relevance ${Math.round(score * 100)} %`}
        </p>
        {f.reports.length > 0 && <ReportList reports={f.reports} />}
        <ul className="mt-3 flex flex-col gap-2">
          {f.resolutions
            .filter((o) => o.resolution in RESOLUTIONS)
            .map((option) => {
              const describedBy = `${id}-${option.resolution}`;
              return (
                <li
                  key={option.resolution}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <Button
                    variant="secondary"
                    disabled={pending}
                    aria-describedby={describedBy}
                    aria-label={`${optionLabel(f.kind, option.resolution)} ${f.documentTitle}`}
                    onClick={() => onChoose({ finding: f, option })}
                  >
                    {optionLabel(f.kind, option.resolution)}
                  </Button>
                  <span id={describedBy} className="min-w-0 flex-1 text-sm text-fg-muted">
                    {option.description}
                  </span>
                </li>
              );
            })}
        </ul>
        {failure && (
          <div className="mt-3">
            <ErrorMessage error={failure} />
          </div>
        )}
      </Card>
    </li>
  );
}

/** The reports of a document the viewer may see, each with its reason, who and when. */
function ReportList({ reports }: { reports: Report[] }) {
  const user = useCurrentUser();
  const names = useUserNames();
  const who = (id: string) => (id === user?.id ? "you" : (names.get(id) ?? "another user"));
  return (
    <ul aria-label="Reports" className="mt-3 flex flex-col gap-2 border-l-2 border-border pl-3">
      {reports.map((r) => (
        <li key={r.reporter} className="text-sm">
          <span className="font-medium">{reasonLabel(r.reason) ?? "Other"}</span>
          <span className="text-fg-muted">
            {" · "}by {who(r.reporter)}
            {r.createdAt && ` · ${formatTime(r.createdAt)}`}
          </span>
          {r.comment && <p className="mt-0.5 wrap-anywhere">{r.comment}</p>}
        </li>
      ))}
    </ul>
  );
}

/** A link to the document, or only its title while the document module is off. */
function DocumentLink({ id, children }: { id: string; children: ReactNode }) {
  const enabled = useModuleEnabled("document");
  if (!enabled) return <span className="font-medium text-fg">{children}</span>;
  return (
    <Link to={`/m/document/${id}`} className="font-medium text-accent hover:underline">
      {children}
    </Link>
  );
}
