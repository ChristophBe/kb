//go:build integration

package embedcheck

import (
	"testing"

	"github.com/christoph/kb/modules/document/migrations"
	"github.com/christoph/kb/platform/go/postgres/pgtest"
)

func TestColumnDimensionsReadsTheMigratedColumn(t *testing.T) {
	pool := pgtest.Start(t, "document", migrations.FS)
	n, err := ColumnDimensions(t.Context(), pool)
	if err != nil {
		t.Fatal(err)
	}
	// The dimension of the vector column in modules/document/migrations.
	if n != 768 {
		t.Errorf("dimensions = %d, want 768", n)
	}
}
