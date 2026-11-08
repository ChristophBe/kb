//go:build e2e

// Package e2e smoke-tests the whole stack: it starts docker compose with the
// fake LLM provider and drives upload → processing → RAG chat the way the web
// shell does, over gRPC-Web through Envoy, authenticated with a token of a
// dev user from Dex (password grant). Run it with `task e2e`.
//
// The stack runs as its own compose project (KB_E2E_PROJECT, default kb-e2e)
// with only the gateway, S3 and Dex published, on non-default host ports, so it
// does not collide with a developer's `kb` stack. It is torn down with its
// volumes after the run, also on failure (set KB_E2E_KEEP=1 to keep it).
package e2e

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// upTimeout bounds building the images and waiting for the services to become healthy.
const upTimeout = 30 * time.Minute

// stack is the compose project under test.
type stack struct {
	root    string   // repository root
	project string   // compose project name
	env     []string // environment for every docker compose call
	gateway string   // base URL of Envoy's gRPC-Web listener
	issuer  string   // URL of the dev OIDC issuer (Dex)
	token   string   // access token of the test user, fetched once the stack is up
	keep    bool     // leave the stack running after the run
}

var kb *stack

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	s, err := newStack()
	if err != nil {
		fmt.Fprintln(os.Stderr, "e2e:", err)
		return 1
	}
	kb = s

	// Tear down on Ctrl-C / SIGTERM too: deferred calls do not run on a signal.
	var once sync.Once
	teardown := func() { once.Do(s.down) }
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigs
		fmt.Fprintln(os.Stderr, "e2e: interrupted, tearing down the stack")
		teardown()
		os.Exit(130)
	}()
	defer teardown()

	if err := s.up(); err != nil {
		fmt.Fprintln(os.Stderr, "e2e: starting the stack:", err)
		s.logs()
		return 1
	}
	if s.token, err = fetchToken(s.issuer, testUser); err != nil {
		fmt.Fprintln(os.Stderr, "e2e: fetching a token:", err)
		s.logs()
		return 1
	}
	code := m.Run()
	if code != 0 {
		s.logs()
	}
	return code
}

func newStack() (*stack, error) {
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		return nil, err
	}
	project := envOr("KB_E2E_PROJECT", "kb-e2e")
	if project == "kb" {
		return nil, fmt.Errorf("KB_E2E_PROJECT must not be %q: the run deletes the project's volumes", project)
	}
	gatewayPort := envOr("KB_GATEWAY_PORT", "21080")
	s3Port := envOr("KB_E2E_S3_PORT", "21333")
	webPort := envOr("KB_WEB_PORT", "21300")
	dexPort := envOr("KB_DEX_PORT", "21556")
	gateway := "http://localhost:" + gatewayPort
	issuer := "http://localhost:" + dexPort + "/dex"
	return &stack{
		root:    root,
		project: project,
		env: append(os.Environ(),
			"KB_LLM_PROVIDER=fake",
			// Hash embeddings score like noise (cosine similarity, -1 to 1); keep
			// every retrieved chunk.
			"KB_RAG_MIN_SCORE=-1",
			"KB_GATEWAY_PORT="+gatewayPort,
			"KB_E2E_S3_PORT="+s3Port,
			"KB_WEB_PORT="+webPort,
			"KB_API_BASE_URL="+gateway,
			"KB_S3_PUBLIC_ENDPOINT=localhost:"+s3Port,
			"KB_DEX_PORT="+dexPort,
			"KB_OIDC_ISSUER="+issuer,
		),
		gateway: gateway,
		issuer:  issuer,
		keep:    os.Getenv("KB_E2E_KEEP") != "",
	}, nil
}

// up builds and starts every service except the web shell, which the test
// does not need, and waits until they are healthy.
func (s *stack) up() error {
	ctx, cancel := context.WithTimeout(context.Background(), upTimeout)
	defer cancel()
	out, err := s.output(ctx, "config", "--services")
	if err != nil {
		return err
	}
	services := slices.DeleteFunc(strings.Fields(out), func(name string) bool { return name == "web" })
	args := append([]string{"up", "--detach", "--build", "--wait", "--wait-timeout", "600"}, services...)
	fmt.Printf("e2e: starting compose project %s (gateway %s)\n", s.project, s.gateway)
	return s.compose(ctx, args...)
}

func (s *stack) down() {
	if s.keep {
		fmt.Printf("e2e: KB_E2E_KEEP is set, leaving compose project %s running\n", s.project)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := s.compose(ctx, "down", "--volumes", "--remove-orphans", "--timeout", "10"); err != nil {
		fmt.Fprintln(os.Stderr, "e2e: tearing down the stack:", err)
	}
}

// logs prints the logs of every service, for diagnosing a failed run.
func (s *stack) logs() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	fmt.Println("e2e: ===== docker compose logs =====")
	if err := s.compose(ctx, "ps", "--all"); err != nil {
		fmt.Fprintln(os.Stderr, "e2e: docker compose ps:", err)
	}
	if err := s.compose(ctx, "logs", "--no-color", "--timestamps"); err != nil {
		fmt.Fprintln(os.Stderr, "e2e: docker compose logs:", err)
	}
	fmt.Println("e2e: ===== end of docker compose logs =====")
}

func (s *stack) command(ctx context.Context, args ...string) *exec.Cmd {
	base := []string{
		"compose", "--project-name", s.project,
		"--file", filepath.Join(s.root, "compose.yaml"),
		"--file", filepath.Join(s.root, "tests", "e2e", "compose.e2e.yaml"),
	}
	cmd := exec.CommandContext(ctx, "docker", append(base, args...)...)
	cmd.Dir = s.root
	cmd.Env = s.env
	cmd.Stderr = os.Stderr
	return cmd
}

func (s *stack) compose(ctx context.Context, args ...string) error {
	cmd := s.command(ctx, args...)
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker compose %s: %w", strings.Join(args, " "), err)
	}
	return nil
}

func (s *stack) output(ctx context.Context, args ...string) (string, error) {
	out, err := s.command(ctx, args...).Output()
	if err != nil {
		return "", fmt.Errorf("docker compose %s: %w", strings.Join(args, " "), err)
	}
	return string(out), nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
