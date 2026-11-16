package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"slices"
	"testing"

	"github.com/google/uuid"

	ingestionv1 "github.com/ChristophBe/knowcelium/modules/ingestion/api/go/ingestionv1"
)

type fakeFetcher struct {
	page Page
	err  error
	urls []string
}

func (f *fakeFetcher) Fetch(_ context.Context, url string) (Page, error) {
	f.urls = append(f.urls, url)
	return f.page, f.err
}

type fakeUploader struct {
	err      error
	url      string
	typ      string
	uploaded []byte
}

func (f *fakeUploader) Put(_ context.Context, uploadURL, contentType string, body []byte) error {
	f.url, f.typ, f.uploaded = uploadURL, contentType, body
	return f.err
}

func urlService(jobs *fakeJobs, docs *fakeDocuments, pub *fakePublisher, f *fakeFetcher, u *fakeUploader) *Service {
	return New(jobs, docs, pub).WithURLImport(f, u)
}

func article() Page {
	return Page{Body: []byte("<title>Oysters</title><p>Hi</p>"), ContentType: "text/html", Title: "Oysters", Filename: "oysters.html"}
}

func TestCreateFromURLStoresTheFetchedPageAndQueuesIt(t *testing.T) {
	docID := uuid.New()
	docs := &fakeDocuments{doc: Document{ID: docID, Filename: "oysters.html", ContentType: "text/html", UploadURL: "http://s3/up"}}
	jobs, pub, up := newFakeJobs(), &fakePublisher{}, &fakeUploader{}
	fetcher := &fakeFetcher{page: article()}
	teams := []uuid.UUID{uuid.New()}

	job, err := urlService(jobs, docs, pub, fetcher, up).CreateFromURL(t.Context(), alice, NewURLImport{
		URL: "https://example.com/oysters", Access: ingestionv1.Access_ACCESS_TEAM, TeamIDs: teams,
	})

	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(article().Body)
	want := NewUpload{
		Title: "Oysters", Filename: "oysters.html", ContentType: "text/html", SizeBytes: int64(len(article().Body)),
		SHA256: hex.EncodeToString(sum[:]), Access: ingestionv1.Access_ACCESS_TEAM, TeamIDs: teams,
	}
	if len(docs.created) != 1 || docs.created[0].Title != want.Title || docs.created[0].SHA256 != want.SHA256 ||
		docs.created[0].SizeBytes != want.SizeBytes || docs.created[0].Access != want.Access ||
		!slices.Equal(docs.created[0].TeamIDs, teams) || docs.created[0].ContentType != want.ContentType {
		t.Errorf("document created as %+v, want %+v", docs.created, want)
	}
	if up.url != "http://s3/up" || up.typ != "text/html" || string(up.uploaded) != string(article().Body) {
		t.Errorf("uploaded %q (%s) to %s", up.uploaded, up.typ, up.url)
	}
	if job.Status != queued || job.OwnerID != alice || job.DocumentID != docID || !slices.Equal(job.TeamIDs, teams) {
		t.Errorf("job = %+v", job)
	}
	if !slices.Equal(docs.marked, []uuid.UUID{docID}) || len(pub.sent) != 1 || pub.sent[0].ID != job.ID {
		t.Errorf("marked %v, published %+v", docs.marked, pub.sent)
	}
}

func TestCreateFromURLTitles(t *testing.T) {
	for _, tc := range []struct {
		name, given, pageTitle, want string
	}{
		{"given title wins", "My title", "Page", "My title"},
		{"page title", "", "Page", "Page"},
		{"address as a last resort", "", "", "https://example.com/x"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			docs := &fakeDocuments{doc: Document{ID: uuid.New()}}
			page := article()
			page.Title = tc.pageTitle

			_, err := urlService(newFakeJobs(), docs, &fakePublisher{}, &fakeFetcher{page: page}, &fakeUploader{}).
				CreateFromURL(t.Context(), alice, NewURLImport{URL: "https://example.com/x", Title: tc.given})

			if err != nil {
				t.Fatal(err)
			}
			if docs.created[0].Title != tc.want {
				t.Errorf("title = %q, want %q", docs.created[0].Title, tc.want)
			}
		})
	}
}

func TestCreateFromURLPassesOnAnUnusableAddress(t *testing.T) {
	fetchErr := &FetchError{Reason: "Addresses on private networks are not allowed"}
	docs, jobs := &fakeDocuments{}, newFakeJobs()

	_, err := urlService(jobs, docs, &fakePublisher{}, &fakeFetcher{err: fetchErr}, &fakeUploader{}).
		CreateFromURL(t.Context(), alice, NewURLImport{URL: "http://10.0.0.1/"})

	if !errors.Is(err, fetchErr) {
		t.Fatalf("err = %v, want %v", err, fetchErr)
	}
	if len(docs.created) != 0 || len(jobs.jobs) != 0 {
		t.Errorf("created %v and %v for an address that was not fetched", docs.created, jobs.jobs)
	}
}

func TestCreateFromURLPassesOnWhatTheDocumentModuleRefuses(t *testing.T) {
	for _, refusal := range []error{ErrTeamNotFound, &InvalidUploadError{Violations: []FieldViolation{{Field: "content_type"}}}} {
		docs := &fakeDocuments{createErr: refusal}
		up := &fakeUploader{}

		_, err := urlService(newFakeJobs(), docs, &fakePublisher{}, &fakeFetcher{page: article()}, up).
			CreateFromURL(t.Context(), alice, NewURLImport{URL: "https://example.com/"})

		if !errors.Is(err, refusal) {
			t.Errorf("err = %v, want %v", err, refusal)
		}
		if up.uploaded != nil {
			t.Error("uploaded a page of a refused document")
		}
	}
}

func TestCreateFromURLFailsTheJobWhenTheUploadFails(t *testing.T) {
	docs := &fakeDocuments{doc: Document{ID: uuid.New(), UploadURL: "http://s3/up"}}
	jobs, pub := newFakeJobs(), &fakePublisher{}

	_, err := urlService(jobs, docs, pub, &fakeFetcher{page: article()}, &fakeUploader{err: errors.New("connection refused")}).
		CreateFromURL(t.Context(), alice, NewURLImport{URL: "https://example.com/"})

	if !errors.Is(err, ErrDocumentsUnavailable) {
		t.Errorf("err = %v, want %v", err, ErrDocumentsUnavailable)
	}
	for _, j := range jobs.jobs {
		if j.Status != failed || j.Error == "" {
			t.Errorf("job = %+v, want failed with a reason", j)
		}
	}
	if len(pub.sent) != 0 || len(docs.marked) != 0 {
		t.Errorf("published %v, marked %v", pub.sent, docs.marked)
	}
}

func TestCreateFromURLWithoutAFetcherIsDisabled(t *testing.T) {
	_, err := New(newFakeJobs(), &fakeDocuments{}, &fakePublisher{}).CreateFromURL(t.Context(), alice, NewURLImport{URL: "https://example.com/"})

	if !errors.Is(err, ErrURLImportDisabled) {
		t.Errorf("err = %v", err)
	}
}
