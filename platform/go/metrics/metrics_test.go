package metrics

import (
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

func TestStartServesTheDefaultRegistry(t *testing.T) {
	promauto.NewCounter(prometheus.CounterOpts{Name: "kb_test_events_total", Help: "Test."}).Add(3)

	lis, err := new(net.ListenConfig).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := lis.Addr().(*net.TCPAddr).Port
	_ = lis.Close()
	if err := Start(t.Context(), port, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://127.0.0.1:"+strconv.Itoa(port)+Path, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	for _, want := range []string{"kb_test_events_total 3", "go_goroutines"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("metrics lack %q", want)
		}
	}
}

func TestStartFailsOnAPortInUse(t *testing.T) {
	lis, err := new(net.ListenConfig).Listen(t.Context(), "tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lis.Close() }()
	if err := Start(t.Context(), lis.Addr().(*net.TCPAddr).Port, slog.New(slog.DiscardHandler)); err == nil {
		t.Fatal("want an error for a port in use")
	}
}
