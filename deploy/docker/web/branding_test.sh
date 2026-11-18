#!/bin/sh
# Tests branding.sh against the example branding and broken variants of it (task test:deploy).
set -u
here=$(cd "$(dirname "$0")" && pwd)
example=$here/../../branding/example
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failed=0

# check <name> <want: ok | the text the error output must contain> <branding.json content>
check() {
  rm -rf "$tmp/dir" "$tmp/root"
  mkdir -p "$tmp/dir" "$tmp/root"
  cp "$example"/*.svg "$tmp/dir/"
  printf font >"$tmp/dir/acme.woff2"
  printf '%s' "$3" >"$tmp/dir/branding.json"
  out=$(sh "$here/branding.sh" "$tmp/dir/branding.json" "$tmp/root" 2>&1)
  status=$?
  if [ "$2" = ok ]; then
    [ "$status" = 0 ] || { echo "FAIL $1: exit $status: $out"; failed=1; return; }
  else
    [ "$status" = 1 ] && printf '%s' "$out" | grep -qF -- "$2" || { echo "FAIL $1: want exit 1 with \"$2\", got $status: $out"; failed=1; return; }
  fi
  echo "ok   $1"
}

check "the example" ok "$(cat "$example/branding.json")"
check "an empty object" ok '{}'
check "only a name" ok '{"name":"Acme"}'
check "not an object" "is not a JSON object" '[1]'
check "an unknown key" 'unknown key "colours"' '{"colours":{}}'
check "an empty name" "name must be" '{"name":""}'
check "a missing logo" 'logo.light "nope.svg" does not exist' '{"logo":{"light":"nope.svg"}}'
check "a path in a file name" "must be a plain file name" '{"favicon":"../favicon.svg"}'
check "a wrong file type" "must be one of these file types" '{"favicon":"favicon.gif"}'
check "a malformed color" "colors.light.accent must be a color" '{"colors":{"light":{"accent":"blue","onAccent":"#ffffff"}}}'
check "low contrast text on the accent" "colors.light: text on the accent has contrast" '{"colors":{"light":{"accent":"#1d4ed8","onAccent":"#2255dd"}}}'
check "an accent that vanishes on the page" "against the page background" '{"colors":{"dark":{"accent":"#222222","onAccent":"#ffffff"}}}'
check "a font file with a weight range" ok '{"fonts":{"heading":{"family":"Acme Serif","file":"acme.woff2","weight":"100 900"}}}'
check "a system font" ok '{"fonts":{"body":{"family":"Georgia"},"mono":{"family":"Menlo","weight":"400"}}}'
check "fonts that are not an object" "fonts must be an object" '{"fonts":"Inter"}'
check "an unknown font role" 'unknown font role "title"' '{"fonts":{"title":{"family":"Inter"}}}'
check "an unknown font key" 'unknown key "style" in fonts.body' '{"fonts":{"body":{"family":"Inter","style":"italic"}}}'
check "a font without a family" "fonts.body.family must be" '{"fonts":{"body":{"file":"acme.woff2"}}}'
check "a family that could break out of the CSS" "fonts.body.family must be" '{"fonts":{"body":{"family":"Inter\"; x"}}}'
check "a missing font file" 'fonts.mono.file "nope.woff2" does not exist' '{"fonts":{"mono":{"family":"Acme Mono","file":"nope.woff2"}}}'
check "a font file of the wrong type" "must be one of these file types: woff2 woff" '{"fonts":{"mono":{"family":"Acme Mono","file":"favicon.svg"}}}'
check "a malformed weight" "fonts.body.weight must be" '{"fonts":{"body":{"family":"Inter","weight":"bold"}}}'

rm -rf "$tmp/dir" "$tmp/root"; mkdir -p "$tmp/dir" "$tmp/root"
cp "$example"/* "$tmp/dir/"
out=$(sh "$here/branding.sh" "$tmp/dir/branding.json" "$tmp/root")
for f in logo-light.svg logo-dark.svg favicon.svg; do
  [ -f "$tmp/root/branding/$f" ] || { echo "FAIL assets: $f was not copied"; failed=1; }
done
printf '%s' "$out" | jq -e '.logo.light == "/branding/logo-light.svg" and .favicon == "/branding/favicon.svg" and .name == "Acme Knowledge"' >/dev/null || { echo "FAIL output: $out"; failed=1; }
sh "$here/branding.sh" "$tmp/missing.json" "$tmp/root" 2>&1 | grep -q "does not exist" || { echo "FAIL a missing file"; failed=1; }

exit $failed
