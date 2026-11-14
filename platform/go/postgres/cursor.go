package postgres

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrInvalidCursor is returned for a page token that is malformed, was not
// made by Cursor.Encode or has an unknown version.
var ErrInvalidCursor = errors.New("invalid page token")

// cursorVersion is the version of the wire format. Bump it when the format
// changes; tokens of other versions are rejected.
const cursorVersion = 1

// Cursor is the position after which a keyset-paginated list continues: the
// ordering time and the id of the last row of the previous page, for lists
// ordered by (time DESC, id DESC).
//
// The wire format is shared with kb_platform.pagination (Python), which has
// the same fixture test (platform/testdata/cursor.json): base64url without
// padding of the compact JSON {"v":1,"t":<unix microseconds>,"i":"<uuid>"}.
type Cursor struct {
	Time time.Time
	ID   uuid.UUID
}

type cursorWire struct {
	V int64     `json:"v"`
	T *int64    `json:"t"`
	I uuid.UUID `json:"i"`
}

// Encode returns the opaque page token for c. Time keeps microseconds, the
// precision of Postgres timestamps.
func (c Cursor) Encode() string {
	t := c.Time.UnixMicro()
	raw, _ := json.Marshal(cursorWire{V: cursorVersion, T: &t, I: c.ID})
	return base64.RawURLEncoding.EncodeToString(raw)
}

// DecodeCursor parses a token made by Cursor.Encode. Anything else returns
// ErrInvalidCursor.
func DecodeCursor(token string) (Cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return Cursor{}, ErrInvalidCursor
	}
	var w cursorWire
	if err := json.Unmarshal(raw, &w); err != nil || w.V != cursorVersion || w.T == nil {
		return Cursor{}, ErrInvalidCursor
	}
	return Cursor{Time: time.UnixMicro(*w.T).UTC(), ID: w.I}, nil
}

// After decodes the page token of a list request into the query parameters of
// a keyset query: both are NULL (invalid) for the first page, i.e. an empty
// token. A bad token returns ErrInvalidCursor.
func After(token string) (pgtype.Timestamptz, pgtype.UUID, error) {
	if token == "" {
		return pgtype.Timestamptz{}, pgtype.UUID{}, nil
	}
	c, err := DecodeCursor(token)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, err
	}
	return pgtype.Timestamptz{Time: c.Time, Valid: true}, pgtype.UUID{Bytes: c.ID, Valid: true}, nil
}
