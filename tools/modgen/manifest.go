package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"

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
	// HasProto is set when the module defines an API under proto/.
	HasProto bool `yaml:"-"`
}

// Service is one deployable component of a module.
type Service struct {
	Name     string `yaml:"name"`
	Language string `yaml:"language"`
	// Port is the gRPC port; 0 for components that serve no API (workers).
	Port int `yaml:"port"`
	// GRPCServices are fully qualified service names routed through Envoy.
	GRPCServices []string `yaml:"grpc_services"`
}

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9]*$`)

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
		if info, err := os.Stat(filepath.Join(filepath.Dir(path), "proto")); err == nil && info.IsDir() {
			m.HasProto = true
		}
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
	return modules, nil
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
