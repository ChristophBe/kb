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

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** Formats a protobuf Timestamp relative to `now`, e.g. "5 min. ago"; pair it with `formatTime` in a `title`. */
export function formatRelativeTime(ts: { seconds: bigint } | undefined, now = Date.now()): string {
  if (!ts) return "";
  let value = (Number(ts.seconds) * 1000 - now) / 1000;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return "";
}
