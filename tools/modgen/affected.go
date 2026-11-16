package main

import (
	"context"
	"flag"
	"fmt"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
)

// AllModules is what `modgen affected` prints when every module must be tested.
const AllModules = "all"

// Affected returns the modules whose tests a change to files can break: the
// modules with changed files plus every module that depends on them, directly
// or transitively. Files outside modules/ (shared code, lockfiles, tooling, CI)
// affect everything, except documentation. The result is AllModules or the
// sorted module ids; empty when nothing needs testing.
func Affected(modules []Module, files []string) []string {
	known := map[string]bool{}
	for _, m := range modules {
		known[m.ID] = true
	}
	changed := map[string]bool{}
	for _, f := range files {
		f = filepath.ToSlash(f)
		switch {
		case strings.HasPrefix(f, "docs/"), strings.HasSuffix(f, ".md"):
		case strings.HasPrefix(f, "modules/"):
			id, _, _ := strings.Cut(strings.TrimPrefix(f, "modules/"), "/")
			if !known[id] {
				return []string{AllModules}
			}
			changed[id] = true
		default:
			return []string{AllModules}
		}
	}
	// Reverse closure over depends_on.
	for grew := true; grew; {
		grew = false
		for _, m := range modules {
			if changed[m.ID] {
				continue
			}
			for _, dep := range m.DependsOn {
				if changed[dep] {
					changed[m.ID] = true
					grew = true
					break
				}
			}
		}
	}
	ids := make([]string, 0, len(changed))
	for id := range changed {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}

// runAffected implements `modgen affected -base <ref>`: it prints the affected
// modules for the files changed since the merge base with ref.
func runAffected(args []string) error {
	fs := flag.NewFlagSet("affected", flag.ExitOnError)
	root := fs.String("root", ".", "repository root")
	base := fs.String("base", "origin/main", "git ref the change is compared with")
	if err := fs.Parse(args); err != nil {
		return err
	}
	modules, err := LoadModules(filepath.Join(*root, "modules"))
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(context.Background(), "git", "-C", *root, "diff", "--name-only", *base+"...HEAD")
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("git diff against %s: %w", *base, err)
	}
	fmt.Println(strings.Join(Affected(modules, strings.Fields(string(out))), " "))
	return nil
}
