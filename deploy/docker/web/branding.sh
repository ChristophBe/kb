#!/bin/sh
# Checks a branding file (docs/operations/branding.md) and prints the "branding" object of config.json.
# Usage: branding.sh <branding.json> <web root>; copies the logo and favicon files into <web root>/branding.
# Exits 1 with one line per problem when the file is not usable.
set -u
file=${1:?usage: branding.sh <branding.json> <web root>}
root=${2:?usage: branding.sh <branding.json> <web root>}
dir=$(dirname "$file")
errors=""
fail() { errors="${errors}branding: $1
"; }

# The Knowcelium color of every key per mode, as sRGB hex (theme.css; theme.test.ts fails when they drift).
# A key a branding file leaves out keeps this value, so it takes part in the contrast checks.
DEFAULT_COLORS='
light.accent #3a6343
light.onAccent #fcfcfa
light.accent2 #997238
light.canvas #f4f4f0
light.surface #fcfcfa
light.text #21221e
light.textMuted #5a5c56
light.border #d7d8d2
light.borderStrong #777870
light.glow1 #427054
light.glow2 #a97416
light.infoText #236292
light.infoBackground #e4f0fb
light.successText #086d5f
light.successBackground #def4ef
light.warningText #8d4f0c
light.warningBackground #fdf0dc
light.dangerText #b02b27
light.dangerBackground #ffedeb
light.neutralText #5a5c56
light.neutralBackground #e8e8e4
dark.accent #8ec899
dark.onAccent #101911
dark.accent2 #d8ba79
dark.canvas #11120f
dark.surface #191b18
dark.text #ebebe7
dark.textMuted #a4a69f
dark.border #31342f
dark.borderStrong #797b74
dark.glow1 #8cc8a0
dark.glow2 #eec469
dark.infoText #87c6f2
dark.infoBackground #152839
dark.successText #75dac4
dark.successBackground #0b2d27
dark.warningText #f5c761
dark.warningBackground #382409
dark.dangerText #fda19e
dark.dangerBackground #3f1917
dark.neutralText #a4a69f
dark.neutralBackground #252723
'
COLOR_KEYS="accent onAccent accent2 canvas surface text textMuted border borderStrong glow1 glow2"
# The status colors (#367): text and subtle background of each status, as colors.<mode>.status.<name>.{text,background}.
STATUS_NAMES="info success warning danger neutral"

# contrast <#rrggbb> <#rrggbb>: the WCAG contrast ratio (POSIX awk: no strtonum in busybox).
contrast() {
  awk -v a="$1" -v b="$2" '
    function hex(c) { return index("0123456789abcdef", tolower(c)) - 1 }
    function chan(h, i,  v) { v = (hex(substr(h, i, 1)) * 16 + hex(substr(h, i + 1, 1))) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ^ 2.4 }
    function lum(h) { return 0.2126 * chan(h, 2) + 0.7152 * chan(h, 4) + 0.0722 * chan(h, 6) }
    BEGIN { x = lum(a); y = lum(b); if (x < y) { t = x; x = y; y = t }; printf "%.2f", (x + 0.05) / (y + 0.05) }'
}

# at_least <ratio> <min>
at_least() { awk -v r="$1" -v m="$2" 'BEGIN { exit !(r >= m) }'; }

if [ ! -f "$file" ]; then
  echo "branding: $file does not exist (KNOWCEL_BRANDING_FILE)" >&2
  exit 1
fi
if ! jq -e 'type == "object"' "$file" >/dev/null 2>&1; then
  echo "branding: $file is not a JSON object" >&2
  exit 1
fi

# Unknown keys are mistakes (a typo would silently keep the default).
for key in $(jq -r 'keys[]' "$file"); do
  case $key in name | logo | favicon | colors | fonts | navigation | icons) ;; *) fail "unknown key \"$key\"" ;; esac
done

if jq -e 'has("name")' "$file" >/dev/null; then
  jq -e '.name | type == "string" and length >= 1 and length <= 60' "$file" >/dev/null || fail "name must be a text of 1 to 60 characters"
fi

# asset <field> <jq path> <extensions>: validates the file a field names and copies it to <web root>/branding.
asset() {
  field=$1
  types=$3
  rel=$(jq -r "$2 // empty" "$file")
  [ -n "$rel" ] || return 0
  case $rel in
    *[!A-Za-z0-9._-]* | .*) fail "$field must be a plain file name next to the branding file, not \"$rel\""; return ;;
  esac
  case " $types " in
    *" ${rel##*.} "*) ;;
    *) fail "$field \"$rel\" must be one of these file types: $types"; return ;;
  esac
  if [ ! -f "$dir/$rel" ]; then
    fail "$field \"$rel\" does not exist next to the branding file"
  elif [ "$(wc -c <"$dir/$rel")" -gt 524288 ]; then
    fail "$field \"$rel\" is larger than 512 KiB"
  else
    mkdir -p "$root/branding" && cp "$dir/$rel" "$root/branding/$rel"
  fi
}
# --- logo.showName (#360): the product name as text under a logo image ---
if jq -e '.logo | type == "object" and has("showName")' "$file" >/dev/null 2>&1; then
  jq -e '.logo.showName | type == "boolean"' "$file" >/dev/null || fail "logo.showName must be true or false"
