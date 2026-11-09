import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

/** One invalid field of a request (google.rpc.BadRequest.FieldViolation). */
export interface FieldViolation {
  /** The field's path in the request message, e.g. "title" or "document_ids[2]". */
  field: string;
  /** A sentence a user can act on, e.g. "Title must not be empty". */
  description: string;
}

/** An error detail as a ConnectError holds it after decoding the grpc-status-details-bin trailer. */
interface IncomingDetail {
  type: string;
  value: Uint8Array;
}

/** Why a request failed (google.rpc.ErrorInfo), for clients to branch on. */
export interface ErrorInfo {
  /** A stable UPPER_SNAKE_CASE identifier, e.g. "LLM_UNAVAILABLE". */
  reason: string;
  /** The proto package of the module that defines `reason`, e.g. "kb.document.v1". */
  domain: string;
  metadata: Record<string, string>;
}

const BAD_REQUEST = "google.rpc.BadRequest";
const ERROR_INFO = "google.rpc.ErrorInfo";

function isIncomingDetail(d: unknown): d is IncomingDetail {
  return (
    typeof d === "object" &&
    d !== null &&
    typeof (d as IncomingDetail).type === "string" &&
    (d as IncomingDetail).value instanceof Uint8Array
  );
}

/** Calls `onField` for each length-delimited field of a message; other wire types are skipped. */
function readFields(bytes: Uint8Array, onField: (no: number, r: BinaryReader) => boolean) {
  const r = new BinaryReader(bytes);
  while (r.pos < r.len) {
    const [no, wireType] = r.tag();
    if (wireType !== WireType.LengthDelimited || !onField(no, r)) r.skip(wireType, no);
  }
}

function decodeBadRequest(bytes: Uint8Array): FieldViolation[] {
  const violations: FieldViolation[] = [];
  readFields(bytes, (no, r) => {
    if (no !== 1) return false;
    const violation = { field: "", description: "" };
    readFields(r.bytes(), (n, fr) => {
      if (n === 1) violation.field = fr.string();
      else if (n === 2) violation.description = fr.string();
      else return false;
      return true;
    });
    violations.push(violation);
    return true;
  });
  return violations;
}

function decodeErrorInfo(bytes: Uint8Array): ErrorInfo {
  const info: ErrorInfo = { reason: "", domain: "", metadata: {} };
  readFields(bytes, (no, r) => {
    if (no === 1) info.reason = r.string();
    else if (no === 2) info.domain = r.string();
    else if (no === 3) {
      // A map entry: key = 1, value = 2.
      let key = "";
      let value = "";
      readFields(r.bytes(), (n, er) => {
        if (n === 1) key = er.string();
        else if (n === 2) value = er.string();
        else return false;
        return true;
      });
      info.metadata[key] = value;
    } else return false;
    return true;
  });
  return info;
}

/** The decoded details of `type` of a ConnectError (gRPC-web or Connect); malformed ones are skipped. */
function decodedDetails<T>(error: unknown, type: string, decode: (bytes: Uint8Array) => T): T[] {
  const details = (error as { details?: unknown } | null)?.details;
  if (!Array.isArray(details)) return [];
  const decoded: T[] = [];
  for (const d of details) {
    if (!isIncomingDetail(d) || d.type !== type) continue;
    try {
      decoded.push(decode(d.value));
    } catch {
      // A malformed detail is ignored; the error message still says what went wrong.
    }
  }
  return decoded;
}

/**
 * The field violations of a failed request: the google.rpc.BadRequest details
 * of a ConnectError (gRPC-web or Connect). Empty for any other error.
 */
export function fieldViolations(error: unknown): FieldViolation[] {
  return decodedDetails(error, BAD_REQUEST, decodeBadRequest).flat();
}

/**
 * The google.rpc.ErrorInfo of a failed request, which says why it failed in
 * a way a client can branch on (`reason`). Undefined for any other error.
 */
export function errorInfo(error: unknown): ErrorInfo | undefined {
  return decodedDetails(error, ERROR_INFO, decodeErrorInfo)[0];
}

/** The description of the first violation of `field`, to show next to its input. */
export function fieldError(error: unknown, field: string): string | undefined {
  return fieldViolations(error).find((v) => v.field === field)?.description;
}
