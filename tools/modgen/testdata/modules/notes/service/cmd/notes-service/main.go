package main

import (
	"github.com/christoph/kb/modules/notes/service/internal/limits"
	"github.com/christoph/kb/platform/go/config"
)

type Config struct {
	config.Base
	// DatabaseURL is the notes database.
	DatabaseURL string        `env:"DATABASE_URL" envDefault:"postgres://localhost/kb"`
	Limits      limits.Config `envPrefix:"NOTES_"`
	Retry       retry
}

type retry struct {
	Delay string `env:"RETRY_DELAY" envDefault:"1s"` // Delay is the wait before a retry.
}

func main() {}
