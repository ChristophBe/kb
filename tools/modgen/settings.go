package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// ConfigDocPath is the generated reference of every KB_* variable.
const ConfigDocPath = "docs/configuration.md"

// Setting is one environment variable in docs/configuration.md.
type Setting struct {
	Env         string
	Default     string
	Description string
	// UsedIn lists where a compose-level variable appears.
	UsedIn []string
}

// SettingsGroup is one section of docs/configuration.md.
type SettingsGroup struct {
	Title string
	// Intro says where the settings come from, in Markdown.
	Intro    string
	Settings []Setting
	// UsedIn adds the "Used in" column (compose variables).
	UsedIn bool
}

// PySetting is one field of a Python Settings class, as tools/modgen/settings.py
// reports it.
type PySetting struct {
	Field       string `json:"field"`
	Env         string `json:"env"`
	Default     string `json:"default"`
	Description string `json:"description"`
	// Own is set for fields the component's class declares (or redeclares
	// with another default), unset for those it inherits.
	Own bool `json:"own"`
}

// PyRunner returns the settings of Python components by component name,
// given "<component>=<config module>" arguments.
type PyRunner func(root string, args []string) (map[string][]PySetting, error)

// UvRunner runs tools/modgen/settings.py in the repository's uv environment.
func UvRunner(root string, args []string) (map[string][]PySetting, error) {
	cmd := exec.CommandContext(context.Background(), "uv", append([]string{"run", "--project", root, "--frozen", "python", "-I",
		filepath.Join(root, "tools", "modgen", "settings.py"), root}, args...)...)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("reading Python settings (uv run tools/modgen/settings.py): %w", err)
	}
	var result map[string][]PySetting
	return result, json.Unmarshal(out, &result)
}

// The shared settings and where the generator reads them.
const (
	goBaseDir    = "platform/go/config"
	goBaseType   = "Base"
	pyBaseModule = "knowcel_platform.config:PlatformSettings"
	envExample   = ".env.example"
	envoyScript  = "deploy/envoy/entrypoint.sh"
	webScript    = "deploy/docker/web/40-runtime-config.sh"
)

