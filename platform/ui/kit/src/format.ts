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
