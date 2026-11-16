package server

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	ingestionv1 "github.com/ChristophBe/knowcelium/modules/ingestion/api/go/ingestionv1"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/app"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/documents"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/events"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/fetch"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

type fakeUploader struct{ body []byte }

func (f *fakeUploader) Put(_ context.Context, _, _ string, body []byte) error {
	f.body = body
	return nil
}

func urlServer(docs *fakeDocuments, pub *fakePublisher, opts fetch.Options) (*Server, *fakeUploader) {
	up := &fakeUploader{}
	service := app.New(store.NewJobs(&fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}), documents.New(docs), events.NewPublisher(pub)).
		WithURLImport(fetch.New(opts), up)
	return New(service, slog.New(slog.DiscardHandler)), up
}

func publicArticle(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><head><title>Oyster guide</title></head><body><p>Oysters grow on straw.</p></body></html>"))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestCreateFromUrlIngestsAPageWithItsTitle(t *testing.T) {
	article := publicArticle(t)
	docs, pub := &fakeDocuments{}, &fakePublisher{}
	srv, up := urlServer(docs, pub, fetch.Options{MaxBytes: 1 << 20, Timeout: 5 * time.Second, Allow: func(netip.Addr) bool { return true }})
	team := uuid.NewString()

	resp, err := srv.CreateFromUrl(as(t, alice), &ingestionv1.CreateFromUrlRequest{
		Url: article.URL + "/guide", Access: ingestionv1.Access_ACCESS_TEAM, TeamIds: []string{team},
	})

	if err != nil {
		t.Fatal(err)
	}
	if resp.GetJob().GetStatus() != ingestionv1.JobStatus_JOB_STATUS_QUEUED || resp.GetJob().GetOwnerId() != alice {
		t.Errorf("job = %v", resp.GetJob())
	}
	if len(docs.created) != 1 {
		t.Fatalf("documents created: %v", docs.created)
	}
	created := docs.created[0]
	if created.GetTitle() != "Oyster guide" || created.GetContentType() != "text/html" || created.GetFilename() != "guide.html" ||
		created.GetAccess() != documentv1.Access_ACCESS_TEAM || len(created.GetTeamIds()) != 1 || created.GetTeamIds()[0] != team {
		t.Errorf("created %v", created)
	}
	if string(up.body) == "" || created.GetSizeBytes() != int64(len(up.body)) {
		t.Errorf("uploaded %d bytes, document says %d", len(up.body), created.GetSizeBytes())
	}
	if len(docs.statuses) != 1 || len(pub.sent) != 1 {
		t.Errorf("statuses %v, published %d events", docs.statuses, len(pub.sent))
	}
}

func TestCreateFromUrlWithoutTeamsIsPublicByDefaultOfTheRequest(t *testing.T) {
	article := publicArticle(t)
	docs := &fakeDocuments{}
	srv, _ := urlServer(docs, &fakePublisher{}, fetch.Options{MaxBytes: 1 << 20, Timeout: 5 * time.Second, Allow: func(netip.Addr) bool { return true }})

	_, err := srv.CreateFromUrl(as(t, alice), &ingestionv1.CreateFromUrlRequest{Url: article.URL})

	if err != nil {
		t.Fatal(err)
	}
	if got := docs.created[0]; len(got.GetTeamIds()) != 0 || got.GetAccess() != documentv1.Access(ingestionv1.Access_ACCESS_UNSPECIFIED) {
		t.Errorf("created %v", got)
	}
}

func TestCreateFromUrlRefusesPrivateNetworks(t *testing.T) {
	internal := publicArticle(t) // on 127.0.0.1, which the default fetcher refuses
	docs := &fakeDocuments{}
	srv, _ := urlServer(docs, &fakePublisher{}, fetch.Options{MaxBytes: 1 << 20, Timeout: 5 * time.Second})

	for _, url := range []string{internal.URL, "http://169.254.169.254/latest/meta-data/", "http://[::1]:8080/"} {
		_, err := srv.CreateFromUrl(as(t, alice), &ingestionv1.CreateFromUrlRequest{Url: url})

		violations := grpcserver.FieldViolations(err)
		if status.Code(err) != codes.InvalidArgument || len(violations) != 1 || violations[0].GetField() != "url" {
			t.Errorf("%s: err = %v, want InvalidArgument on url", url, err)
		}
	}
	if len(docs.created) != 0 {
		t.Errorf("documents created for refused addresses: %v", docs.created)
	}
}

func TestCreateFromUrlValidates(t *testing.T) {
	srv, _ := urlServer(&fakeDocuments{}, &fakePublisher{}, fetch.Options{MaxBytes: 1 << 20, Timeout: time.Second})

	_, err := srv.CreateFromUrl(as(t, alice), &ingestionv1.CreateFromUrlRequest{Url: " ", TeamIds: []string{"nope"}})

	violations := grpcserver.FieldViolations(err)
	if status.Code(err) != codes.InvalidArgument || len(violations) != 2 || violations[0].GetField() != "url" || violations[1].GetField() != "team_ids[0]" {
		t.Errorf("err = %v", err)
	}
}

func TestCreateFromUrlIsAddressedToTheCaller(t *testing.T) {
	srv, _ := urlServer(&fakeDocuments{}, &fakePublisher{}, fetch.Options{MaxBytes: 1 << 20, Timeout: time.Second})

	_, err := srv.CreateFromUrl(t.Context(), &ingestionv1.CreateFromUrlRequest{Url: "https://example.com"})

	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("err = %v", err)
	}
}

func TestCreateFromUrlIsUnimplementedWithoutAFetcher(t *testing.T) {
	srv := New(app.New(store.NewJobs(&fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}), documents.New(&fakeDocuments{}), events.NewPublisher(&fakePublisher{})), slog.New(slog.DiscardHandler))

	_, err := srv.CreateFromUrl(as(t, alice), &ingestionv1.CreateFromUrlRequest{Url: "https://example.com"})

	if status.Code(err) != codes.Unimplemented {
		t.Errorf("err = %v", err)
	}
}
