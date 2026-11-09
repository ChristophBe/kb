// Package s3test runs a real S3 server (SeaweedFS) for integration tests.
// Tests using it carry the integration build tag, so that `task test` needs
// no Docker.
package s3test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/christoph/kb/modules/document/service/internal/storage"
)

// Image is the image of deploy/infra.compose.yaml.
const Image = "chrislusf/seaweedfs:4.00"

// identities mirrors deploy/seaweedfs/s3.json.
const identities = `{"identities": [{"name": "kb",
  "credentials": [{"accessKey": "kb", "secretKey": "kb-secret-key"}],
  "actions": ["Admin", "Read", "Write", "List", "Tagging"]}]}`

// Start runs a container for this test and returns the object store on it,
// with its bucket created. The container is removed when the test ends.
func Start(t testing.TB) *storage.S3 {
	t.Helper()
	ctx := context.Background()
	container, err := testcontainers.Run(ctx, Image,
		testcontainers.WithCmd("server", "-ip.bind=0.0.0.0", "-dir=/data", "-filer", "-s3", "-s3.config=/etc/seaweedfs/s3.json"),
		testcontainers.WithExposedPorts("8333/tcp"),
		testcontainers.WithFiles(testcontainers.ContainerFile{
			Reader: strings.NewReader(identities), ContainerFilePath: "/etc/seaweedfs/s3.json", FileMode: 0o644,
		}),
		testcontainers.WithWaitStrategy(wait.ForHTTP("/status").WithPort("8333/tcp").WithStartupTimeout(2*time.Minute)),
	)
	if err != nil {
		t.Fatalf("start s3: %v", err)
	}
	t.Cleanup(func() {
		if err := container.Terminate(ctx); err != nil {
			t.Errorf("stop s3: %v", err)
		}
	})
	endpoint, err := container.PortEndpoint(ctx, "8333/tcp", "")
	if err != nil {
		t.Fatalf("s3 endpoint: %v", err)
	}
	cfg := storage.Config{
		Endpoint: endpoint, PublicEndpoint: endpoint, AccessKey: "kb", SecretKey: "kb-secret-key",
		Bucket: "documents", Region: "us-east-1",
	}
	// The S3 gateway answers /status before the filer behind it takes buckets.
	deadline := time.Now().Add(time.Minute)
	for {
		s3, err := storage.NewS3(ctx, cfg)
		if err == nil {
			return s3
		}
		if time.Now().After(deadline) {
			t.Fatalf("connect s3: %v", err)
		}
		time.Sleep(500 * time.Millisecond)
	}
}
