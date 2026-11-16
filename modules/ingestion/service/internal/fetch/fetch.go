// Package fetch downloads web pages for ingestion. The addresses come from
// users, so the client refuses to connect to private networks (SSRF).
package fetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"slices"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/html"

	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/app"
)

const maxRedirects = 5

// ErrBlocked means the address is on a private or otherwise internal network.
var ErrBlocked = errors.New("addresses on private networks are not allowed")

// Fetcher downloads pages with a size limit and a timeout.
type Fetcher struct {
	client   *http.Client
	maxBytes int64
}

// Options configure a Fetcher.
type Options struct {
	// MaxBytes is the largest body accepted.
	MaxBytes int64
	// Timeout bounds one fetch, redirects included.
	Timeout time.Duration
	// Allow decides which addresses may be connected to; nil allows public
	// addresses only. Tests use it to reach a local server.
	Allow func(netip.Addr) bool
}

func New(o Options) *Fetcher {
	allow := o.Allow
	if allow == nil {
		allow = isPublic
	}
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
		// Control runs for every connection attempt with the address DNS
		// resolved to, redirects included, so a name that resolves to a
		// private address (or changes to one) is refused as well.
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			addr, err := netip.ParseAddr(host)
			if err != nil {
				return err
			}
			if !allow(addr.Unmap()) {
				return ErrBlocked
			}
			return nil
		},
	}
	return &Fetcher{
		maxBytes: o.MaxBytes,
		client: &http.Client{
			Timeout: o.Timeout,
			Transport: &http.Transport{
				// No proxy: it would make the request from another place.
				Proxy:                  nil,
				DialContext:            dialer.DialContext,
				TLSHandshakeTimeout:    10 * time.Second,
				ResponseHeaderTimeout:  15 * time.Second,
				MaxResponseHeaderBytes: 64 << 10,
			},
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= maxRedirects {
					return errors.New("too many redirects")
				}
				return checkURL(req.URL)
			},
		},
	}
}

// notPublic are ranges that IsGlobalUnicast and IsPrivate let through but that
// are not the public internet: shared address space (carrier-grade NAT, which
// cloud networks use internally), protocol and documentation blocks,
// benchmarking, reserved space, and IPv6 ranges that embed or tunnel IPv4
// addresses (NAT64, 6to4) or are deprecated site-local.
var notPublic = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("fec0::/10"),
}

// isPublic reports whether addr is a globally routable unicast address.
func isPublic(addr netip.Addr) bool {
	if !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() {
		return false
	}
	return !slices.ContainsFunc(notPublic, func(p netip.Prefix) bool { return p.Contains(addr) })
}

func checkURL(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return &app.FetchError{Reason: "Only http and https addresses are supported"}
	}
	if u.Hostname() == "" {
		return &app.FetchError{Reason: "The address has no host"}
	}
	if u.User != nil {
		return &app.FetchError{Reason: "The address must not contain a username or password"}
	}
	return nil
}

// Fetch downloads rawURL. Every failure is an *app.FetchError.
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (app.Page, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return app.Page{}, &app.FetchError{Reason: "The address is not a valid URL", Err: err}
	}
	if err := checkURL(u); err != nil {
		return app.Page{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return app.Page{}, &app.FetchError{Reason: "The address is not a valid URL", Err: err}
	}
	req.Header.Set("Accept", "text/html,application/pdf,text/*;q=0.8")
	req.Header.Set("User-Agent", "Knowcelium")
	resp, err := f.client.Do(req)
	if err != nil {
		if errors.Is(err, ErrBlocked) {
			return app.Page{}, &app.FetchError{Reason: "Addresses on private networks are not allowed", Err: ErrBlocked}
		}
		var fe *app.FetchError
		if errors.As(err, &fe) {
			return app.Page{}, fe
		}
		return app.Page{}, &app.FetchError{Reason: "The page could not be reached", Err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return app.Page{}, &app.FetchError{Reason: fmt.Sprintf("The page answered with status %d", resp.StatusCode)}
	}
	if resp.ContentLength > f.maxBytes {
		return app.Page{}, f.tooLarge()
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, f.maxBytes+1))
	if err != nil {
		return app.Page{}, &app.FetchError{Reason: "The page could not be read", Err: err}
	}
	if int64(len(body)) > f.maxBytes {
		return app.Page{}, f.tooLarge()
	}
	if len(body) == 0 {
		return app.Page{}, &app.FetchError{Reason: "The page is empty"}
	}
	contentType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = "text/html"
	}
	page := app.Page{Body: body, ContentType: contentType}
	if contentType == "text/html" || contentType == "application/xhtml+xml" {
		page.ContentType = "text/html"
		page.Title = htmlTitle(body)
	}
	page.Filename = filename(resp.Request.URL, page.ContentType)
	return page, nil
}

func (f *Fetcher) tooLarge() error {
	return &app.FetchError{Reason: fmt.Sprintf("The page is larger than the limit of %d MiB", f.maxBytes>>20)}
}

// htmlTitle returns the text of the first <title>, whitespace collapsed.
func htmlTitle(body []byte) string {
	z := html.NewTokenizer(strings.NewReader(string(body)))
	for {
		switch z.Next() {
		case html.ErrorToken:
			return ""
		case html.StartTagToken:
			if name, _ := z.TagName(); string(name) != "title" {
				continue
			}
			if z.Next() != html.TextToken {
				return ""
			}
			return strings.Join(strings.Fields(html.UnescapeString(string(z.Text()))), " ")
		}
	}
}

var extensions = map[string]string{
	"text/html":       ".html",
	"text/plain":      ".txt",
	"text/markdown":   ".md",
	"application/pdf": ".pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}

// filename names a download after the last path segment of its address, or
// its host, with the extension of its type so that it is read as that type.
func filename(u *url.URL, contentType string) string {
	name := path.Base(u.Path)
	if name == "/" || name == "." || name == "" {
		name = u.Hostname()
	}
	ext, known := extensions[contentType]
	have := strings.ToLower(path.Ext(name))
	if known && have != ext && (ext != ".html" || have != ".htm") {
		name += ext
	}
	return name
}
