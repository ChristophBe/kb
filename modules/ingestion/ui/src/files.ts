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

/**
 * The file's SHA-256 in hex, which the server checks the upload against. Empty
 * where Web Crypto is missing (pages served over plain HTTP from another host
 * than localhost); the checksum is optional.
 */
export async function sha256(file: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(await read(file)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Blob.arrayBuffer, by FileReader, which every environment has (jsdom lacks the former). */
function read(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
