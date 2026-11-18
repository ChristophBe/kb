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

# The page canvas of the default theme (theme.css), which the accent text must stand out against.
CANVAS_LIGHT="#f4f4f0"
CANVAS_DARK="#11120f"

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
  case $key in name | logo | favicon | colors | fonts) ;; *) fail "unknown key \"$key\"" ;; esac
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

for mode in light dark; do
  jq -e ".colors.$mode" "$file" >/dev/null 2>&1 || continue
  if [ "$mode" = light ]; then canvas=$CANVAS_LIGHT; else canvas=$CANVAS_DARK; fi
  accent=$(jq -r ".colors.$mode.accent // empty" "$file")
  on=$(jq -r ".colors.$mode.onAccent // empty" "$file")
  ok=1
  for pair in "accent:$accent" "onAccent:$on"; do
    if ! printf '%s' "${pair#*:}" | grep -Eq '^#[0-9a-fA-F]{6}$'; then
      fail "colors.$mode.${pair%%:*} must be a color like #1d4ed8"
      ok=0
    fi
  done
  [ "$ok" = 1 ] || continue
  ratio=$(contrast "$accent" "$on")
  at_least "$ratio" 4.5 || fail "colors.$mode: text on the accent has contrast $ratio:1 (accent $accent, onAccent $on), needs 4.5:1"
  ratio=$(contrast "$accent" "$canvas")
  at_least "$ratio" 4.5 || fail "colors.$mode.accent $accent has contrast $ratio:1 against the page background $canvas, needs 4.5:1"
done

if [ -n "$errors" ]; then
  printf '%s' "$errors" >&2
  exit 1
fi

# The config.json object: asset names become URLs under /branding.
jq -c '{name, logo, favicon, colors, fonts}
  | (.logo, .favicon) |= (if type == "object" then map_values("/branding/" + .) elif type == "string" then "/branding/" + . else . end)
  | (.fonts // empty | .[] | select(.file) | .file) |= "/branding/" + .
  | with_entries(select(.value != null))' "$file"
