# Source this before `docker compose` (task up, task dev): it accepts the
# deprecated KB_* variables of the environment and of .env as KNOWCEL_*, with
# a warning, because compose substitutes only the names the compose files use.
# Remove it together with the KB_* fallback of the services after one release.

legacy_env_apply() {
  name=$1 value=$2 source=$3
  eval "[ -n \"\${KNOWCEL_$name+x}\" ]" && return 0 # KNOWCEL_<name> wins
  grep -q "^KNOWCEL_$name=" .env 2>/dev/null && return 0
  echo "warning: KB_$name in $source is deprecated, rename it to KNOWCEL_$name (KB_* support ends after the next release)" >&2
  export "KNOWCEL_$name=$value"
}

for legacy_pair in $(env | sed -n 's/^KB_\([A-Z0-9_]*\)=.*/\1/p'); do
  eval "legacy_env_apply \"\$legacy_pair\" \"\${KB_$legacy_pair}\" the-environment"
done

if [ -f .env ]; then
  while IFS= read -r legacy_line; do
    case $legacy_line in
      KB_[A-Z0-9_]*=*)
        legacy_key=${legacy_line%%=*}
        legacy_val=${legacy_line#*=}
        case $legacy_val in
          \"*\") legacy_val=${legacy_val#\"} legacy_val=${legacy_val%\"} ;;
          \'*\') legacy_val=${legacy_val#\'} legacy_val=${legacy_val%\'} ;;
        esac
        legacy_env_apply "${legacy_key#KB_}" "$legacy_val" .env
        ;;
    esac
  done < .env
fi
unset legacy_pair legacy_line legacy_key legacy_val
