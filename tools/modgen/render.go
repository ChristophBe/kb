package main

import (
	"bytes"
	"embed"
	"path"
	"strings"
	"text/template"
)

//go:embed templates/*.tmpl
var templateFS embed.FS

var templates = template.Must(template.New("").Funcs(template.FuncMap{
	"camel": camel,
}).ParseFS(templateFS, "templates/*.tmpl"))

// GoModule is the root Go module path; generated Go code lives below it.
const GoModule = "github.com/christoph/kb"

// File is one generated output, relative to the repository root.
type File struct {
	Path    string
	Content []byte
}

// apiPackage describes one proto tree whose code is generated into
// <Dir>/api/{go,python,ts}.
type apiPackage struct {
	Name string // short name used for package names, e.g. "document"
	Dir  string // owning directory, e.g. "modules/document"
	// Common is true for the shared platform package that others import.
	Common bool
}

// Render produces all generated files for the given modules.
func Render(modules []Module) ([]File, error) {
	var files []File
	add := func(p, tmpl string, data any) error {
		var buf bytes.Buffer
		if err := templates.ExecuteTemplate(&buf, tmpl, data); err != nil {
			return err
		}
		files = append(files, File{Path: p, Content: buf.Bytes()})
		return nil
	}

	pkgs := []apiPackage{{Name: "common", Dir: "platform", Common: true}}
	for _, m := range modules {
		if m.HasProto {
			pkgs = append(pkgs, apiPackage{Name: m.ID, Dir: path.Join("modules", m.ID)})
		}
	}
	for _, p := range pkgs {
		data := map[string]any{"Pkg": p, "GoModule": GoModule}
		if err := add(path.Join(p.Dir, "buf.gen.yaml"), "buf.gen.yaml.tmpl", data); err != nil {
			return nil, err
		}
		if err := add(path.Join(p.Dir, "api/python/pyproject.toml"), "pyproject.toml.tmpl", data); err != nil {
			return nil, err
		}
		if err := add(path.Join(p.Dir, "api/ts/package.json"), "package.json.tmpl", data); err != nil {
			return nil, err
		}
	}

	data := map[string]any{"Modules": modules}
	for _, out := range []struct{ path, tmpl string }{
		{"deploy/envoy/envoy.yaml", "envoy.yaml.tmpl"},
		{"compose.yaml", "compose.yaml.tmpl"},
		{"apps/web/src/modules.gen.ts", "modules.gen.ts.tmpl"},
	} {
		if err := add(out.path, out.tmpl, data); err != nil {
			return nil, err
		}
	}
	return files, nil
}

// camel turns "document" or "foo-bar" into "document" / "fooBar".
func camel(s string) string {
	parts := strings.Split(s, "-")
	for i := 1; i < len(parts); i++ {
		if parts[i] != "" {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, "")
}
