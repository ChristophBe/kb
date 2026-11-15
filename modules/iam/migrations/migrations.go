// Package migrations embeds the iam module's goose migrations.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
