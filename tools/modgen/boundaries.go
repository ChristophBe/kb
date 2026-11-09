package main

import (
	"encoding/json"
	"path"
)

// PlatformPyPackage is the shared Python package every component may import.
const PlatformPyPackage = "kb_platform"

// boundary is the import policy of one module, rendered into the Go
// (depguard), Python (import-linter) and TypeScript (biome) lint configs.
type boundary struct {
	ID string
	// GoDeny are import roots the module must not use; GoAllow are the
	// exceptions below them (the api/go packages of its dependencies).
	GoDeny  []goRule
	GoAllow []string
	// PySources are the module's Python packages; PyForbidden what they must
	// not import.
	PySources   []string
	PyForbidden []string
	// HasUI is set when the module ships a UI package.
	HasUI bool
	// TSAllowAPIs are the @kb/<id>-api packages the UI may import.
	TSAllowAPIs []string
}

type goRule struct{ Pkg, Desc string }

func boundaries(modules []Module) []boundary {
	out := make([]boundary, 0, len(modules))
	for _, m := range modules {
		b := boundary{ID: m.ID, PySources: m.PyPackages, HasUI: m.UI != ""}
		b.TSAllowAPIs = append(b.TSAllowAPIs, "@kb/common-api")
		for _, other := range modules {
			if other.ID == m.ID {
				b.TSAllowAPIs = append(b.TSAllowAPIs, "@kb/"+m.ID+"-api")
				continue
			}
			root := path.Join(GoModule, "modules", other.ID)
			if m.Allows(other.ID) {
				b.GoDeny = append(b.GoDeny, goRule{root, "only the api/ of a module in depends_on may be imported"})
				b.GoAllow = append(b.GoAllow, path.Join(root, "api", "go"))
				b.TSAllowAPIs = append(b.TSAllowAPIs, "@kb/"+other.ID+"-api")
			} else {
				b.GoDeny = append(b.GoDeny, goRule{root, other.ID + " is not in depends_on of " + m.ID})
				if other.HasProto {
					b.PyForbidden = append(b.PyForbidden, "kb."+other.ID)
				}
			}
			b.PyForbidden = append(b.PyForbidden, other.PyPackages...)
		}
		out = append(out, b)
	}
	return out
}

// pyPlatformForbidden is everything platform/ must not import: every
// module's Python packages and generated API packages.
func pyPlatformForbidden(modules []Module) []string {
	var out []string
	for _, m := range modules {
		if m.HasProto {
			out = append(out, "kb."+m.ID)
		}
		out = append(out, m.PyPackages...)
	}
	return out
}

// relativeEscape matches relative imports that go up three or more levels,
// i.e. out of a package's src/ directory into another package.
var relativeEscape = []string{"../../../*", "../../../**"}

type biomePattern struct {
	Group   []string `json:"group"`
	Message string   `json:"message"`
}

// biomeOverrides renders the TypeScript boundaries as biome overrides with
// noRestrictedImports: module UIs import no other module UI and only the API
// packages of declared dependencies; platform/ imports no module at all.
func biomeOverrides(bs []boundary) (string, error) {
	type override struct {
		Includes []string `json:"includes"`
		Linter   any      `json:"linter"`
	}
	rule := func(patterns []biomePattern) any {
		return map[string]any{"rules": map[string]any{"style": map[string]any{
			"noRestrictedImports": map[string]any{
				"level":   "error",
				"options": map[string]any{"patterns": patterns},
			},
		}}}
	}
	escape := biomePattern{relativeEscape, "Import other packages by name; relative imports stay inside the package."}
	overrides := []override{{
		Includes: []string{"platform/**"},
		Linter: rule([]biomePattern{
			{[]string{"@kb/module-*", "@kb/module-*/**", "!@kb/module-sdk", "!@kb/module-sdk/**"}, "platform/ must not import module UIs."},
			{[]string{"@kb/*-api", "@kb/*-api/**", "!@kb/common-api", "!@kb/common-api/**"}, "platform/ must not import module APIs."},
			escape,
		}),
	}}
	for _, b := range bs {
		if !b.HasUI {
			continue
		}
		apis := []string{"@kb/*-api", "@kb/*-api/**"}
		for _, a := range b.TSAllowAPIs {
			apis = append(apis, "!"+a, "!"+a+"/**")
		}
		overrides = append(overrides, override{
			Includes: []string{"modules/" + b.ID + "/ui/**"},
			Linter: rule([]biomePattern{
				{[]string{"@kb/module-*", "@kb/module-*/**", "!@kb/module-sdk", "!@kb/module-sdk/**", "!@kb/module-" + b.ID, "!@kb/module-" + b.ID + "/**"}, "A module UI never imports another module's UI; link to its routes instead."},
				{apis, "Only the API packages of modules in depends_on (module.yaml) may be imported."},
				escape,
			}),
		})
	}
	out, err := json.MarshalIndent(map[string]any{"overrides": overrides}, "", "  ")
	return string(out), err
}
