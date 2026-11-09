// Package cleanup removes what deletes and abandoned uploads leave behind:
// documents whose upload never completed, and objects in the bucket that no
// document refers to.
package cleanup

import (
	"context"
	"fmt"
	"iter"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"go.opentelemetry.io/otel"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/storage"
	"github.com/christoph/kb/modules/document/service/internal/store"
)

const (
	// lockKey is the Postgres advisory lock that keeps the sweeps of several
	// replicas apart ("kbdoc_cl" in ASCII).
	lockKey int64 = 0x6b62_646f_635f_636c
	// batchSize bounds the rows deleted and the keys looked up per query.
	batchSize = 500
)

// Config sets when the sweeper runs and what it removes.
type Config struct {
	// Interval is the time between sweeps; 0 turns the sweeper off.
	Interval time.Duration `env:"CLEANUP_INTERVAL" envDefault:"1h"`
	// UploadTTL is how long a document may wait for its upload before it is
	// removed. It should be longer than upload URLs stay valid (15 minutes).
	UploadTTL time.Duration `env:"UPLOAD_TTL" envDefault:"24h"`
	// OrphanGrace is how old an object without a document must be before it
	// is removed, so that an upload racing a delete is not judged too early.
	OrphanGrace time.Duration `env:"ORPHAN_GRACE" envDefault:"1h"`
}

// Store is the part of the repository the sweeper needs.
type Store interface {
	DeleteStaleUploads(ctx context.Context, arg store.DeleteStaleUploadsParams) ([]string, error)
	ExistingObjectKeys(ctx context.Context, keys []string) ([]string, error)
	WithLock(ctx context.Context, key int64, fn func(context.Context) error) (bool, error)
}

// Objects is the part of the object store the sweeper needs. Delete must
// succeed for an object that is already gone.
type Objects interface {
	List(ctx context.Context) iter.Seq2[storage.Object, error]
	Delete(ctx context.Context, key string) error
}

// Result counts what one sweep removed.
type Result struct {
	StaleUploads, OrphanObjects int
	// Skipped is set when another replica held the lock and this one did nothing.
	Skipped bool
}

// Sweeper removes stale uploads and orphaned objects.
type Sweeper struct {
	store   Store
	objects Objects
	cfg     Config
	log     *slog.Logger
	// Now is the clock; tests move it forward.
	Now func() time.Time
}

func New(s Store, objects Objects, cfg Config, log *slog.Logger) *Sweeper {
	return &Sweeper{store: s, objects: objects, cfg: cfg, log: log, Now: time.Now}
}

// Run sweeps once right away and then every interval, until ctx ends. A
// failed sweep is logged; the next one tries again.
func (s *Sweeper) Run(ctx context.Context) {
	if s.cfg.Interval <= 0 {
		s.log.InfoContext(ctx, "cleanup off")
		return
	}
	if s.cfg.UploadTTL < storage.PresignExpiry {
		s.log.WarnContext(ctx, "upload TTL is shorter than upload URLs stay valid; slow uploads may be removed",
			"upload_ttl", s.cfg.UploadTTL.String(), "upload_url_expiry", storage.PresignExpiry.String())
	}
	ticker := time.NewTicker(s.cfg.Interval)
	defer ticker.Stop()
	for {
		res, err := s.Sweep(ctx)
		switch {
		case ctx.Err() != nil:
			return
		case err != nil:
			s.log.ErrorContext(ctx, "cleanup", "error", err)
		case res.StaleUploads+res.OrphanObjects > 0:
			s.log.InfoContext(ctx, "cleanup", "stale_uploads", res.StaleUploads, "orphan_objects", res.OrphanObjects)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Sweep removes, under the advisory lock, the documents still waiting for
// their upload after the upload TTL, and then the objects older than the
// grace period that no document refers to. The first step deletes the row
// before the object: an object left behind by a failure is an orphan the
// second step (of this sweep or a later one) removes.
func (s *Sweeper) Sweep(ctx context.Context) (Result, error) {
	ctx, span := otel.Tracer("document-service").Start(ctx, "cleanup.Sweep")
	defer span.End()
	var res Result
	locked, err := s.store.WithLock(ctx, lockKey, func(ctx context.Context) error {
		n, err := s.removeStaleUploads(ctx)
		res.StaleUploads = n
		if err != nil {
			return err
		}
		res.OrphanObjects, err = s.removeOrphans(ctx)
		return err
	})
	res.Skipped = !locked && err == nil
	return res, err
}

func (s *Sweeper) removeStaleUploads(ctx context.Context) (int, error) {
	cutoff := pgtype.Timestamptz{Time: s.Now().Add(-s.cfg.UploadTTL), Valid: true}
	removed := 0
	for {
		keys, err := s.store.DeleteStaleUploads(ctx, store.DeleteStaleUploadsParams{
			Status:     int16(documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD),
			Cutoff:     cutoff,
			MaxResults: batchSize,
		})
		if err != nil {
			return removed, fmt.Errorf("delete stale uploads: %w", err)
		}
		removed += len(keys)
		for _, key := range keys {
			// Mostly there is no object: the upload never arrived.
			if err := s.objects.Delete(ctx, key); err != nil {
				s.log.WarnContext(ctx, "delete object of stale upload", "key", key, "error", err)
			}
		}
		if len(keys) < batchSize {
			return removed, nil
		}
	}
}

func (s *Sweeper) removeOrphans(ctx context.Context) (int, error) {
	cutoff := s.Now().Add(-s.cfg.OrphanGrace)
	removed := 0
	batch := make([]string, 0, batchSize)
	flush := func() error {
		n, err := s.removeUnreferenced(ctx, batch)
		removed += n
		batch = batch[:0]
		return err
	}
	for obj, err := range s.objects.List(ctx) {
		if err != nil {
			return removed, fmt.Errorf("list objects: %w", err)
		}
		if !obj.LastModified.Before(cutoff) {
			continue
		}
		if batch = append(batch, obj.Key); len(batch) == batchSize {
			if err := flush(); err != nil {
				return removed, err
			}
		}
	}
	return removed, flush()
}

// removeUnreferenced deletes those of keys that no document refers to. A
// document's row is written before its upload URL is handed out, so an object
// older than the grace period without a row has none to wait for.
func (s *Sweeper) removeUnreferenced(ctx context.Context, keys []string) (int, error) {
	if len(keys) == 0 {
		return 0, nil
	}
	existing, err := s.store.ExistingObjectKeys(ctx, keys)
	if err != nil {
		return 0, fmt.Errorf("look up object keys: %w", err)
	}
	referenced := make(map[string]bool, len(existing))
	for _, k := range existing {
		referenced[k] = true
	}
	removed := 0
	for _, key := range keys {
		if referenced[key] {
			continue
		}
		if err := s.objects.Delete(ctx, key); err != nil {
			return removed, fmt.Errorf("delete orphan object %s: %w", key, err)
		}
		removed++
	}
	return removed, nil
}
