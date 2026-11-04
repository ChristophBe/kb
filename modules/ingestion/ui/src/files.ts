// Mirrors extract_pages in modules/ingestion/worker/src/kb_ingestion_worker/extract.py;
// change both together.
const TEXT_SUFFIXES = [
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".rst",
];

export const SUPPORTED_FORMATS = "PDF, Markdown or plain text";

/** Whether the worker can extract text from the file, judged before any upload. */
export function isSupported(file: { name: string; type: string }): boolean {
  const dot = file.name.lastIndexOf(".");
  const suffix = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (file.type === "application/pdf" || suffix === ".pdf") return true;
  return file.type.startsWith("text/") || TEXT_SUFFIXES.includes(suffix);
}
