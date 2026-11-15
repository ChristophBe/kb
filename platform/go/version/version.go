// Package version holds the kb release version a binary was built from.
package version

// Version is the release version (e.g. "0.3.1"), set at build time by the image
// build from the KNOWCEL_VERSION build arg:
//
//	go build -ldflags "-X github.com/ChristophBe/knowcelium/platform/go/version.Version=$KNOWCEL_VERSION"
//
// Local builds without the flag report "dev".
var Version = "dev"
