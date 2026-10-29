// Package bad imports the API of an undeclared module.
package bad

import notesv1 "github.com/christoph/kb/modules/notes/api/go/notesv1"

// N uses the import.
var N notesv1.Note
