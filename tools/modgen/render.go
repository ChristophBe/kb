package main

import (
	"bytes"
	"embed"
	"path"
	"slices"
	"strings"
	"text/template"
)

//go:embed templates/*.tmpl templates/helm/*.tmpl
var templateFS embed.FS

var templates = template.Must(template.New("").Funcs(template.FuncMap{
	"camel":  camel,
	"args":   args,
	"append": func(s []string, v ...string) []string { return append(slices.Clone(s), v...) },
}).ParseFS(templateFS, "templates/*.tmpl"))

// Areas are scopes for cross-cutting work that belongs to no module. Together
// with the module ids they form the scope list used by the issue forms.
var Areas = []string{"platform", "ui-shell", "infra"}

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

	scopes := make([]string, 0, len(modules)+len(Areas))
	for _, m := range modules {
		scopes = append(scopes, m.ID)
	}
	scopes = append(scopes, Areas...)

	bs := boundaries(modules)
	biome, err := biomeOverrides(bs)
	if err != nil {
		return nil, err
	}
	data := map[string]any{
		"Modules":    modules,
		"Scopes":     scopes,
		"Boundaries": bs,
		"Biome":      biome,
		"PyForbid":   pyPlatformForbidden(modules),
		"GoModule":   GoModule,
		"PyPlatform": PlatformPyPackage,
		"Images":     images(modules),
	}
	for _, out := range []struct{ path, tmpl string }{
		{"deploy/envoy/envoy.yaml", "envoy.yaml.tmpl"},
		{"compose.yaml", "compose.yaml.tmpl"},
		{"deploy/prometheus/prometheus.yml", "prometheus.yml.tmpl"},
		{"deploy/release.compose.yaml", "release.compose.yaml.tmpl"},
		{"apps/web/src/modules.gen.ts", "modules.gen.ts.tmpl"},
		{".github/ISSUE_TEMPLATE/epic.yml", "issue-epic.yml.tmpl"},
		{".github/ISSUE_TEMPLATE/feature.yml", "issue-feature.yml.tmpl"},
		{".github/ISSUE_TEMPLATE/chore.yml", "issue-chore.yml.tmpl"},
		{".github/ISSUE_TEMPLATE/bug.yml", "issue-bug.yml.tmpl"},
		{".golangci.yml", "golangci.yml.tmpl"},
		{".importlinter", "importlinter.tmpl"},
		{"biome.modules.jsonc", "biome.modules.jsonc.tmpl"},
	} {
		if err := add(out.path, out.tmpl, data); err != nil {
			return nil, err
		}
	}
	matrix, err := imagesJSON(modules)
	if err != nil {
		return nil, err
	}
	files = append(files, File{Path: "deploy/images.json", Content: matrix})
	var envoy []byte
	for _, f := range files {
		if f.Path == "deploy/envoy/envoy.yaml" {
			envoy = f.Content
		}
	}
	chart, err := helmFiles(modules, envoy)
	if err != nil {
		return nil, err
	}
	return append(files, chart...), nil
}

// args builds a map from alternating keys and values, so templates can pass
// several parameters to a nested template.
func args(kv ...any) map[string]any {
	m := make(map[string]any, len(kv)/2)
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1]
	}
	return m
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
