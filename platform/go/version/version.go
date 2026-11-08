// Package version holds the kb release version a binary was built from.
package version

// Version is the release version (e.g. "0.3.1"), set at build time by the image
// build from the KB_VERSION build arg:
//
//	go build -ldflags "-X github.com/christoph/kb/platform/go/version.Version=$KB_VERSION"
//
// Local builds without the flag report "dev".
var Version = "dev"
