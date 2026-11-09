# Module boundary fixture

A miniature repository with known violations. `task test:boundaries` copies it to a temp dir, runs modgen on it and checks that golangci-lint (depguard), lint-imports and biome each report exactly the violations in the `bad` files, and nothing in the `ok` files.

- `search` depends on `notes`; `tags` depends on nothing.
- Violations: search imports notes' service code; tags imports notes' API without declaring it; platform imports a module; a UI imports another module's UI (also a subpath such as its `/manifest`) or reaches into it with a relative path.
