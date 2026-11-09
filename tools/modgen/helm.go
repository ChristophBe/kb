package main

import (
	"bytes"
	"path"
	"strconv"
	"strings"
	"text/template"
)

// ChartDir is the Helm chart of the whole stack. modgen writes its
// module-specific parts; the rest of the chart is maintained by hand.
const ChartDir = "deploy/helm/kb"

// The chart's own templates are Go templates too, so modgen's Helm templates
// use [[ ]] as delimiters and leave {{ }} to Helm.
var helmTemplates = template.Must(template.New("").Delims("[[", "]]").Funcs(template.FuncMap{
	"quote": func(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` },
}).ParseFS(templateFS, "templates/helm/*.tmpl"))

// resolvePeers fills in every service's Peers from its module's depends_on:
// the first service with a port of each dependency, as KB_<MODULE>_ADDR.
// Dependencies that serve no gRPC (event-only modules) get no address.
func resolvePeers(modules []Module) {
	addrs := map[string]Peer{}
	for _, m := range modules {
		for _, s := range m.Services {
			if s.Port != 0 {
				addrs[m.ID] = Peer{Env: "KB_" + strings.ToUpper(m.ID) + "_ADDR", Addr: s.Name + ":" + strconv.Itoa(s.Port)}
				break
			}
		}
	}
	for i := range modules {
		var peers []Peer
		for _, dep := range modules[i].DependsOn {
			if p, ok := addrs[dep]; ok {
				peers = append(peers, p)
			}
		}
		for j := range modules[i].Services {
			modules[i].Services[j].Peers = peers
		}
	}
}

// grpcPrefixes are the URL path prefixes ("/kb.x.v1.XService") of every gRPC
// service with at least one public method; the chart's Ingress sends them to
// Envoy, which routes the methods.
func grpcPrefixes(modules []Module) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range modules {
		for _, s := range m.Services {
			for _, route := range s.Routes {
				prefix := path.Dir(route)
				if !seen[prefix] {
					seen[prefix] = true
					out = append(out, prefix)
				}
			}
		}
	}
	return out
}

// helmFiles renders the chart's generated files: one template per module with
// components, the values (defaults for every component) and the gateway
// routes for the Ingress.
func helmFiles(modules []Module, envoy []byte) ([]File, error) {
	var files []File
	add := func(p, tmpl string, data any) error {
		var buf bytes.Buffer
		if err := helmTemplates.ExecuteTemplate(&buf, tmpl, data); err != nil {
			return err
		}
		files = append(files, File{Path: path.Join(ChartDir, p), Content: buf.Bytes()})
		return nil
	}
	for _, m := range modules {
		if len(m.Services) == 0 {
			continue
		}
		if err := add("templates/modules/"+m.ID+".yaml", "module.yaml.tmpl", m); err != nil {
			return nil, err
		}
	}
	data := map[string]any{"Modules": modules, "Prefixes": grpcPrefixes(modules)}
	if err := add("values.yaml", "values.yaml.tmpl", data); err != nil {
		return nil, err
	}
	if err := add("templates/_modules.gen.tpl", "modules.gen.tpl.tmpl", data); err != nil {
		return nil, err
	}
	// The same Envoy config compose uses; the chart fills in its ${KB_OIDC_*}
	// placeholders (templates/envoy.yaml) instead of entrypoint.sh.
	files = append(files, File{Path: path.Join(ChartDir, "files/envoy.yaml"), Content: envoy})
	return files, nil
}