// CollectSettings reads every component's settings: Go config structs (field
// comments and env/envDefault tags), Python Settings classes (through py),
// the Envoy and web start scripts, and the variables of the compose files.
// The last three are described by their comment in .env.example.
func CollectSettings(root string, modules []Module, py PyRunner) ([]SettingsGroup, error) {
	goBase, err := goSettings(root, goBaseDir, goBaseType)
	if err != nil {
		return nil, err
	}
	pyArgs := []string{"platform=" + pyBaseModule}
	for _, m := range modules {
		for _, s := range m.Services {
			if s.Language == "python" {
				pkg, err := pyPackage(root, m.ID, s.Name)
				if err != nil {
					return nil, err
				}
				pyArgs = append(pyArgs, s.Name+"="+pkg+".config")
			}
		}
	}
	pySettings, err := py(root, pyArgs)
	if err != nil {
		return nil, err
	}

	groups := []SettingsGroup{
		{Title: "Every Go service", Intro: "Read by every Go service, from `config.Base` in [platform/go/config](../platform/go/config/config.go). Each service's section gives its port defaults.", Settings: portsPerComponent(goBase)},
		{Title: "Every Python component", Intro: "Read by every Python component, from `PlatformSettings` in [knowcel_platform.config](../platform/python/src/knowcel_platform/config.py). Each component's section gives its port defaults.", Settings: portsPerComponent(pyOwn(pySettings["platform"], false))},
	}
	defined := map[string]bool{}
	for _, s := range slices.Concat(groups[0].Settings, groups[1].Settings) {
		defined[s.Env] = true
	}
	for _, m := range modules {
		for _, s := range m.Services {
			var own []Setting
			var source string
			switch s.Language {
			case "go":
				dir := strings.TrimPrefix(s.Cmd, "./")
				all, err := goSettings(root, dir, "Config")
				if err != nil {
					return nil, err
				}
				// Base's settings are listed once, above.
				for _, setting := range all {
					if !slices.ContainsFunc(goBase, func(b Setting) bool { return b.Env == setting.Env }) {
						own = append(own, setting)
					}
				}
				source = fmt.Sprintf("From `Config` in [%s](../%s/main.go), in addition to the settings every Go service reads.", dir, dir)
			case "python":
				fields := pySettings[s.Name]
				if err := checkPyPorts(s, fields); err != nil {
					return nil, err
				}
				own = pyOwn(fields, true)
				pkg, _ := pyPackage(root, m.ID, s.Name)
				file := path.Join(pyComponentDir(root, m.ID, s.Name), "src", pkg, "config.py")
				source = fmt.Sprintf("From `Settings` in [%s](../%s), in addition to the settings every Python component reads.", file, file)
			}
			base := groups[0]
			if s.Language == "python" {
				base = groups[1]
			}
			own = slices.Concat(componentPorts(s, base), own)
			for _, setting := range own {
				defined[setting.Env] = true
			}
			groups = append(groups, SettingsGroup{Title: s.Name, Intro: source, Settings: own})
		}
	}

	examples, err := envExampleDocs(filepath.Join(root, envExample))
	if err != nil {
		return nil, err
	}
	for _, script := range []struct{ title, file string }{
		{"Gateway (Envoy)", envoyScript},
		{"Web shell", webScript},
	} {
		vars, err := scriptVars(root, []string{script.file})
		if err != nil {
			return nil, err
		}
		describeFromExample(vars, examples)
		for _, v := range vars {
			defined[v.Env] = true
		}
		groups = append(groups, SettingsGroup{Title: script.title, Intro: fmt.Sprintf("Read when the container starts, by [%s](../%s).", script.file, script.file), Settings: vars})
	}

	composeFiles := []string{"compose.yaml"}
	for _, pattern := range []string{"deploy/*.compose.yaml", "modules/*/compose.yaml"} {
		matches, err := filepath.Glob(filepath.Join(root, pattern))
		if err != nil {
			return nil, err
		}
		for _, m := range matches {
			rel, _ := filepath.Rel(root, m)
			composeFiles = append(composeFiles, filepath.ToSlash(rel))
		}
	}
	all, err := scriptVars(root, composeFiles)
	if err != nil {
		return nil, err
	}
	var compose []Setting
	for _, v := range all {
		if !defined[v.Env] {
			compose = append(compose, v)
		}
	}
	describeFromExample(compose, examples)
	groups = append(groups, SettingsGroup{Title: "Compose", Intro: "Substituted by Docker Compose into the compose files: host ports, the release version and the like. Variables that only pass a component setting on are listed with the component.", Settings: compose, UsedIn: true})

	for _, g := range groups {
		for _, s := range g.Settings {
			if s.Description == "" {
				return nil, fmt.Errorf("%s: %s has no description (a comment above its field, or in %s)", g.Title, s.Env, envExample)
			}
		}
	}
	return groups, nil
}

// portsPerComponent replaces the defaults of the port settings, which each
// component sets from its module.yaml.
func portsPerComponent(settings []Setting) []Setting {
	out := slices.Clone(settings)
	for i, s := range out {
		if s.Env == "KB_GRPC_PORT" || s.Env == "KB_METRICS_PORT" {
			out[i].Default = "per component"
		}
	}
	return out
}

// componentPorts are the port settings of s with its module.yaml defaults.
func componentPorts(s Service, base SettingsGroup) []Setting {
	describe := func(env string) string {
		for _, setting := range base.Settings {
			if setting.Env == env {
				return setting.Description
			}
		}
		return ""
	}
	var ports []Setting
	if s.Port != 0 {
		ports = append(ports, Setting{Env: "KB_GRPC_PORT", Default: strconv.Itoa(s.Port), Description: describe("KB_GRPC_PORT")})
	}
	return append(ports, Setting{Env: "KB_METRICS_PORT", Default: strconv.Itoa(s.MetricsPort), Description: describe("KB_METRICS_PORT")})
}

// checkPyPorts fails when a Python component's port defaults differ from
// its module.yaml, which compose and the Helm chart use.
func checkPyPorts(s Service, fields []PySetting) error {
	want := map[string]int{"KB_GRPC_PORT": s.Port, "KB_METRICS_PORT": s.MetricsPort}
	for _, f := range fields {
		if port, ok := want[f.Env]; ok && f.Default != strconv.Itoa(port) {
			return fmt.Errorf("%s: %s defaults to %s in its Settings, but module.yaml says %d", s.Name, f.Env, f.Default, port)
		}
	}
	return nil
}