fi
# --- end logo.showName ---

asset "logo.light" ".logo.light" "svg png webp"
asset "logo.dark" ".logo.dark" "svg png webp"
asset "favicon" ".favicon" "svg png ico"

# Fonts: a family name per role, optionally with a font file (otherwise a system font) and a weight or range.
if jq -e 'has("fonts")' "$file" >/dev/null; then
  if ! jq -e '.fonts | type == "object"' "$file" >/dev/null; then
    fail "fonts must be an object with heading, body and mono"
  else
    for role in $(jq -r '.fonts | keys[]' "$file"); do
      case $role in
        heading | body | mono) ;;
        *) fail "unknown font role \"$role\" (heading, body or mono)"; continue ;;
      esac
      if ! jq -e ".fonts.$role | type == \"object\"" "$file" >/dev/null; then
        fail "fonts.$role must be an object with family"
        continue
      fi
      for key in $(jq -r ".fonts.$role | keys[]" "$file"); do
        case $key in family | file | weight) ;; *) fail "unknown key \"$key\" in fonts.$role" ;; esac
      done
      family=$(jq -r ".fonts.$role.family // empty" "$file")
      printf '%s' "$family" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9 .-]{0,79}$' || fail "fonts.$role.family must be a font name of up to 80 letters, digits, spaces, . and -"
      weight=$(jq -r ".fonts.$role.weight // empty" "$file")
      if [ -n "$weight" ]; then
        printf '%s' "$weight" | grep -Eq '^[1-9][0-9]{2}( [1-9][0-9]{2})?$' || fail "fonts.$role.weight must be a weight like 400 or a range like 100 900"
      fi
      asset "fonts.$role.file" ".fonts.$role.file" "woff2 woff"
    done
  fi
fi

# default_color <mode> <key>
default_color() { printf '%s\n' "$DEFAULT_COLORS" | awk -v k="$1.$2" '$1 == k { print $2 }'; }

# check_pair <mode> <foreground key> <background key> <what the background is> <minimum>
check_pair() {
  eval "fg_value=\$c_$2 bg_value=\$c_$3"
  ratio=$(contrast "$fg_value" "$bg_value")
  at_least "$ratio" "$5" || fail "colors.$1.$2 $fg_value has contrast $ratio:1 against $4 ($3 $bg_value), needs $5:1"
}

if jq -e 'has("colors")' "$file" >/dev/null; then
  if ! jq -e '.colors | type == "object"' "$file" >/dev/null; then
    fail "colors must be an object with light and dark"
  else
    for mode in $(jq -r '.colors | keys[]' "$file"); do
      case $mode in light | dark) ;; *) fail "unknown mode \"$mode\" in colors (light or dark)" ;; esac
    done
  fi
fi
# --- icons: an object from icon name to an image file (copied to <web root>/branding/icons) ---
# The icon names of the UI (platform/ui/kit/src/icons.tsx; a test keeps this list and the guide in step).
ICON_NAMES="alert-triangle arrow-left arrow-right arrow-up bar-chart-3 check check-circle-2 chevron-left circle-alert circle-help circle-user copy cpu download file-text file-up info layers library log-out menu message-square message-square-text monitor moon plus rotate-ccw search search-x shield-alert square sun trash-2 triangle-alert upload user-minus user-round-cog users-round x"
if jq -e 'has("icons")' "$file" >/dev/null; then
  if ! jq -e '.icons | type == "object"' "$file" >/dev/null; then
    fail "icons must be an object from icon name to image file"
  else
    for name in $(jq -r '.icons | keys[]' "$file"); do
      case " $ICON_NAMES " in
        *" $name "*) ;;
        *) fail "icons.$name is not an icon of the UI (see the icon list in docs/operations/branding.md)"; continue ;;
      esac
      if ! jq -e --arg n "$name" '.icons[$n] | type == "string"' "$file" >/dev/null; then
        fail "icons.$name must be the name of an image file"
        continue
      fi
      rel=$(jq -r --arg n "$name" '.icons[$n]' "$file")
      case $rel in
        "" | *[!A-Za-z0-9._-]* | .*) fail "icons.$name must be a plain file name next to the branding file, not \"$rel\""; continue ;;
      esac
      case ${rel##*.} in
        svg | png) ;;
        *) fail "icons.$name \"$rel\" must be one of these file types: svg png"; continue ;;
      esac
      if [ ! -f "$dir/$rel" ]; then
        fail "icons.$name \"$rel\" does not exist next to the branding file"
      elif [ "$(wc -c <"$dir/$rel")" -gt 65536 ]; then
        fail "icons.$name \"$rel\" is larger than 64 KiB"
      else
        mkdir -p "$root/branding/icons" && cp "$dir/$rel" "$root/branding/icons/$rel"
      fi
    done
  fi
