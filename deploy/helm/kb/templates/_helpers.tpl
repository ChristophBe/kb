{{- /*
Shared helpers. Resources are named after their component, without the
release name, as in compose: the generated Envoy config and the peer
addresses (KB_<MODULE>_ADDR) use those names. One release per namespace.
*/ -}}

{{- define "kb.selectorLabels" -}}
app.kubernetes.io/name: {{ .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "kb.labels" -}}
{{ include "kb.selectorLabels" . }}
app.kubernetes.io/part-of: kb
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version }}
{{- with .module }}
kb.dev/module: {{ . }}
{{- end }}
{{- end -}}

{{- /* A kb image: <image.registry>/<repository>:<image.tag or appVersion>. */ -}}
{{- define "kb.image" -}}
{{- $img := .root.Values.image -}}
{{- printf "%s/%s:%s" $img.registry .repository (default .root.Chart.AppVersion $img.tag) -}}
{{- end -}}

{{- /*
Pod spec fields every workload shares. No service links: their *_PORT
variables (S3_PORT for the Service s3, ...) clash with the servers' own
environment settings.
*/ -}}
{{- define "kb.podDefaults" -}}
enableServiceLinks: false
{{- with .Values.imagePullSecrets }}
imagePullSecrets: {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.podSecurityContext }}
securityContext: {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.nodeSelector }}
nodeSelector: {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations: {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity: {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{- /* host[:port] of publicUrl. */ -}}
{{- define "kb.publicHost" -}}
{{- $u := urlParse (required "publicUrl is required" .Values.publicUrl) -}}
{{- required "publicUrl must be an absolute URL, e.g. https://kb.example.com" $u.host -}}
{{- end -}}

{{- define "kb.oidcIssuer" -}}
{{- if .Values.oidc.issuer -}}
{{- .Values.oidc.issuer -}}
{{- else if .Values.infra.enabled -}}
{{- printf "%s/dex" (trimSuffix "/" .Values.publicUrl) -}}
{{- else -}}
{{- fail "oidc.issuer is required unless infra.enabled" -}}
{{- end -}}
{{- end -}}

{{- define "kb.oidcJwksUrl" -}}
{{- if .Values.oidc.jwksUrl -}}
{{- .Values.oidc.jwksUrl -}}
{{- else if .Values.infra.enabled -}}
http://dex:5556/dex/keys
{{- else -}}
{{- fail "oidc.jwksUrl is required unless infra.enabled" -}}
{{- end -}}
{{- end -}}

{{- /* Where browsers reach S3: s3.<public host> through the Ingress for the dev SeaweedFS. */ -}}
{{- define "kb.s3PublicEndpoint" -}}
{{- if .Values.infra.enabled -}}
{{- printf "s3.%s" (include "kb.publicHost" .) -}}
{{- else -}}
{{- default .Values.s3.endpoint .Values.s3.publicEndpoint -}}
{{- end -}}
{{- end -}}

{{- /* A secretKeyRef env entry from infra.secretName. */ -}}
{{- define "kb.secretEnv" -}}
- name: {{ .name }}
  valueFrom:
    secretKeyRef: { name: {{ .root.Values.infra.secretName }}, key: {{ .key }} }
{{- end -}}

{{- /* The connection settings of one infrastructure server for a component. */ -}}
{{- define "kb.infraEnv" -}}
{{- $v := .root.Values -}}
{{- if eq .kind "postgres" }}
{{- $pg := dict "host" "postgres" "port" 5432 "database" "kb" "sslmode" "disable" }}
{{- if not $v.infra.enabled }}
{{- $pg = merge (dict "host" (required "postgres.host is required unless infra.enabled" $v.postgres.host)) $v.postgres }}
{{- end }}
{{- $host := $pg.host }}
{{- $port := $pg.port }}
{{- $db := $pg.database }}
{{- $sslmode := $pg.sslmode }}
{{ include "kb.secretEnv" (dict "root" .root "name" "KB_POSTGRES_USER" "key" "postgres-user") }}
{{ include "kb.secretEnv" (dict "root" .root "name" "KB_POSTGRES_PASSWORD" "key" "postgres-password") }}
- name: KB_DATABASE_URL
{{- if eq .language "go" }}
  value: "postgres://$(KB_POSTGRES_USER):$(KB_POSTGRES_PASSWORD)@{{ $host }}:{{ $port }}/{{ $db }}?sslmode={{ $sslmode }}"
{{- else }}
  {{- /* SQLAlchemy with asyncpg, which takes the mode as ssl. */}}
  value: "postgresql+asyncpg://$(KB_POSTGRES_USER):$(KB_POSTGRES_PASSWORD)@{{ $host }}:{{ $port }}/{{ $db }}{{ if ne $sslmode "disable" }}?ssl={{ $sslmode }}{{ end }}"
{{- end }}
{{- else if eq .kind "nats" }}
{{ include "kb.secretEnv" (dict "root" .root "name" "KB_NATS_URL" "key" "nats-url") }}
{{- else if eq .kind "s3" }}
- name: KB_S3_ENDPOINT
  value: {{ if $v.infra.enabled }}"s3:8333"{{ else }}{{ required "s3.endpoint is required unless infra.enabled" $v.s3.endpoint | quote }}{{ end }}
- name: KB_S3_PUBLIC_ENDPOINT
  value: {{ include "kb.s3PublicEndpoint" .root | quote }}
- name: KB_S3_USE_SSL
  value: {{ ternary false $v.s3.useSSL $v.infra.enabled | quote }}
- name: KB_S3_REGION
  value: {{ $v.s3.region | quote }}
- name: KB_S3_BUCKET
  value: {{ $v.s3.bucket | quote }}
{{ include "kb.secretEnv" (dict "root" .root "name" "KB_S3_ACCESS_KEY" "key" "s3-access-key") }}
{{ include "kb.secretEnv" (dict "root" .root "name" "KB_S3_SECRET_KEY" "key" "s3-secret-key") }}
{{- end }}
{{- end -}}
