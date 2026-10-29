// Package bad imports another module's service code.
package bad

import "github.com/christoph/kb/modules/notes/service/store"

// R uses the import.
var R store.Repo
