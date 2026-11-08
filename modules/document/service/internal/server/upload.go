package server

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"path"
	"strings"

	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/christoph/kb/platform/go/grpcserver"
)

// Limits bounds the files CreateDocument accepts.
type Limits struct {
	// MaxUploadBytes is the largest file accepted. 50 MiB fits long PDFs
	// while bounding the ingestion worker, which holds a whole file and its
	// extracted text in memory.
	MaxUploadBytes int64 `env:"MAX_UPLOAD_BYTES" envDefault:"52428800"`
	// AllowedContentTypes are media types ("application/pdf") or wildcards of
	// a top-level type ("text/*"). The default is what the ingestion worker
	// extracts text from (extract_pages in kb_ingestion_worker/extract.py).
	AllowedContentTypes []string `env:"ALLOWED_CONTENT_TYPES" envSeparator:"," envDefault:"application/pdf,text/*,application/json,application/yaml,application/x-yaml"`
}

// allows reports whether contentType is one of the allowed types, ignoring
// its parameters (charset=…).
func (l Limits) allows(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}
	for _, allowed := range l.AllowedContentTypes {
		allowed = strings.ToLower(strings.TrimSpace(allowed))
		if allowed == mediaType {
			return true
		}
		if prefix, ok := strings.CutSuffix(allowed, "/*"); ok && strings.HasPrefix(mediaType, prefix+"/") {
			return true
		}
	}
	return false
}

// extensionTypes are the types of the extensions the ingestion worker reads.
// They stand in for a missing or generic declared type, which browsers send
// for files the operating system has no type for (often .md and .yaml).
var extensionTypes = map[string]string{
	".pdf":      "application/pdf",
	".txt":      "text/plain",
	".md":       "text/markdown",
	".markdown": "text/markdown",
	".csv":      "text/csv",
	".json":     "application/json",
	".yaml":     "application/yaml",
	".yml":      "application/yaml",
	".html":     "text/html",
	".rst":      "text/x-rst",
}

// declaredContentType is the type a new document is stored with: the
// declared one, unless that says nothing and the filename's extension does.
func declaredContentType(contentType, filename string) string {
	if !isGenericContentType(contentType) {
		return contentType
	}
	if t, ok := extensionTypes[strings.ToLower(path.Ext(filename))]; ok {
		return t
	}
	return "application/octet-stream"
}

// validateUpload checks a new document's file against the limits, returning
// one violation per field that is off.
func (l Limits) validateUpload(sizeBytes int64, contentType, checksum string) []*errdetails.BadRequest_FieldViolation {
	var violations []*errdetails.BadRequest_FieldViolation
	switch {
	case sizeBytes <= 0:
		violations = append(violations, grpcserver.Violation("size_bytes", "The file is empty"))
	case sizeBytes > l.MaxUploadBytes:
		violations = append(violations, grpcserver.Violation("size_bytes",
			fmt.Sprintf("The file is larger than the limit of %s", formatBytes(l.MaxUploadBytes))))
	}
	if !l.allows(contentType) {
		violations = append(violations, grpcserver.Violation("content_type",
			fmt.Sprintf("Files of type %s are not accepted", contentType)))
	}
	if checksum != "" && !isSHA256(checksum) {
		violations = append(violations, grpcserver.Violation("sha256", "The checksum must be a SHA-256 in hex"))
	}
	return violations
}

func isSHA256(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == sha256.Size
}

// sha256Hex hashes everything r yields.
func sha256Hex(r io.Reader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// formatBytes renders a size the way users read it: "50 MiB".
func formatBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d bytes", n)
	}
	value, prefix := float64(n), ""
	for _, p := range []string{"KiB", "MiB", "GiB", "TiB"} {
		value /= unit
		prefix = p
		if value < unit {
			break
		}
	}
	return strings.Replace(fmt.Sprintf("%.1f %s", value, prefix), ".0 ", " ", 1)
}
