package documents

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Uploader PUTs files to the presigned URLs the document module hands out,
// for uploads the service makes itself (pages fetched from a URL).
type Uploader struct {
	client *http.Client
	// endpoint, if set, is the host:port the service connects to instead of
	// the host the URL is signed for, which is the address browsers use.
	endpoint string
}

// NewUploader returns an Uploader; an empty endpoint connects to the signed host.
func NewUploader(endpoint string) *Uploader {
	return &Uploader{client: &http.Client{Timeout: 2 * time.Minute}, endpoint: endpoint}
}

// Put uploads body as contentType, as the URL requires: exactly its size
// and type are signed.
func (u *Uploader) Put(ctx context.Context, uploadURL, contentType string, body []byte) error {
	target, err := url.Parse(uploadURL)
	if err != nil {
		return fmt.Errorf("parse upload url: %w", err)
	}
	signedHost := target.Host
	if u.endpoint != "" {
		target.Host = u.endpoint
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, target.String(), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("upload: %w", err)
	}
	// The signature covers the host, so it stays the signed one.
	req.Host = signedHost
	req.Header.Set("Content-Type", contentType)
	resp, err := u.client.Do(req)
	if err != nil {
		return fmt.Errorf("upload: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("upload: status %d: %s", resp.StatusCode, bytes.TrimSpace(detail))
	}
	return nil
}
