package main

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files")

func TestRenderGolden(t *testing.T) {
	modules, err := LoadModules("testdata/modules")
	if err != nil {
		t.Fatal(err)
	}
	files, err := Render(modules)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		golden := filepath.Join("testdata/golden", f.Path)
		if *update {
			if err := os.MkdirAll(filepath.Dir(golden), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(golden, f.Content, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(golden)
		if err != nil {
			t.Fatalf("%s: %v (run go test ./modgen -update)", f.Path, err)
		}
		if string(want) != string(f.Content) {
			t.Errorf("%s differs from golden file; run go test ./modgen -update and review the diff", f.Path)
		}
	}
}

func TestLoadModulesRejectsInvalidManifests(t *testing.T) {
	cases := map[string]string{
		"id mismatch":   "id: other\ntitle: X\n",
		"bad language":  "id: x\ntitle: X\nservices: [{name: s, language: rust}]\n",
		"missing port":  "id: x\ntitle: X\nservices: [{name: s, language: go, grpc_services: [a.B]}]\n",
		"missing title": "id: x\n",
	}
	for name, manifest := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.MkdirAll(filepath.Join(dir, "x"), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "x", "module.yaml"), []byte(manifest), 0o644); err != nil {
				t.Fatal(err)
			}
			if _, err := LoadModules(dir); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestLoadModulesRejectsDuplicatePorts(t *testing.T) {
	dir := t.TempDir()
	for _, id := range []string{"a", "b"} {
		manifest := "id: " + id + "\ntitle: T\nservices: [{name: " + id + "-svc, language: go, port: 9000}]\n"
		if err := os.MkdirAll(filepath.Join(dir, id), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, id, "module.yaml"), []byte(manifest), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := LoadModules(dir); err == nil || !strings.Contains(err.Error(), "port 9000") {
		t.Fatalf("err = %v, want duplicate port error", err)
	}
}

func TestLoadModulesValidatesDependencies(t *testing.T) {
	cases := map[string]map[string]string{
		"unknown dependency": {"a": "depends_on: [nope]\n"},
		"self dependency":    {"a": "depends_on: [a]\n"},
		"duplicate":          {"a": "depends_on: [b, b]\n", "b": ""},
		"cycle":              {"a": "depends_on: [b]\n", "b": "depends_on: [c]\n", "c": "depends_on: [a]\n"},
		"bad subject":        {"a": "consumes: [ingestion.uploaded]\n"},
		"undeclared subject": {"a": "consumes: [kb.b.created]\n", "b": ""},
	}
	for name, manifests := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			for id, extra := range manifests {
				writeManifest(t, dir, id, "id: "+id+"\ntitle: X\n"+extra)
			}
			if _, err := LoadModules(dir); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestLoadModulesAcceptsDeclaredDependencies(t *testing.T) {
	dir := t.TempDir()
	writeManifest(t, dir, "a", "id: a\ntitle: A\ndepends_on: [b]\nconsumes: [kb.a.done, kb.b.created]\n")
	writeManifest(t, dir, "b", "id: b\ntitle: B\n")
	modules, err := LoadModules(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !modules[0].Allows("b") || modules[1].Allows("a") {
		t.Errorf("Allows: a→b should be allowed, b→a not")
	}
}

func writeManifest(t *testing.T, dir, id, manifest string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, id), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, id, "module.yaml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
}
