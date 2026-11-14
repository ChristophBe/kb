package postgres

import (
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
)

type cursorFixture struct {
	Valid []struct {
		Token      string `json:"token"`
		UnixMicros int64  `json:"unix_micros"`
		ID         string `json:"id"`
	} `json:"valid"`
	Invalid []struct {
		Name  string `json:"name"`
		Token string `json:"token"`
	} `json:"invalid"`
}

// The Python tests read the same file, so the two encodings cannot drift.
func loadCursorFixture(t *testing.T) cursorFixture {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/cursor.json")
	if err != nil {
		t.Fatal(err)
	}
	var f cursorFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestCursorMatchesTheSharedFixture(t *testing.T) {
	for _, v := range loadCursorFixture(t).Valid {
		c, err := DecodeCursor(v.Token)
		if err != nil {
			t.Fatalf("decode %q: %v", v.Token, err)
		}
		if c.Time.UnixMicro() != v.UnixMicros || c.ID != uuid.MustParse(v.ID) {
			t.Errorf("decoded %+v, want %d / %s", c, v.UnixMicros, v.ID)
		}
		if got := c.Encode(); got != v.Token {
			t.Errorf("encode = %q, want %q", got, v.Token)
		}
	}
}

func TestCursorRejectsInvalidTokens(t *testing.T) {
	for _, tc := range loadCursorFixture(t).Invalid {
		if _, err := DecodeCursor(tc.Token); !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("%s: err = %v, want ErrInvalidCursor", tc.Name, err)
		}
	}
}
