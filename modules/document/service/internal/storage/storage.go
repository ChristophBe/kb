// Package storage stores raw document files in S3-compatible object storage.
package storage

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// presignExpiry bounds how long upload/download URLs stay valid.
const presignExpiry = 15 * time.Minute

// Config describes the object store. PublicEndpoint is the address browsers
// use; presigned URLs are signed for it.
type Config struct {
	Endpoint       string `env:"ENDPOINT" envDefault:"localhost:8333"`
	PublicEndpoint string `env:"PUBLIC_ENDPOINT" envDefault:"localhost:8333"`
	AccessKey      string `env:"ACCESS_KEY" envDefault:"kb"`
	SecretKey      string `env:"SECRET_KEY" envDefault:"kb-secret-key"`
	Bucket         string `env:"BUCKET" envDefault:"documents"`
	UseSSL         bool   `env:"USE_SSL"`
	Region         string `env:"REGION" envDefault:"us-east-1"`
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

func (m *S3) PresignPut(ctx context.Context, key string) (string, error) {
	u, err := m.public.PresignedPutObject(ctx, m.bucket, key, presignExpiry)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func (m *S3) PresignGet(ctx context.Context, key, filename string) (string, error) {
	params := url.Values{}
	params.Set("response-content-disposition", fmt.Sprintf("attachment; filename=%q", filename))
	u, err := m.public.PresignedGetObject(ctx, m.bucket, key, presignExpiry, params)
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

func (m *S3) Delete(ctx context.Context, key string) error {
	return m.internal.RemoveObject(ctx, m.bucket, key, minio.RemoveObjectOptions{})
}
