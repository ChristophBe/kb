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
# Page colors (#366): every key, the defaults of the keys left out, and the contrast limits.
check "every page color of a mode" ok '{"colors":{"dark":{"accent":"#93b4ff","onAccent":"#0b1220","accent2":"#67c5e0","canvas":"#0c101c","surface":"#141a2b","text":"#e6ebf7","textMuted":"#9ba8c7","border":"#2a3350","borderStrong":"#7886a8","glow1":"#93b4ff","glow2":"#67c5e0"}}}'
check "page colors without an accent" ok '{"colors":{"light":{"canvas":"#fafaf5","glow1":"#ff0000"}}}'
check "glows that are switched off" ok '{"colors":{"light":{"glow1":"none","glow2":"none"},"dark":{"glow1":"none"}}}'
check "a malformed glow" 'colors.light.glow1 must be a color like #1d4ed8 or "none"' '{"colors":{"light":{"glow1":"green"}}}'
check "a glow that is a number" 'colors.dark.glow2 must be a color' '{"colors":{"dark":{"glow2":5}}}'
check "none for a page color" "colors.light.canvas must be a color like #1d4ed8" '{"colors":{"light":{"canvas":"none"}}}'
check "a null color" "colors.light.text must be a color" '{"colors":{"light":{"text":null}}}'
for key in accent2 canvas surface text textMuted border borderStrong; do
  check "a malformed $key" "colors.dark.$key must be a color like #1d4ed8" "{\"colors\":{\"dark\":{\"$key\":\"#12345\"}}}"
done
check "an unknown color key" 'unknown key "background" in colors.light' '{"colors":{"light":{"background":"#ffffff"}}}'
check "an unknown mode" 'unknown mode "sepia"' '{"colors":{"sepia":{}}}'
check "colors that are not an object" "colors must be an object" '{"colors":"blue"}'
check "a mode that is not an object" "colors.light must be an object" '{"colors":{"light":"#ffffff"}}'
check "text that vanishes on the configured canvas" "colors.light.text #777777 has contrast" '{"colors":{"light":{"text":"#777777","canvas":"#ffffff"}}}'
check "default text on a dark canvas configured in light mode" "colors.light.text #21221e has contrast" '{"colors":{"light":{"canvas":"#333333"}}}'
check "muted text on the configured surface" "colors.dark.textMuted #a4a69f has contrast 1.53:1 against the cards (surface #cccccc)" '{"colors":{"dark":{"surface":"#cccccc"}}}'
check "text on the configured surface" "colors.light.text #bbbbbb has contrast" '{"colors":{"light":{"text":"#bbbbbb","canvas":"#000000","surface":"#ffffff"}}}'
check "a canvas that hides the default accent" "colors.dark.accent #8ec899 has contrast" '{"colors":{"dark":{"canvas":"#d0d8d0"}}}'
check "a border that vanishes on the canvas" "colors.light.borderStrong #e0e0e0 has contrast" '{"colors":{"light":{"borderStrong":"#e0e0e0"}}}'
check "a border that vanishes on the surface" "colors.dark.borderStrong #797b74 has contrast" '{"colors":{"dark":{"surface":"#8a8c85"}}}'
check "a decorative border below 3:1" ok '{"colors":{"light":{"border":"#f0f0ec"}}}'
check "a second gradient stop that vanishes" "colors.dark.accent2 #222222 has contrast" '{"colors":{"dark":{"accent2":"#222222"}}}'
check "a second gradient stop on the configured canvas" "colors.light.accent2 #997238 has contrast" '{"colors":{"light":{"canvas":"#a08040"}}}'
check "an accent against the configured canvas" "colors.light.accent #1d4ed8 has contrast" '{"colors":{"light":{"accent":"#1d4ed8","onAccent":"#ffffff","canvas":"#2a4aa0"}}}'
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

# --- navigation ---
check "a solid navigation" ok '{"navigation":{"light":{"background":"#1d4ed8","text":"#ffffff"}}}'
check "a gradient navigation" ok '{"navigation":{"dark":{"background":{"from":"#0b1220","to":"#1e3a8a","angle":90},"text":"#ffffff"}}}'
check "a gradient without an angle and text" ok '{"navigation":{"light":{"background":{"from":"#ffffff","to":"#dbeafe"}}}}'
check "a gradient without a stop" "navigation.light.background.to must be a color" '{"navigation":{"light":{"background":{"from":"#ffffff"}}}}'
check "an angle out of range" "navigation.dark.background.angle must be a number from 0 to 360" '{"navigation":{"dark":{"background":{"from":"#000000","to":"#111111","angle":361}}}}'
check "a malformed navigation color" "navigation.light.background must be a color" '{"navigation":{"light":{"background":"blue"}}}'
check "an unknown navigation key" 'unknown key "image" in navigation.light' '{"navigation":{"light":{"background":"#ffffff","image":"x.png"}}}'
check "an unknown navigation mode" 'unknown key "sepia" in navigation' '{"navigation":{"sepia":{"background":"#ffffff"}}}'
check "a navigation without a background" "navigation.light.background is missing" '{"navigation":{"light":{"text":"#000000"}}}'
check "low contrast on one gradient stop" "navigation.light: text #ffffff has contrast" '{"navigation":{"light":{"background":{"from":"#1d4ed8","to":"#9ec5fe"},"text":"#ffffff"}}}'
check "low contrast on a solid navigation" "needs 4.5:1" '{"navigation":{"dark":{"background":"#333333","text":"#555555"}}}'
# --- end navigation ---
# --- logo.showName (#360) ---
check "logo.showName true" ok '{"logo":{"light":"logo-light.svg","showName":true}}'
check "logo.showName false" ok '{"logo":{"light":"logo-light.svg","showName":false}}'
check "logo.showName as text" "logo.showName must be true or false" '{"logo":{"light":"logo-light.svg","showName":"yes"}}'
out=$(printf '%s' '{"logo":{"light":"logo-light.svg","showName":true}}' >"$tmp/dir/branding.json"; sh "$here/branding.sh" "$tmp/dir/branding.json" "$tmp/root" 2>&1)
printf '%s' "$out" | jq -e '.logo.showName == true and .logo.light == "/branding/logo-light.svg"' >/dev/null || { echo "FAIL showName output: $out"; failed=1; }
# --- end logo.showName ---

rm -rf "$tmp/dir" "$tmp/root"; mkdir -p "$tmp/dir" "$tmp/root"
cp "$example"/* "$tmp/dir/"
out=$(sh "$here/branding.sh" "$tmp/dir/branding.json" "$tmp/root")
for f in logo-light.svg logo-dark.svg favicon.svg; do
  [ -f "$tmp/root/branding/$f" ] || { echo "FAIL assets: $f was not copied"; failed=1; }
done
printf '%s' "$out" | jq -e '.logo.light == "/branding/logo-light.svg" and .favicon == "/branding/favicon.svg" and .name == "Acme Knowledge"' >/dev/null || { echo "FAIL output: $out"; failed=1; }
sh "$here/branding.sh" "$tmp/missing.json" "$tmp/root" 2>&1 | grep -q "does not exist" || { echo "FAIL a missing file"; failed=1; }

exit $failed