// pyOwn converts the fields declared by the class itself (own) or all of
// them, leaving out the ports, which componentPorts lists.
func pyOwn(fields []PySetting, own bool) []Setting {
	var out []Setting
	for _, f := range fields {
		if own && (!f.Own || f.Env == "KB_GRPC_PORT" || f.Env == "KB_METRICS_PORT") {
			continue
		}
		out = append(out, Setting{Env: f.Env, Default: f.Default, Description: f.Description})
	}
	return out
}

// pyComponentDir is the directory of Python component name (its
// pyproject.toml is named knowcel-<name>), relative to root.
func pyComponentDir(root, module, name string) string {
	matches, _ := filepath.Glob(filepath.Join(root, "modules", module, "*", "pyproject.toml"))
	for _, m := range matches {
		raw, err := os.ReadFile(m)
		if err == nil && bytes.Contains(raw, []byte(`name = "knowcel-`+name+`"`)) {
			rel, _ := filepath.Rel(root, filepath.Dir(m))
			return filepath.ToSlash(rel)
		}
	}
	return ""
}

// pyPackage is the importable package of a Python component: the one
// directory below its src/ with a config.py.
func pyPackage(root, module, name string) (string, error) {
	dir := pyComponentDir(root, module, name)
	if dir == "" {
		return "", fmt.Errorf("%s: no modules/%s/*/pyproject.toml named knowcel-%s", name, module, name)
	}
	matches, err := filepath.Glob(filepath.Join(root, dir, "src", "*", "config.py"))
	if err != nil || len(matches) != 1 {
		return "", fmt.Errorf("%s: want one %s/src/<package>/config.py with its Settings, found %d", name, dir, len(matches))
	}
	return filepath.Base(filepath.Dir(matches[0])), nil
}

// goSettings reads the settings of struct typeName in the package in dir
// (relative to root): fields with an env tag, embedded or nested structs
// (resolved through their import, with their envPrefix), all prefixed KB_.
func goSettings(root, dir, typeName string) ([]Setting, error) {
	return goStruct(root, dir, typeName, "KB_")
}

func goStruct(root, dir, typeName, prefix string) ([]Setting, error) {
	files, err := parseGoPackage(filepath.Join(root, dir))
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		for _, decl := range f.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.TYPE {
				continue
			}
			for _, spec := range gen.Specs {
				ts := spec.(*ast.TypeSpec)
				if ts.Name.Name != typeName {
					continue
				}
				st, ok := ts.Type.(*ast.StructType)
				if !ok {
					return nil, fmt.Errorf("%s: %s is not a struct", dir, typeName)
				}
				return goFields(root, dir, f, st, prefix)
			}
		}
	}
	return nil, fmt.Errorf("%s: no type %s", dir, typeName)
}

func goFields(root, dir string, file *ast.File, st *ast.StructType, prefix string) ([]Setting, error) {
	var out []Setting
	for _, field := range st.Fields.List {
		var tag reflect.StructTag
		if field.Tag != nil {
			raw, err := strconv.Unquote(field.Tag.Value)
			if err != nil {
				return nil, err
			}
			tag = reflect.StructTag(raw)
		}
		if name, _, _ := strings.Cut(tag.Get("env"), ","); name != "" {
			fieldName := ""
			if len(field.Names) > 0 {
				fieldName = field.Names[0].Name
			}
			def := tag.Get("envDefault")
			if t, ok := field.Type.(*ast.Ident); ok && t.Name == "bool" && def == "" {
				def = "false"
			}
			out = append(out, Setting{Env: prefix + name, Default: def, Description: goDoc(fieldName, field)})
			continue
		}
		// A nested settings struct: local (Limits) or imported (storage.Config).
		subDir, typeName := dir, ""
		switch t := field.Type.(type) {
		case *ast.Ident:
			if !isStructIn(root, dir, t.Name) {
				continue
			}
			typeName = t.Name
		case *ast.SelectorExpr:
			pkg, ok := t.X.(*ast.Ident)
			if !ok {
				continue
			}
			imp := importPath(file, pkg.Name)
			if !strings.HasPrefix(imp, GoModule+"/") {
				continue // not a settings struct of this repository
			}
			subDir, typeName = strings.TrimPrefix(imp, GoModule+"/"), t.Sel.Name
		default:
			continue
		}
		nested, err := goStruct(root, subDir, typeName, prefix+tag.Get("envPrefix"))
		if err != nil {
			return nil, err
		}
		out = append(out, nested...)
	}
	return out, nil
}

