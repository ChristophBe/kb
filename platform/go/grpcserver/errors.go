package grpcserver

import (
	"strings"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/protoadapt"
)

// Violation describes one invalid field of a request, for InvalidArgument.
// Field is the path of the field in the request message, in proto field
// names (see kb.common.v1); Description is a sentence a user can act on.
func Violation(field, description string) *errdetails.BadRequest_FieldViolation {
	return &errdetails.BadRequest_FieldViolation{Field: field, Description: description}
}

// InvalidArgument returns an INVALID_ARGUMENT status carrying the violations
// as a google.rpc.BadRequest detail. Its message joins the descriptions, so
// clients that ignore details still get a readable error.
func InvalidArgument(violations ...*errdetails.BadRequest_FieldViolation) error {
	descriptions := make([]string, 0, len(violations))
	for _, v := range violations {
		descriptions = append(descriptions, v.GetDescription())
	}
	return WithDetails(codes.InvalidArgument, strings.Join(descriptions, "; "),
		&errdetails.BadRequest{FieldViolations: violations})
}

// ErrorInfo is a google.rpc.ErrorInfo detail: reason is a stable
// UPPER_SNAKE_CASE identifier clients may branch on, domain the proto package
// of the module that defines it (e.g. "kb.ingestion.v1").
func ErrorInfo(domain, reason string, metadata map[string]string) *errdetails.ErrorInfo {
	return &errdetails.ErrorInfo{Domain: domain, Reason: reason, Metadata: metadata}
}

// WithDetails returns a status error with the given code, message and
// details. Should attaching the details fail, the plain status is returned.
func WithDetails(code codes.Code, message string, details ...protoadapt.MessageV1) error {
	st := status.New(code, message)
	if withDetails, err := st.WithDetails(details...); err == nil {
		st = withDetails
	}
	return st.Err()
}

// FieldViolations returns the field violations carried by err, if any.
func FieldViolations(err error) []*errdetails.BadRequest_FieldViolation {
	var violations []*errdetails.BadRequest_FieldViolation
	for _, d := range status.Convert(err).Details() {
		if br, ok := d.(*errdetails.BadRequest); ok {
			violations = append(violations, br.GetFieldViolations()...)
		}
	}
	return violations
}