fi
# --- end icons ---

for mode in light dark; do
  jq -e ".colors.$mode" "$file" >/dev/null 2>&1 || continue
  if ! jq -e ".colors.$mode | type == \"object\"" "$file" >/dev/null; then
    fail "colors.$mode must be an object of colors"
    continue
  fi
  ok=1
  for key in $(jq -r ".colors.$mode | keys[]" "$file"); do
    case " $COLOR_KEYS status " in *" $key "*) ;; *) fail "unknown key \"$key\" in colors.$mode"; ok=0 ;; esac
  done
  # The effective color of every key: configured, else the Knowcelium default of the mode.
  for key in $COLOR_KEYS; do
    value=$(default_color "$mode" "$key")
    if jq -e ".colors.$mode | has(\"$key\")" "$file" >/dev/null; then
      value=$(jq -r ".colors.$mode.$key | tostring" "$file")
      if ! printf '%s' "$value" | grep -Eq '^#[0-9a-fA-F]{6}$'; then
        # A glow may also be "none" (that light is off); it stays out of the contrast checks.
        case "$key:$value" in
          glow1:none | glow2:none) ;;
          glow*) fail "colors.$mode.$key must be a color like #1d4ed8 or \"none\""; ok=0 ;;
          *) fail "colors.$mode.$key must be a color like #1d4ed8"; ok=0 ;;
        esac
      fi
    fi
    eval "c_$key=\$value"
  done
  [ "$ok" = 1 ] || continue
  ratio=$(contrast "$c_accent" "$c_onAccent")
  at_least "$ratio" 4.5 || fail "colors.$mode: text on the accent has contrast $ratio:1 (accent $c_accent, onAccent $c_onAccent), needs 4.5:1"
  check_pair "$mode" accent canvas "the page background" 4.5
  for bg in canvas surface; do
    if [ "$bg" = canvas ]; then what="the page background"; else what="the cards"; fi
    check_pair "$mode" text "$bg" "$what" 4.5
    check_pair "$mode" textMuted "$bg" "$what" 4.5
    check_pair "$mode" borderStrong "$bg" "$what" 3
  done
  check_pair "$mode" accent2 canvas "the page background" 3
done

# --- status colors (#367): colors.<mode>.status.<name> = { text, background } ---
# is_color <value>
is_color() { printf '%s' "$1" | grep -Eq '^#[0-9a-fA-F]{6}$'; }
# effective_color <mode> <key>: the configured page color if it is a valid color, else the Knowcelium default.
effective_color() {
  v=$(jq -r ".colors.$1.$2 | if type == \"string\" then . else empty end" "$file" 2>/dev/null)
  if is_color "$v"; then printf '%s' "$v"; else default_color "$1" "$2"; fi
}
# status_pair <mode> <status> <foreground part> <background value> <what the background is> <minimum>
status_pair() {
  ratio=$(contrast "$fg" "$4")
  at_least "$ratio" "$6" || fail "colors.$1.status.$2.$3 $fg has contrast $ratio:1 against $5 ($4), needs $6:1"
}
for mode in light dark; do
  jq -e ".colors.$mode | type == \"object\" and has(\"status\")" "$file" >/dev/null 2>&1 || continue
  st=".colors.$mode.status"
  if ! jq -e "$st | type == \"object\"" "$file" >/dev/null; then
    fail "colors.$mode.status must be an object from status name to { text, background }"
    continue
  fi
  canvas=$(effective_color "$mode" canvas)
  surface=$(effective_color "$mode" surface)
  for name in $(jq -r "$st | keys[]" "$file"); do
    case " $STATUS_NAMES " in
      *" $name "*) ;;
      *) fail "unknown status \"$name\" in colors.$mode.status (info, success, warning, danger or neutral)"; continue ;;
    esac
    if ! jq -e "$st.$name | type == \"object\"" "$file" >/dev/null; then
      fail "colors.$mode.status.$name must be an object with text and background"
      continue
    fi
    ok=1
    for key in $(jq -r "$st.$name | keys[]" "$file"); do
      case $key in text | background) ;; *) fail "unknown key \"$key\" in colors.$mode.status.$name (text or background)"; ok=0 ;; esac
    done
    text=$(default_color "$mode" "${name}Text")
    background=$(default_color "$mode" "${name}Background")
    for part in text background; do
      jq -e "$st.$name | has(\"$part\")" "$file" >/dev/null || continue
      value=$(jq -r "$st.$name.$part | tostring" "$file")
      if is_color "$value"; then eval "$part=\$value"; else fail "colors.$mode.status.$name.$part must be a color like #1d4ed8"; ok=0; fi
    done
    [ "$ok" = 1 ] || continue
    fg=$text
    status_pair "$mode" "$name" text "$background" "its background" 4.5
    status_pair "$mode" "$name" text "$canvas" "the page background" 4.5
    status_pair "$mode" "$name" text "$surface" "the cards" 4.5
    # A background left out keeps the default, which is not held to this limit.
    if jq -e "$st.$name | has(\"background\")" "$file" >/dev/null; then
      fg=$background
      ratio=$(contrast "$background" "$canvas")
      at_least "$ratio" 1.1 || fail "colors.$mode.status.$name.background $background has contrast $ratio:1 against the page background ($canvas), needs 1.1:1 to stay visible"
    fi
  done
