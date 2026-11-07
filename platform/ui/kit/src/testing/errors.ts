import { BinaryWriter } from "@bufbuild/protobuf/wire";
import type { FieldViolation } from "../errors.ts";

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
