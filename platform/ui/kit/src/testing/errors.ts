import { BinaryWriter } from "@bufbuild/protobuf/wire";
import type { ErrorInfo, FieldViolation } from "../errors.ts";

/**
 * A google.rpc.BadRequest detail as a ConnectError holds it once decoded from
 * the grpc-status-details-bin trailer. Push it onto `err.details` to fake a
 * server-side validation error in a test.
 */
export function badRequestDetail(violations: FieldViolation[]) {
  const w = new BinaryWriter();
  for (const v of violations) {
    w.tag(1, 2).fork().tag(1, 2).string(v.field).tag(2, 2).string(v.description).join();
  }
  return { type: "google.rpc.BadRequest", value: w.finish() };
}

/** A google.rpc.ErrorInfo detail, like `badRequestDetail`. */
export function errorInfoDetail({
  reason,
  domain,
  metadata = {},
}: Partial<ErrorInfo> & { reason: string; domain: string }) {
  const w = new BinaryWriter();
  w.tag(1, 2).string(reason).tag(2, 2).string(domain);
  for (const [k, v] of Object.entries(metadata)) {
    w.tag(3, 2).fork().tag(1, 2).string(k).tag(2, 2).string(v).join();
  }
  return { type: "google.rpc.ErrorInfo", value: w.finish() };
}
