"""protoc plugin that emits Python messages, type stubs and gRPC stubs.

buf has no local plugin for grpc_python, and the BSR remote plugins are rate
limited, so this wraps the protoc bundled in grpcio-tools: the request's
descriptors are handed to it as a descriptor set and its output is returned
as a CodeGeneratorResponse. The grpcio-tools version (pinned in the root
pyproject.toml) therefore pins the generated code version.
"""

import pathlib
import sys
import tempfile

from google.protobuf import descriptor_pb2
from google.protobuf.compiler import plugin_pb2
from grpc_tools import protoc


def main() -> None:
    request = plugin_pb2.CodeGeneratorRequest.FromString(sys.stdin.buffer.read())
    response = plugin_pb2.CodeGeneratorResponse(
        supported_features=plugin_pb2.CodeGeneratorResponse.FEATURE_PROTO3_OPTIONAL
    )
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        descriptors = root / "descriptors.pb"
        descriptors.write_bytes(
            descriptor_pb2.FileDescriptorSet(file=request.proto_file).SerializeToString()
        )
        out = root / "out"
        out.mkdir()
        code = protoc.main(
            [
                "protoc",
                f"--descriptor_set_in={descriptors}",
                f"--python_out={out}",
                f"--pyi_out={out}",
                f"--grpc_python_out={out}",
                *request.file_to_generate,
            ]
        )
        if code != 0:
            response.error = f"grpc_tools.protoc exited with {code}"
        else:
            for path in sorted(p for p in out.rglob("*") if p.is_file()):
                response.file.add(name=path.relative_to(out).as_posix(), content=path.read_text())
    sys.stdout.buffer.write(response.SerializeToString())


if __name__ == "__main__":
    main()
