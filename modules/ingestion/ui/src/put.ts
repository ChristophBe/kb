/** Why a file didn't reach the bucket; `expired` asks for a new upload URL. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly expired = false,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Uploads a file to a presigned URL, reporting progress as a fraction from 0 to 1.
 * The URL is signed for `contentType`, which must be sent as the Content-Type.
 */
export type Put = (
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
) => Promise<void>;

/** XMLHttpRequest, because fetch can't report upload progress. */
export const putWithProgress: Put = (url, file, contentType, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      // S3 answers a presigned URL past its expiry with 403 (also one sent with
      // another size or type than signed, which this client never does).
      else if (xhr.status === 403) reject(new UploadError("the upload link expired", true));
      else reject(new UploadError(`the storage server answered ${xhr.status}`));
    };
    xhr.onerror = () => reject(new UploadError("connection lost"));
    xhr.onabort = () => reject(new DOMException("upload cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
