package cleanup

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"log/slog"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/christoph/kb/modules/document/service/internal/storage"
	"github.com/christoph/kb/modules/document/service/internal/store"
)

var now = time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)

// fakeStore holds the keys of stale uploads and of all documents.
type fakeStore struct {
	stale      []string
	keys       []string
	lockHeld   bool
	staleErr   error
	cutoff     time.Time // of the first sweep
	lookups    int
	lookupKeys int
	// swept counts the sweeps; Run's test reads it while Run sweeps.
	swept atomic.Int32
}

func (f *fakeStore) DeleteStaleUploads(_ context.Context, p store.DeleteStaleUploadsParams) ([]string, error) {
	if f.swept.Add(1) == 1 {
		f.cutoff = p.Cutoff.Time
	}
	if f.staleErr != nil {
		return nil, f.staleErr
	}
	n := min(int(p.MaxResults), len(f.stale))
	batch := f.stale[:n]
	f.stale = f.stale[n:]
	return batch, nil
}

func (f *fakeStore) ExistingObjectKeys(_ context.Context, keys []string) ([]string, error) {
	f.lookups++
	f.lookupKeys += len(keys)
	var found []string
	for _, k := range keys {
		if slices.Contains(f.keys, k) {
			found = append(found, k)
		}
	}
	return found, nil
}

func (f *fakeStore) WithLock(ctx context.Context, _ int64, fn func(context.Context) error) (bool, error) {
	if f.lockHeld {
		return false, nil
	}
	return true, fn(ctx)
}

type fakeObjects struct {
	objects   []storage.Object
	deleted   []string
	deleteErr error
	listErr   error
}

func (f *fakeObjects) List(context.Context) iter.Seq2[storage.Object, error] {
	return func(yield func(storage.Object, error) bool) {
		for _, o := range f.objects {
			if !yield(o, nil) {
				return
			}
		}
		if f.listErr != nil {
			yield(storage.Object{}, f.listErr)
		}
	}
}

func (f *fakeObjects) Delete(_ context.Context, key string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	f.deleted = append(f.deleted, key)
	return nil
}

func newSweeper(s *fakeStore, o *fakeObjects) *Sweeper {
	sw := New(s, o, Config{Interval: time.Hour, UploadTTL: 24 * time.Hour, OrphanGrace: time.Hour}, slog.New(slog.DiscardHandler))
	sw.Now = func() time.Time { return now }
	return sw
}

func TestSweepRemovesStaleUploadsWithTheirObjects(t *testing.T) {
	s := &fakeStore{stale: []string{"a/x.md", "b/y.md"}}
	o := &fakeObjects{}
	res, err := newSweeper(s, o).Sweep(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if res.StaleUploads != 2 || !slices.Equal(o.deleted, []string{"a/x.md", "b/y.md"}) {
		t.Errorf("result %+v, deleted %v", res, o.deleted)
	}
	if want := now.Add(-24 * time.Hour); !s.cutoff.Equal(want) {
		t.Errorf("cutoff = %v, want %v", s.cutoff, want)
	}
}

func TestSweepDeletesStaleUploadsInBatches(t *testing.T) {
	s := &fakeStore{}
	for i := range batchSize + 1 {
		s.stale = append(s.stale, fmt.Sprintf("%d/a.md", i))
	}
	res, err := newSweeper(s, &fakeObjects{}).Sweep(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if res.StaleUploads != batchSize+1 || s.swept.Load() != 2 {
		t.Errorf("result %+v after %d queries, want all in 2", res, s.swept.Load())
	}
}

// The row is gone, so the object is an orphan a later sweep removes.
func TestSweepCarriesOnWhenTheObjectOfAStaleUploadCannotBeDeleted(t *testing.T) {
	s := &fakeStore{stale: []string{"a/x.md"}}
	res, err := newSweeper(s, &fakeObjects{deleteErr: errors.New("down")}).Sweep(t.Context())
	if err != nil || res.StaleUploads != 1 {
		t.Errorf("result %+v, err %v", res, err)
	}
}

func TestSweepRemovesOnlyOldObjectsWithoutADocument(t *testing.T) {
	s := &fakeStore{keys: []string{"kept/a.md"}}
	o := &fakeObjects{objects: []storage.Object{
		{Key: "kept/a.md", LastModified: now.Add(-2 * time.Hour)},
		{Key: "orphan/a.md", LastModified: now.Add(-2 * time.Hour)},
		{Key: "fresh/a.md", LastModified: now.Add(-time.Minute)},
	}}
	res, err := newSweeper(s, o).Sweep(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if res.OrphanObjects != 1 || !slices.Equal(o.deleted, []string{"orphan/a.md"}) {
		t.Errorf("result %+v, deleted %v", res, o.deleted)
	}
}

func TestSweepLooksUpObjectKeysInBatches(t *testing.T) {
	s := &fakeStore{}
	o := &fakeObjects{}
	for i := range batchSize + 1 {
		o.objects = append(o.objects, storage.Object{Key: fmt.Sprintf("%d/a.md", i), LastModified: now.Add(-2 * time.Hour)})
	}
	res, err := newSweeper(s, o).Sweep(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if res.OrphanObjects != batchSize+1 || s.lookups != 2 || s.lookupKeys != batchSize+1 {
		t.Errorf("result %+v after %d lookups of %d keys", res, s.lookups, s.lookupKeys)
	}
}

func TestSweepReportsFailures(t *testing.T) {
	for name, tc := range map[string]struct {
		store   *fakeStore
		objects *fakeObjects
	}{
		"stale uploads": {&fakeStore{staleErr: errors.New("db down")}, &fakeObjects{}},
		"listing":       {&fakeStore{}, &fakeObjects{listErr: errors.New("s3 down")}},
		"orphan delete": {&fakeStore{}, &fakeObjects{
			objects:   []storage.Object{{Key: "o/a.md", LastModified: now.Add(-2 * time.Hour)}},
			deleteErr: errors.New("s3 down"),
		}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := newSweeper(tc.store, tc.objects).Sweep(t.Context()); err == nil {
				t.Error("want an error")
			}
		})
	}
}

func TestSweepIsSkippedWhileTheLockIsHeld(t *testing.T) {
	s := &fakeStore{stale: []string{"a/x.md"}, lockHeld: true}
	res, err := newSweeper(s, &fakeObjects{}).Sweep(t.Context())
	if err != nil || !res.Skipped || s.swept.Load() != 0 {
		t.Errorf("result %+v, err %v, queries %d; want skipped", res, err, s.swept.Load())
	}
}

func TestRunSweepsUntilCancelled(t *testing.T) {
	s := &fakeStore{stale: []string{"a/x.md"}}
	sw := newSweeper(s, &fakeObjects{})
	sw.cfg.Interval = time.Millisecond
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		sw.Run(ctx)
		close(done)
	}()
	deadline := time.After(5 * time.Second)
	for s.swept.Load() < 2 {
		select {
		case <-deadline:
			t.Fatal("Run did not sweep repeatedly")
		case <-time.After(time.Millisecond):
		}
	}
	cancel()
	<-done
}

func TestRunIsOffWithoutAnInterval(t *testing.T) {
	s := &fakeStore{}
	sw := newSweeper(s, &fakeObjects{})
	sw.cfg.Interval = 0
	sw.Run(t.Context()) // returns right away
	if s.swept.Load() != 0 {
		t.Errorf("swept %d times, want never", s.swept.Load())
	}
}
