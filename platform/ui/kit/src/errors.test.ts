import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";
import { fieldError, fieldViolations } from "./errors.ts";
import { badRequestDetail } from "./testing/errors.ts";

/** An error shaped like a ConnectError with decoded details. */
function rejected(details: unknown[], rawMessage = "invalid") {
  return Object.assign(new Error(`[invalid_argument] ${rawMessage}`), { rawMessage, details });
}

describe("fieldViolations", () => {
  it("decodes the BadRequest details", () => {
    const err = rejected([
      badRequestDetail([
        { field: "title", description: "Title must not be empty" },
        { field: "document_ids[0]", description: "Invalid document id" },
      ]),
    ]);
    expect(fieldViolations(err)).toEqual([
      { field: "title", description: "Title must not be empty" },
      { field: "document_ids[0]", description: "Invalid document id" },
    ]);
    expect(fieldError(err, "title")).toBe("Title must not be empty");
    expect(fieldError(err, "filename")).toBeUndefined();
  });

  it("skips unknown fields and other detail types", () => {
    const w = new BinaryWriter();
    // A FieldViolation with reason (3) and a varint field (9) the decoder doesn't know.
    w.tag(1, 2).fork().tag(1, 2).string("title").tag(3, 2).string("EMPTY").tag(9, 0).int32(4);
    w.tag(2, 2).string("Title must not be empty").join();
    const err = rejected([
      { type: "google.rpc.ErrorInfo", value: new Uint8Array([10, 1, 65]) },
      { type: "google.rpc.BadRequest", value: w.finish() },
    ]);
    expect(fieldViolations(err)).toEqual([
      { field: "title", description: "Title must not be empty" },
    ]);
  });

  it("is empty for errors without violations", () => {
    expect(fieldViolations(null)).toEqual([]);
    expect(fieldViolations("boom")).toEqual([]);
    expect(fieldViolations(new Error("boom"))).toEqual([]);
    expect(
      fieldViolations(
        rejected([{ type: "google.rpc.BadRequest", value: new Uint8Array([10, 9]) }]),
      ),
    ).toEqual([]);
  });
});
