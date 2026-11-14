package limits

// Config bounds notes.
type Config struct {
	// MaxNotes are the notes one user may keep.
	MaxNotes int `env:"MAX" envDefault:"100"`
	// Strict rejects notes above the limit | instead of warning.
	Strict bool `env:"STRICT"`
}
