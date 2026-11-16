import { LlmService } from "@knowcel/llm-api/knowcel/llm/v1/llm_pb";
import { useClient, useIsPlatformAdmin, useQuery } from "@knowcel/module-sdk";
import { Card, EmptyState, ErrorMessage, Spinner } from "@knowcel/ui";
import { BarChart3 } from "lucide-react";

const DAYS = 30;
const number = new Intl.NumberFormat();

/** The tokens the models used per day, model and module over the last days:
 * everyone's for platform admins, else the signed-in user's own. */
export function Usage() {
  const client = useClient(LlmService);
  const isAdmin = useIsPlatformAdmin();
  const usage = useQuery({
    queryKey: ["llm-usage", DAYS],
    queryFn: () => client.getUsage({ days: DAYS }),
  });

  return (
    <section aria-labelledby="usage-heading" className="mt-8 max-w-2xl">
      <h2 id="usage-heading" className="mb-1 text-sm font-medium">
        Usage
      </h2>
      <p className="mb-2 text-sm text-fg-muted">
        Tokens used by chat answers in the last {DAYS} days{isAdmin ? ", by all users" : ""}.
      </p>
      <ErrorMessage error={usage.error} />
      <Card>
        {usage.isPending ? (
          <EmptyState>
            <Spinner />
          </EmptyState>
        ) : usage.data?.entries.length ? (
          <div className="overflow-x-auto">
            <table aria-labelledby="usage-heading" className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-fg-muted uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Day</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Module</th>
                  <th className="px-4 py-2 text-right font-medium">Requests</th>
                  <th className="px-4 py-2 text-right font-medium">Input</th>
                  <th className="px-4 py-2 text-right font-medium">Output</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dotted divide-border">
                {usage.data.entries.map((e) => (
                  <tr key={`${e.date}/${e.provider}/${e.model}/${e.callerModule}`}>
                    <td className="px-4 py-2 tabular-nums">{e.date}</td>
                    <td className="px-4 py-2 font-mono">{e.model}</td>
                    <td className="px-4 py-2">{e.callerModule}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {number.format(e.requests)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {number.format(e.inputTokens)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {number.format(e.outputTokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !usage.error && <EmptyState icon={BarChart3}>No usage yet.</EmptyState>
        )}
      </Card>
    </section>
  );
}