func isStructIn(root, dir, typeName string) bool {
	_, err := goStruct(root, dir, typeName, "")
	return err == nil
}

// goDoc is a field's comment as one sentence-cased line, without the field
// name it starts with by Go convention ("LogLevel is the lowest…" → "The
// lowest…").
func goDoc(name string, field *ast.Field) string {
	group := field.Doc
	if group == nil {
		group = field.Comment
	}
	if group == nil {
		return ""
	}
	text := strings.Join(strings.Fields(group.Text()), " ")
	if name != "" {
		for _, lead := range []string{name + " is ", name + " are ", name + " "} {
			if rest, ok := strings.CutPrefix(text, lead); ok {
				text = rest
				break
			}
		}
	}
	if text != "" {
		text = strings.ToUpper(text[:1]) + text[1:]
	}
	return text
}

func importPath(file *ast.File, name string) string {
	for _, imp := range file.Imports {
		p, _ := strconv.Unquote(imp.Path.Value)
		if (imp.Name != nil && imp.Name.Name == name) || (imp.Name == nil && path.Base(p) == name) {
			return p
		}
	}
	return ""
}

func parseGoPackage(dir string) ([]*ast.File, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}
	fset := token.NewFileSet()
	var files []*ast.File
	for _, p := range paths {
		if strings.HasSuffix(p, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, p, nil, parser.ParseComments)
		if err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("%s: no Go files", dir)
	}
	return files, nil
}

// varRef matches ${KB_X}, ${KB_X:-default}, ${KB_X-default} and
// ${KB_X:?message}, but not an escaped \${KB_X} (a sed placeholder).
var varRef = regexp.MustCompile(`\$\{(KB_[A-Z0-9_]+)(?:(:?-)([^}]*)|:?\?[^}]*)?\}`)

// scriptVars lists the KB_* variables referenced in files (relative to
// root), in order of first appearance, with the first default given.
func scriptVars(root string, files []string) ([]Setting, error) {
	var out []Setting
	index := map[string]int{}
	for _, file := range files {
		raw, err := os.ReadFile(filepath.Join(root, file))
		if err != nil {
			return nil, err
		}
		text := string(raw)
		for _, m := range varRef.FindAllStringSubmatchIndex(text, -1) {
			if m[0] > 0 && text[m[0]-1] == '\\' {
				continue
			}
			env, def := text[m[2]:m[3]], ""
			if m[6] >= 0 {
				def = text[m[6]:m[7]]
			}
			i, seen := index[env]
			if !seen {
				i = len(out)
				index[env] = i
				out = append(out, Setting{Env: env})
			}
			if out[i].Default == "" {
				out[i].Default = def
			}
			if !slices.Contains(out[i].UsedIn, file) {
				out[i].UsedIn = append(out[i].UsedIn, file)
			}
		}
	}
	return out, nil
}

// envAssign matches a variable line of .env.example, set or commented out.
var envAssign = regexp.MustCompile(`^#?\s*([A-Z][A-Z0-9_]*)=`)

// envExampleDocs reads the description of each variable in .env.example:
// the comment paragraph above the run of variable lines it belongs to.
func envExampleDocs(file string) (map[string]string, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	docs := map[string]string{}
	var paragraph []string
	afterVar := false
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		switch m := envAssign.FindStringSubmatch(line); {
		case m != nil:
			if _, ok := docs[m[1]]; !ok {
				docs[m[1]] = strings.Join(paragraph, " ")
			}
			afterVar = true
		case strings.HasPrefix(line, "#"):
			if afterVar {
				paragraph, afterVar = nil, false
			}
			paragraph = append(paragraph, strings.TrimSpace(strings.TrimPrefix(line, "#")))
		default:
			paragraph, afterVar = nil, false
		}
	}
	return docs, sc.Err()
}

func describeFromExample(settings []Setting, docs map[string]string) {
	for i, s := range settings {
		settings[i].Description = docs[s.Env]
	}
}

// ConfigDoc renders docs/configuration.md.
func ConfigDoc(groups []SettingsGroup) ([]byte, error) {
	var buf bytes.Buffer
	err := templates.ExecuteTemplate(&buf, "configuration.md.tmpl", map[string]any{"Groups": groups})
	return buf.Bytes(), err
}

// cell makes text safe for a Markdown table cell.
func cell(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "|", `\|`), "\n", " ")
}
