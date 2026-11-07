package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

// Module is the parsed form of modules/<id>/module.yaml.
type Module struct {
	ID          string    `yaml:"id"`
	Title       string    `yaml:"title"`
	Description string    `yaml:"description"`
	Services    []Service `yaml:"services"`
	// UI is the npm package name of the module's UI, empty when it has none.
	UI string `yaml:"ui"`
	// DependsOn lists the modules whose contract (RPCs or events) this module
	// uses; only their api/ packages may be imported.
	DependsOn []string `yaml:"depends_on"`
	// Consumes lists the event subjects this module subscribes to.
	Consumes []string `yaml:"consumes"`
	// HasProto is set when the module defines an API under proto/.
	HasProto bool `yaml:"-"`
	// PyPackages are the importable Python packages of the module's
	// components (modules/<id>/*/src/<pkg>), sorted.
	PyPackages []string `yaml:"-"`
}

// Service is one deployable component of a module.
type Service struct {
	Name     string `yaml:"name"`
	Language string `yaml:"language"`
	// Port is the gRPC port; 0 for components that serve no API (workers).
	Port int `yaml:"port"`
	// GRPCServices are the fully qualified gRPC services the component
	// serves; Envoy routes their public methods to the browser.
	GRPCServices []string `yaml:"grpc_services"`
	// Internal lists what only other modules' services may call: whole
	// services ("kb.x.v1.XService") or methods ("kb.x.v1.XService/Method").
	// Envoy has no route for them, so browsers get 404 (UNIMPLEMENTED);
	// services reach each other directly, not through Envoy.
	Internal []string `yaml:"internal"`
	// Routes are the gRPC paths ("/kb.x.v1.XService/Method") Envoy routes to
	// the component: every method of GRPCServices that is not internal.
	Routes []string `yaml:"-"`
}

var (
	idPattern = regexp.MustCompile(`^[a-z][a-z0-9]*$`)
	// subjectPattern matches kb.<owning module>.<event>.
	subjectPattern = regexp.MustCompile(`^kb\.([a-z][a-z0-9]*)\.[a-z][a-z0-9_]*$`)
)

// LoadModules reads every modules/*/module.yaml, sorted by id.
func LoadModules(dir string) ([]Module, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*", "module.yaml"))
	if err != nil {
		return nil, err
	}
	var modules []Module
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var m Module
		if err := yaml.Unmarshal(raw, &m); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		if err := m.validate(filepath.Base(filepath.Dir(path))); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		protoDir := filepath.Join(filepath.Dir(path), "proto")
		if info, err := os.Stat(protoDir); err == nil && info.IsDir() {
			m.HasProto = true
		}
		defined, err := protoMethods(protoDir)
		if err != nil {
			return nil, err
		}
		for i := range m.Services {
			if err := m.Services[i].resolveRoutes(defined); err != nil {
				return nil, fmt.Errorf("%s: %w", path, err)
			}
		}
		inits, err := filepath.Glob(filepath.Join(filepath.Dir(path), "*", "src", "*", "__init__.py"))
		if err != nil {
			return nil, err
		}
		for _, init := range inits {
			m.PyPackages = append(m.PyPackages, filepath.Base(filepath.Dir(init)))
		}
		slices.Sort(m.PyPackages)
		modules = append(modules, m)
	}
	slices.SortFunc(modules, func(a, b Module) int { return cmpString(a.ID, b.ID) })
	ports := map[int]string{}
	for _, m := range modules {
		for _, s := range m.Services {
			if s.Port == 0 {
				continue
			}
			if other, ok := ports[s.Port]; ok {
				return nil, fmt.Errorf("port %d used by both %s and %s", s.Port, other, s.Name)
			}
			ports[s.Port] = s.Name
		}
	}
	if err := validateDependencies(modules); err != nil {
		return nil, err
	}
	return modules, nil
}

// validateDependencies checks depends_on and consumes across all modules:
// dependencies exist and form no cycle, and every consumed subject belongs to
// the module itself or to one of its dependencies.
func validateDependencies(modules []Module) error {
	byID := map[string]Module{}
	for _, m := range modules {
		byID[m.ID] = m
	}
	for _, m := range modules {
		seen := map[string]bool{}
		for _, dep := range m.DependsOn {
			switch {
			case dep == m.ID:
				return fmt.Errorf("module %s: depends on itself", m.ID)
			case seen[dep]:
				return fmt.Errorf("module %s: %s listed twice in depends_on", m.ID, dep)
			}
			if _, ok := byID[dep]; !ok {
				return fmt.Errorf("module %s: depends on unknown module %q", m.ID, dep)
			}
			seen[dep] = true
		}
		for _, subject := range m.Consumes {
			match := subjectPattern.FindStringSubmatch(subject)
			if match == nil {
				return fmt.Errorf("module %s: consumed subject %q is not kb.<module>.<event>", m.ID, subject)
			}
			if owner := match[1]; owner != m.ID && !seen[owner] {
				return fmt.Errorf("module %s: consumes %s, but %s is not in depends_on", m.ID, subject, owner)
			}
		}
	}
	// Depth-first search; a module on the current path seen again is a cycle.
	const (
		visiting = 1
		done     = 2
	)
	state := map[string]int{}
	var visit func(id string, path []string) error
	visit = func(id string, path []string) error {
		switch state[id] {
		case visiting:
			return fmt.Errorf("dependency cycle: %s", strings.Join(append(path, id), " -> "))
		case done:
			return nil
		}
		state[id] = visiting
		for _, dep := range byID[id].DependsOn {
			if err := visit(dep, append(path, id)); err != nil {
				return err
			}
		}
		state[id] = done
		return nil
	}
	for _, m := range modules {
		if err := visit(m.ID, nil); err != nil {
			return err
		}
	}
	return nil
}

// Allows reports whether m may use the contract of module dep.
func (m Module) Allows(dep string) bool {
	return dep == m.ID || slices.Contains(m.DependsOn, dep)
}

func (m Module) validate(dirName string) error {
	if !idPattern.MatchString(m.ID) {
		return fmt.Errorf("invalid id %q", m.ID)
	}
	if m.ID != dirName {
		return fmt.Errorf("id %q does not match directory %q", m.ID, dirName)
	}
	if m.Title == "" {
		return fmt.Errorf("title is required")
	}
	for _, s := range m.Services {
		if s.Name == "" {
			return fmt.Errorf("service name is required")
		}
		if s.Language != "go" && s.Language != "python" {
			return fmt.Errorf("service %s: language must be go or python", s.Name)
		}
		if len(s.GRPCServices) > 0 && s.Port == 0 {
			return fmt.Errorf("service %s: grpc_services require a port", s.Name)
		}
	}
	return nil
}

func cmpString(a, b string) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}
