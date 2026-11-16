package documents

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestUploaderPutsToTheEndpointWithTheSignedHost(t *testing.T) {
	var gotHost, gotType, gotBody, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotHost, gotType, gotBody, gotQuery = r.Host, r.Header.Get("Content-Type"), string(b), r.URL.RawQuery
	}))
	defer srv.Close()
	endpoint := strings.TrimPrefix(srv.URL, "http://")

	err := NewUploader(endpoint).Put(context.Background(), "http://public.example:8333/documents/k?X-Amz-Signature=abc", "text/html", []byte("<p>hi</p>"))

	if err != nil {
		t.Fatal(err)
	}
	if gotHost != "public.example:8333" || gotType != "text/html" || gotBody != "<p>hi</p>" || gotQuery != "X-Amz-Signature=abc" {
		t.Errorf("host %q, type %q, body %q, query %q", gotHost, gotType, gotBody, gotQuery)
	}
}

func TestUploaderWithoutEndpointUsesTheURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	if err := NewUploader("").Put(context.Background(), srv.URL+"/k", "text/plain", []byte("x")); err != nil {
		t.Fatal(err)
	}
}

func TestUploaderReportsRefusals(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "SignatureDoesNotMatch", http.StatusForbidden)
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)

	err := NewUploader("").Put(context.Background(), u.String()+"/k", "text/plain", []byte("x"))

	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Errorf("err = %v", err)
	}
}
