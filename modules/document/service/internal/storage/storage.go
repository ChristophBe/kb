// Package storage stores raw document files in S3-compatible object storage.
package storage

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"iter"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/ChristophBe/knowcelium/platform/go/config"
)

// PresignExpiry bounds how long upload/download URLs stay valid.
const PresignExpiry = 15 * time.Minute

// Config describes the object store. PublicEndpoint is the address browsers
// use; presigned URLs are signed for it.
type Config struct {
	// Endpoint is the S3 server the service reads and writes, host:port
	// without a scheme.
	Endpoint string `env:"ENDPOINT" envDefault:"localhost:8333"`
	// PublicEndpoint is the S3 address browsers use, host:port without a
	// scheme; upload and download URLs are signed for it.
	PublicEndpoint string `env:"PUBLIC_ENDPOINT" envDefault:"localhost:8333"`
	// AccessKey is the S3 access key id.
	AccessKey string `env:"ACCESS_KEY" envDefault:"kb"`
	// SecretKey is the S3 secret access key.
	SecretKey string `env:"SECRET_KEY" envDefault:"kb-secret-key"`
	// Bucket holds the document files; the service creates it if missing.
	Bucket string `env:"BUCKET" envDefault:"documents"`
	// UseSSL talks HTTPS to both endpoints.
	UseSSL bool `env:"USE_SSL"`
	// Region is the S3 region URLs are signed for.
	Region string `env:"REGION" envDefault:"us-east-1"`
}

// bucketName follows the S3 naming rules (lowercase, 3-63 characters).
var bucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

// Validate checks the settings (KNOWCEL_S3_*).
func (c Config) Validate(p *config.Problems) {
	for _, e := range [][2]string{{"KNOWCEL_S3_ENDPOINT", c.Endpoint}, {"KNOWCEL_S3_PUBLIC_ENDPOINT", c.PublicEndpoint}} {
		if e[1] == "" || strings.Contains(e[1], "/") {
			p.Addf(e[0], "must be host or host:port without a scheme, got %q", e[1])
		}
	}
	if c.AccessKey == "" {
		p.Addf("KNOWCEL_S3_ACCESS_KEY", "must be set")
	}
	if c.SecretKey == "" {
		p.Addf("KNOWCEL_S3_SECRET_KEY", "must be set")
	}
	if !bucketName.MatchString(c.Bucket) {
		p.Addf("KNOWCEL_S3_BUCKET", "must be a bucket name (3-63 lowercase letters, digits, dots, hyphens), got %q", c.Bucket)
	}
	if c.Region == "" {
		p.Addf("KNOWCEL_S3_REGION", "must be set")
	}
}

// S3 implements object storage on any S3-compatible server (SeaweedFS
// locally) with two clients: one for server-side access and one that only
// signs URLs for the public endpoint.
type S3 struct {
	internal *minio.Client
	public   *minio.Client
	bucket   string
}

func NewS3(ctx context.Context, cfg Config) (*S3, error) {
	newClient := func(endpoint string) (*minio.Client, error) {
		return minio.New(endpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
			Secure: cfg.UseSSL,
			// A fixed region avoids a bucket-location lookup when signing, so
			// the public client never needs to reach its endpoint.
			Region: cfg.Region,
		})
	}
	internal, err := newClient(cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	public, err := newClient(cfg.PublicEndpoint)
	if err != nil {
		return nil, err
	}
	exists, err := internal.BucketExists(ctx, cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("check bucket: %w", err)
	}
	if !exists {
		if err := internal.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{Region: cfg.Region}); err != nil {
			return nil, fmt.Errorf("create bucket: %w", err)
		}
	}
	return &S3{internal: internal, public: public, bucket: cfg.Bucket}, nil
}

// PresignPut returns a URL to upload the object with. Content-Type and
// Content-Length are signed headers: the server refuses (403) an upload that
// sends another type or another number of bytes, so the declared size and
// type hold for the stored object.
func (m *S3) PresignPut(ctx context.Context, key, contentType string, size int64) (string, error) {
	headers := http.Header{}
	headers.Set("Content-Type", contentType)
	headers.Set("Content-Length", strconv.FormatInt(size, 10))
	u, err := m.public.PresignHeader(ctx, http.MethodPut, m.bucket, key, PresignExpiry, nil, headers)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func (m *S3) PresignGet(ctx context.Context, key, filename string) (string, error) {
	params := url.Values{}
	params.Set("response-content-disposition", fmt.Sprintf("attachment; filename=%q", filename))
	u, err := m.public.PresignedGetObject(ctx, m.bucket, key, PresignExpiry, params)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func (m *S3) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	return m.internal.GetObject(ctx, m.bucket, key, minio.GetObjectOptions{})
}

// Stat returns the size and content type of an object, or an error wrapping
// fs.ErrNotExist when there is none.
func (m *S3) Stat(ctx context.Context, key string) (int64, string, error) {
	info, err := m.internal.StatObject(ctx, m.bucket, key, minio.StatObjectOptions{})
	if minio.ToErrorResponse(err).StatusCode == http.StatusNotFound {
		return 0, "", fmt.Errorf("stat %s: %w", key, fs.ErrNotExist)
	}
	if err != nil {
		return 0, "", err
	}
	return info.Size, info.ContentType, nil
}

// Delete removes an object; one that is already gone is no error.
func (m *S3) Delete(ctx context.Context, key string) error {
	return m.internal.RemoveObject(ctx, m.bucket, key, minio.RemoveObjectOptions{})
}

// Object is a stored object as listed.
type Object struct {
	Key          string
	LastModified time.Time
}

// List yields every object in the bucket, stopping at the first error.
func (m *S3) List(ctx context.Context) iter.Seq2[Object, error] {
	return func(yield func(Object, error) bool) {
		ctx, cancel := context.WithCancel(ctx)
		defer cancel() // stops the listing when the caller stops early
		for info := range m.internal.ListObjects(ctx, m.bucket, minio.ListObjectsOptions{Recursive: true}) {
			if info.Err != nil {
				yield(Object{}, info.Err)
				return
			}
			if !yield(Object{Key: info.Key, LastModified: info.LastModified}, nil) {
				return
			}
		}
	}
}
