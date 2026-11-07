package grpcserver

import (
	"errors"
	"testing"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestInvalidArgumentCarriesViolations(t *testing.T) {
	err := InvalidArgument(Violation("title", "Title must not be empty"), Violation("page.page_token", "The page token is invalid"))
	st := status.Convert(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("code %v, want InvalidArgument", st.Code())
	}
	if want := "Title must not be empty; The page token is invalid"; st.Message() != want {
		t.Errorf("message %q, want %q", st.Message(), want)
	}
	got := FieldViolations(err)
	if len(got) != 2 || got[0].GetField() != "title" || got[1].GetField() != "page.page_token" {
		t.Errorf("violations %v", got)
	}
}

func TestWithDetailsAttachesErrorInfo(t *testing.T) {
	err := WithDetails(codes.FailedPrecondition, "upload already completed",
		ErrorInfo("kb.ingestion.v1", "UPLOAD_ALREADY_COMPLETED", map[string]string{"job_id": "1"}))
	details := status.Convert(err).Details()
	if len(details) != 1 {
		t.Fatalf("details %v, want one", details)
	}
	info, ok := details[0].(*errdetails.ErrorInfo)
	if !ok || info.GetReason() != "UPLOAD_ALREADY_COMPLETED" || info.GetDomain() != "kb.ingestion.v1" || info.GetMetadata()["job_id"] != "1" {
		t.Errorf("detail %v", details[0])
	}
}

func TestFieldViolationsOfPlainErrors(t *testing.T) {
	for _, err := range []error{nil, errors.New("boom"), status.Error(codes.NotFound, "x")} {
		if got := FieldViolations(err); len(got) != 0 {
			t.Errorf("FieldViolations(%v) = %v, want none", err, got)
		}
	}
}
