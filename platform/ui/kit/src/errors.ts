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

const BAD_REQUEST = "google.rpc.BadRequest";

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

/**
 * The field violations of a failed request: the google.rpc.BadRequest details
 * of a ConnectError (gRPC-web or Connect). Empty for any other error.
 */
export function fieldViolations(error: unknown): FieldViolation[] {
  const details = (error as { details?: unknown } | null)?.details;
  if (!Array.isArray(details)) return [];
  const violations: FieldViolation[] = [];
  for (const d of details) {
    if (!isIncomingDetail(d) || d.type !== BAD_REQUEST) continue;
    try {
      violations.push(...decodeBadRequest(d.value));
    } catch {
      // A malformed detail is ignored; the error message still says what went wrong.
    }
  }
  return violations;
}

/** The description of the first violation of `field`, to show next to its input. */
export function fieldError(error: unknown, field: string): string | undefined {
  return fieldViolations(error).find((v) => v.field === field)?.description;
}
