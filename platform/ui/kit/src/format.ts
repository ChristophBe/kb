export function formatBytes(bytes: number | bigint): string {
  let n = Number(bytes);
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Formats a protobuf Timestamp (or anything with seconds) as local time. */
export function formatTime(ts: { seconds: bigint } | undefined): string {
  if (!ts) return "";
  return new Date(Number(ts.seconds) * 1000).toLocaleString();
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * Formats the time since a protobuf Timestamp in the largest whole unit, e.g.
 * "5 minutes ago", "2 days ago"; under a minute is "now".
 */
export function formatRelativeTime(
  ts: { seconds: bigint } | undefined,
  now: number = Date.now(),
): string {
  if (!ts) return "";
  const elapsed = Math.max(0, now / 1000 - Number(ts.seconds));
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (elapsed >= seconds) return format.format(-Math.floor(elapsed / seconds), unit);
  }
  return format.format(0, "second");
}
