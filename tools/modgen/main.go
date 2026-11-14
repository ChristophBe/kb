// Command modgen generates the wiring that connects modules to the rest of
// the system from their module.yaml manifests: per-module buf.gen.yaml and
// API package manifests, the Envoy gRPC-Web routes, the root compose file,
// the web shell's module registry, the issue forms, the module-boundary
// lint configs (depguard, import-linter, biome), the release image list,
// the module parts of the Helm chart (deploy/helm/kb) and the configuration
// reference (docs/configuration.md, which reads the Python settings through
// `uv run`).
//
// Run from the repository root (`task gen` does this):
//
//	go -C tools run ./modgen -root ..
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

func main() {
	root := flag.String("root", ".", "repository root")
	configDoc := flag.Bool("config-doc", true, "generate "+ConfigDocPath+" (needs the whole repository and uv)")
	flag.Parse()

	modules, err := LoadModules(filepath.Join(*root, "modules"))
	if err != nil {
		log.Fatal(err)
	}
	files, err := Render(modules)
	if err != nil {
		log.Fatal(err)
	}
	if *configDoc {
		groups, err := CollectSettings(*root, modules, UvRunner)
		if err != nil {
			log.Fatal(err)
		}
		doc, err := ConfigDoc(groups)
		if err != nil {
			log.Fatal(err)
		}
		files = append(files, File{Path: ConfigDocPath, Content: doc})
	}
	// A removed module's chart template would outlive it otherwise.
	stale, err := filepath.Glob(filepath.Join(*root, ChartDir, "templates", "modules", "*.yaml"))
	if err != nil {
		log.Fatal(err)
	}
	for _, path := range stale {
		if err := os.Remove(path); err != nil {
			log.Fatal(err)
		}
	}
	for _, f := range files {
		path := filepath.Join(*root, f.Path)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			log.Fatal(err)
		}
		if err := os.WriteFile(path, f.Content, 0o644); err != nil {
			log.Fatal(err)
		}
	}
	fmt.Printf("modgen: %d modules, %d files\n", len(modules), len(files))
}
