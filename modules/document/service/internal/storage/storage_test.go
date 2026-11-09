package storage

import (
	"net/url"
	"testing"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func TestPresignPutSignsTypeAndLength(t *testing.T) {
	// Signing is local: with a fixed region the client never calls the endpoint.
	client, err := minio.New("s3.example:8333", &minio.Options{
		Creds: credentials.NewStaticV4("kb", "secret", ""), Region: "us-east-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	s := &S3{public: client, bucket: "documents"}
	raw, err := s.PresignPut(t.Context(), "id/notes.md", "text/markdown", 42)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if u.Host != "s3.example:8333" || u.Path != "/documents/id/notes.md" {
		t.Errorf("url = %s, want the public endpoint and the object", raw)
	}
	// The server recomputes the signature from these headers of the actual
	// request, so another type or length no longer matches it.
	if got := u.Query().Get("X-Amz-SignedHeaders"); got != "content-length;content-type;host" {
		t.Errorf("signed headers = %q, want content-length;content-type;host", got)
	}
	if u.Query().Get("X-Amz-Expires") != "900" {
		t.Errorf("expires = %q, want 900 seconds", u.Query().Get("X-Amz-Expires"))
	}
}
