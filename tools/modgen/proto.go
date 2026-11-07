package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	protoLineComment  = regexp.MustCompile(`//[^\n]*`)
	protoBlockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
	protoPackage      = regexp.MustCompile(`\bpackage\s+([A-Za-z_][\w.]*)\s*;`)
	protoService      = regexp.MustCompile(`\bservice\s+([A-Za-z_]\w*)\s*\{`)
	protoRPC          = regexp.MustCompile(`\brpc\s+([A-Za-z_]\w*)\s*\(`)
)

// protoMethods maps every gRPC service defined in the .proto files below dir
// (fully qualified, e.g. "kb.notes.v1.NotesService") to its method names in
// declaration order. It understands the subset of the proto grammar modgen
// needs: comments, the package statement and service blocks with rpcs.
func protoMethods(dir string) (map[string][]string, error) {
	services := map[string][]string{}
	err := filepath.WalkDir(dir, func(file string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || filepath.Ext(file) != ".proto" {
			return err
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		src := protoLineComment.ReplaceAllString(protoBlockComment.ReplaceAllString(string(raw), ""), "")
		pkg := ""
		if m := protoPackage.FindStringSubmatch(src); m != nil {
			pkg = m[1] + "."
		}
		for _, loc := range protoService.FindAllStringSubmatchIndex(src, -1) {
			name := pkg + src[loc[2]:loc[3]]
			body, ok := block(src[loc[1]:])
			if !ok {
				return fmt.Errorf("%s: service %s: unbalanced braces", file, name)
			}
			methods := []string{}
			for _, m := range protoRPC.FindAllStringSubmatch(body, -1) {
				methods = append(methods, m[1])
			}
			services[name] = methods
		}
		return nil
	})
	if os.IsNotExist(err) {
		return services, nil
	}
	return services, err
}

// block returns the text up to the brace that closes an already opened block.
func block(s string) (string, bool) {
	depth := 1
	for i, r := range s {
		switch r {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[:i], true
			}
		}
	}
	return "", false
}

// resolveRoutes fills in s.Routes: the method paths of its grpc_services
// that are not marked internal. Every service must be defined in the
// module's protos, and every internal entry must name one of its services
// or one of their methods.
func (s *Service) resolveRoutes(defined map[string][]string) error {
	internal := map[string]bool{}
	for _, entry := range s.Internal {
		internal[entry] = false
	}
	for _, svc := range s.GRPCServices {
		methods, ok := defined[svc]
		if !ok {
			return fmt.Errorf("service %s: grpc service %s is not defined in the module's protos", s.Name, svc)
		}
		_, whole := internal[svc]
		if whole {
			internal[svc] = true
		}
		for _, method := range methods {
			full := svc + "/" + method
			if _, ok := internal[full]; ok {
				internal[full] = true
				continue
			}
			if !whole {
				s.Routes = append(s.Routes, "/"+full)
			}
		}
	}
	for _, entry := range s.Internal {
		if !internal[entry] {
			return fmt.Errorf("service %s: internal %q is neither one of its grpc_services nor one of their methods", s.Name, entry)
		}
		if svc, _, ok := strings.Cut(entry, "/"); ok {
			if _, whole := internal[svc]; whole {
				return fmt.Errorf("service %s: internal %q is redundant, %s is internal as a whole", s.Name, entry, svc)
			}
		}
	}
	return nil
}