done
# --- end status colors ---

# --- navigation: the background (color or gradient) and text color of the main sidebar, per mode ---
if jq -e 'has("navigation")' "$file" >/dev/null; then
  if ! jq -e '.navigation | type == "object"' "$file" >/dev/null; then
    fail "navigation must be an object with light and dark"
  else
    for mode in $(jq -r '.navigation | keys[]' "$file"); do
      case $mode in light | dark) ;; *) fail "unknown key \"$mode\" in navigation (light or dark)"; continue ;; esac
      nav=".navigation.$mode"
      if ! jq -e "$nav | type == \"object\"" "$file" >/dev/null; then
        fail "navigation.$mode must be an object with background and text"
        continue
      fi
      for key in $(jq -r "$nav | keys[]" "$file"); do
        case $key in background | text) ;; *) fail "unknown key \"$key\" in navigation.$mode" ;; esac
      done
      stops=""
      ok=1
      kind=$(jq -r "$nav.background | if . == null then \"none\" else type end" "$file")
      case $kind in
        none) fail "navigation.$mode.background is missing (a color like #1d4ed8 or { from, to, angle })"; ok=0 ;;
        string)
          stops=$(jq -r "$nav.background" "$file")
          printf '%s' "$stops" | grep -Eq '^#[0-9a-fA-F]{6}$' || { fail "navigation.$mode.background must be a color like #1d4ed8 or an object with from and to"; ok=0; }
          ;;
        object)
          for key in $(jq -r "$nav.background | keys[]" "$file"); do
            case $key in from | to | angle) ;; *) fail "unknown key \"$key\" in navigation.$mode.background"; ok=0 ;; esac
          done
          for key in from to; do
            c=$(jq -r "$nav.background.$key | if type == \"string\" then . else empty end" "$file")
            if printf '%s' "$c" | grep -Eq '^#[0-9a-fA-F]{6}$'; then
              stops="$stops $c"
            else
              fail "navigation.$mode.background.$key must be a color like #1d4ed8"
              ok=0
            fi
          done
          jq -e "$nav.background | has(\"angle\") | not" "$file" >/dev/null ||
            jq -e "$nav.background.angle | type == \"number\" and . >= 0 and . <= 360" "$file" >/dev/null ||
            { fail "navigation.$mode.background.angle must be a number from 0 to 360"; ok=0; }
          ;;
        *) fail "navigation.$mode.background must be a color like #1d4ed8 or an object with from and to"; ok=0 ;;
      esac
      if jq -e "$nav | has(\"text\")" "$file" >/dev/null; then
        text=$(jq -r "$nav.text | if type == \"string\" then . else empty end" "$file")
        if ! printf '%s' "$text" | grep -Eq '^#[0-9a-fA-F]{6}$'; then
          fail "navigation.$mode.text must be a color like #ffffff"
        elif [ "$ok" = 1 ]; then
          for stop in $stops; do
            ratio=$(contrast "$stop" "$text")
            at_least "$ratio" 4.5 || fail "navigation.$mode: text $text has contrast $ratio:1 against the background $stop, needs 4.5:1"
          done
        fi
      fi
    done
  fi
fi
# --- end navigation ---

if [ -n "$errors" ]; then
  printf '%s' "$errors" >&2
  exit 1
fi

# The config.json object: asset names become URLs under /branding.
jq -c '{name, logo, favicon, colors, fonts, navigation, icons}
  | (.logo | objects | (.light, .dark) | strings) |= ("/branding/" + .)
  | (.favicon | strings) |= ("/branding/" + .)
  | (.fonts // empty | .[] | select(.file) | .file) |= "/branding/" + .
  | (.icons // empty | .[]) |= "/branding/icons/" + .
  | with_entries(select(.value != null))' "$file"
