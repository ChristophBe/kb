package fetch

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/app"
)

func allowAll(netip.Addr) bool { return true }

func newTestFetcher(maxBytes int64) *Fetcher {
	return New(Options{MaxBytes: maxBytes, Timeout: 5 * time.Second, Allow: allowAll})
}

func serve(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv
}

func TestFetchReturnsThePageWithItsTitleAndAFilename(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html><head><title>\n  Growing   oyster &amp; king mushrooms </title></head><body><p>Text</p></body></html>"))
	})

	page, err := newTestFetcher(1<<20).Fetch(context.Background(), srv.URL+"/articles/oysters")

	if err != nil {
		t.Fatal(err)
	}
	if page.Title != "Growing oyster & king mushrooms" {
		t.Errorf("title = %q", page.Title)
	}
	if page.ContentType != "text/html" || page.Filename != "oysters.html" {
		t.Errorf("type %q, filename %q", page.ContentType, page.Filename)
	}
	if !strings.Contains(string(page.Body), "<p>Text</p>") {
		t.Errorf("body = %q", page.Body)
	}
}

func TestFetchKeepsAnExtensionThatMatchesTheType(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte("%PDF-1.4"))
	})

	page, err := newTestFetcher(1<<20).Fetch(context.Background(), srv.URL+"/files/report.pdf")

	if err != nil || page.Filename != "report.pdf" || page.Title != "" {
		t.Errorf("page %+v, err %v", page, err)
	}
}

func TestFetchFollowsRedirects(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/old" {
			http.Redirect(w, r, "/new/page", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("moved"))
	})

	page, err := newTestFetcher(1<<20).Fetch(context.Background(), srv.URL+"/old")

	if err != nil || page.Filename != "page.txt" {
		t.Errorf("page %+v, err %v", page, err)
	}
}

func TestFetchRejectsUnusableResponses(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
		max     int64
		reason  string
	}{
		{"status", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) }, 1 << 20, "status 404"},
		{"too large", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(strings.Repeat("x", 2048))) }, 1024, "larger than the limit"},
		{"empty", func(w http.ResponseWriter, r *http.Request) {}, 1 << 20, "empty"},
		{"redirect loop", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, r.URL.Path, http.StatusFound) }, 1 << 20, "could not be reached"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := serve(t, tt.handler)

			_, err := newTestFetcher(tt.max).Fetch(context.Background(), srv.URL)

			var fe *app.FetchError
			if !errors.As(err, &fe) || !strings.Contains(fe.Reason, tt.reason) {
				t.Errorf("err = %v, want reason containing %q", err, tt.reason)
			}
		})
	}
}

func TestFetchStopsAtTheTimeout(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) { time.Sleep(time.Second) })
	f := New(Options{MaxBytes: 1 << 20, Timeout: 50 * time.Millisecond, Allow: allowAll})

	_, err := f.Fetch(context.Background(), srv.URL)

	var fe *app.FetchError
	if !errors.As(err, &fe) || fe.Reason != "The page could not be reached" {
		t.Errorf("err = %v", err)
	}
}

func TestFetchRejectsBadAddresses(t *testing.T) {
	for raw, reason := range map[string]string{
		"ftp://example.com/file":      "Only http and https",
		"file:///etc/passwd":          "Only http and https",
		"example.com/page":            "Only http and https",
		"http:///path":                "no host",
		"http://user:pw@example.com/": "username or password",
		"http://exa mple.com/":        "not a valid URL",
		"":                            "Only http and https",
	} {
		_, err := newTestFetcher(1024).Fetch(context.Background(), raw)

		var fe *app.FetchError
		if !errors.As(err, &fe) || !strings.Contains(fe.Reason, reason) {
			t.Errorf("%q: err = %v, want reason containing %q", raw, err, reason)
		}
	}
}

// The default fetcher refuses private addresses, however they are written.
func TestDefaultFetcherBlocksPrivateNetworks(t *testing.T) {
	local := serve(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("secret")) })
	f := New(Options{MaxBytes: 1 << 20, Timeout: 5 * time.Second})

	for _, raw := range []string{
		local.URL,                                  // loopback
		"http://localhost:1/",                      // resolves to loopback
		"http://[::1]/",                            // IPv6 loopback
		"http://[::ffff:127.0.0.1]/",               // IPv4-mapped loopback
		"http://10.0.0.5/",                         // private
		"http://192.168.1.1/",                      // private
		"http://172.16.0.1/",                       // private
		"http://169.254.169.254/latest/meta-data/", // cloud metadata (link-local)
		"http://100.64.0.1/",                       // carrier-grade NAT
		"http://0.0.0.0/",                          // unspecified
		"http://[fd00::1]/",                        // IPv6 unique local
		"http://[fe80::1]/",                        // IPv6 link-local
	} {
		_, err := f.Fetch(context.Background(), raw)

		if !errors.Is(err, ErrBlocked) {
			t.Errorf("%s: err = %v, want ErrBlocked", raw, err)
		}
	}
}

// A page may redirect to an internal address; the connection to it is refused
// like a direct request. The guard here lets the first connection through (the
// test server is local) and blocks the next, the redirect's.
func TestFetchBlocksRedirectsToPrivateNetworks(t *testing.T) {
	var blocked atomic.Bool
	target := serve(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("secret")) })
	redirector := serve(t, func(w http.ResponseWriter, r *http.Request) {
		blocked.Store(true)
		http.Redirect(w, r, target.URL, http.StatusFound)
	})
	f := New(Options{MaxBytes: 1 << 20, Timeout: 5 * time.Second, Allow: func(netip.Addr) bool { return !blocked.Load() }})

	_, err := f.Fetch(context.Background(), redirector.URL)

	if !errors.Is(err, ErrBlocked) {
		t.Errorf("err = %v, want ErrBlocked", err)
	}
}

func TestIsPublic(t *testing.T) {
	for addr, want := range map[string]bool{
		"93.184.216.34":      true,
		"2606:2800:220:1::1": true,
		"127.0.0.1":          false,
		"10.1.2.3":           false,
		"100.127.255.255":    false,
		"169.254.169.254":    false,
		"224.0.0.1":          false,
		"::":                 false,
		"fc00::1":            false,
		"64:ff9b::a00:1":     false,
		"2002:a00:1::":       false,
		"fec0::1":            false,
		"198.18.0.1":         false,
		"240.0.0.1":          false,
	} {
		if got := isPublic(netip.MustParseAddr(addr)); got != want {
			t.Errorf("isPublic(%s) = %v, want %v", addr, got, want)
		}
	}
}
